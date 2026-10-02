"""Unit tests for the interdetector alignment engine (Phase 2.4).

These tests validate the cross-correlation math in ``estimate_delay`` using
synthetic signals so they run without the ASTRA test file.
"""

import numpy as np

from app.services.alignment_engine import (
    align_detectors,
    apply_alignment,
    estimate_delay,
)


def _gaussian_peak(time, center, width, height=1.0):
    """A clean Gaussian peak on a flat (zero) baseline."""
    return height * np.exp(-0.5 * ((time - center) / width) ** 2)


class TestEstimateDelay:
    def test_recovers_known_delay(self):
        """A 0.4-min-shifted Gaussian should recover delay_min ≈ 0.4 with high correlation."""
        dt = 0.01
        t = np.arange(0.0, 30.0, dt)
        width = 0.2
        s_ref = _gaussian_peak(t, center=10.0, width=width)
        s_other = _gaussian_peak(t, center=10.4, width=width)
        result = estimate_delay(t, s_ref, t, s_other, search_window_min=1.0)
        assert result["delay_min"] is not None, "expected a delay, got None"
        assert abs(result["delay_min"] - 0.4) < 0.02, \
            f"delay_min {result['delay_min']} should be ≈ 0.4 (other lags ref)"
        assert result["correlation"] is not None
        assert result["correlation"] > 0.99, \
            f"correlation {result['correlation']} should be > 0.99 for clean identical peaks"
        assert result["n_lags"] > 0

    def test_sign_convention_other_lags(self):
        """Positive delay means the *other* detector arrives later (peak at later time)."""
        dt = 0.01
        t = np.arange(0.0, 20.0, dt)
        s_ref = _gaussian_peak(t, center=5.0, width=0.15)
        s_other = _gaussian_peak(t, center=5.3, width=0.15)
        result = estimate_delay(t, s_ref, t, s_other, search_window_min=0.8)
        assert result["delay_min"] is not None
        assert result["delay_min"] > 0.0, \
            f"other peak is later → delay should be positive, got {result['delay_min']}"

    def test_sign_convention_other_leads(self):
        """Negative delay means the *other* detector arrives earlier (peak at earlier time)."""
        dt = 0.01
        t = np.arange(0.0, 20.0, dt)
        s_ref = _gaussian_peak(t, center=5.0, width=0.15)
        s_other = _gaussian_peak(t, center=4.7, width=0.15)
        result = estimate_delay(t, s_ref, t, s_other, search_window_min=0.8)
        assert result["delay_min"] is not None
        assert result["delay_min"] < 0.0, \
            f"other peak is earlier → delay should be negative, got {result['delay_min']}"

    def test_volume_conversion(self):
        """When flow_rate_ml_min is supplied, delay_ml = delay_min * flow_rate."""
        dt = 0.01
        t = np.arange(0.0, 20.0, dt)
        s_ref = _gaussian_peak(t, center=5.0, width=0.15)
        s_other = _gaussian_peak(t, center=5.2, width=0.15)
        result = estimate_delay(t, s_ref, t, s_other, search_window_min=0.8, flow_rate_ml_min=1.0)
        assert result["delay_min"] is not None
        assert result["delay_ml"] is not None, "delay_ml should be set when flow rate is given"
        assert abs(result["delay_ml"] - result["delay_min"]) < 1e-9, \
            f"delay_ml {result['delay_ml']} should equal delay_min {result['delay_min']} at flow=1.0"

    def test_no_flow_rate_returns_none_ml(self):
        """Without flow_rate_ml_min, delay_ml is None."""
        dt = 0.01
        t = np.arange(0.0, 10.0, dt)
        s = _gaussian_peak(t, center=5.0, width=0.2)
        result = estimate_delay(t, s, t, s, search_window_min=0.5)
        assert result["delay_ml"] is None

    def test_degenerate_inputs_return_none(self):
        """Empty or constant signals return None for delay/correlation."""
        empty_t = np.array([])
        empty_s = np.array([])
        result = estimate_delay(empty_t, empty_s, empty_t, empty_s)
        assert result["delay_min"] is None
        assert result["correlation"] is None
        assert result["n_lags"] == 0

        t = np.arange(0.0, 5.0, 0.01)
        flat = np.full_like(t, 3.0)
        result = estimate_delay(t, flat, t, flat)
        assert result["delay_min"] is None, "constant signal should not produce a delay"

    def test_different_length_grids_interp(self):
        """estimate_delay interpolates the other signal onto the ref grid when lengths differ."""
        dt_ref = 0.01
        dt_other = 0.02
        t_ref = np.arange(0.0, 20.0, dt_ref)
        t_other = np.arange(0.0, 20.0, dt_other)
        s_ref = _gaussian_peak(t_ref, center=8.0, width=0.2)
        s_other = _gaussian_peak(t_other, center=8.25, width=0.2)
        result = estimate_delay(t_ref, s_ref, t_other, s_other, search_window_min=1.0)
        assert result["delay_min"] is not None
        assert abs(result["delay_min"] - 0.25) < 0.03, \
            f"delay_min {result['delay_min']} should be ≈ 0.25 despite grid mismatch"


class TestApplyAlignment:
    def test_shifts_time_axis(self):
        """apply_alignment subtracts delay from the time axis, leaves signal unchanged."""
        t = np.array([1.0, 2.0, 3.0, 4.0])
        s = np.array([0.1, 0.2, 0.3, 0.4])
        t_a, s_a = apply_alignment(t, s, delay_min=0.5)
        assert np.allclose(t_a, [0.5, 1.5, 2.5, 3.5])
        assert np.allclose(s_a, s)

    def test_none_delay_is_noop(self):
        t = np.array([1.0, 2.0, 3.0])
        s = np.array([0.1, 0.2, 0.3])
        t_a, s_a = apply_alignment(t, s, delay_min=None)
        assert np.allclose(t_a, t)
        assert np.allclose(s_a, s)

    def test_empty_inputs(self):
        t = np.array([])
        s = np.array([])
        t_a, s_a = apply_alignment(t, s, delay_min=1.0)
        assert t_a.size == 0
        assert s_a.size == 0


class TestAlignDetectors:
    def test_stub_returns_input_unchanged(self):
        """align_detectors is a Phase 2.4 stub; it must return the input unchanged."""
        detectors = {
            "RI": {"time": [1, 2, 3], "signal": [0.1, 0.2, 0.3]},
            "MALS": {"time": [1, 2, 3], "signal": [0.4, 0.5, 0.6]},
        }
        delays = {"MALS": 0.05}
        result = align_detectors(detectors, delays)
        assert result is detectors, "Phase 2.4 stub should return the input unchanged"
