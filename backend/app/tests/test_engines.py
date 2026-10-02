"""Unit tests for the Phase 3a analysis engines.

These tests use synthetic data with known answers and run without the ASTRA
test file.
"""

import numpy as np

from app.services.band_broadening import apply_band_broadening_correction
from app.services.concentration import (
    combine_concentrations,
    concentration_from_ri,
    concentration_from_uv,
)
from app.services.despiking import despike
from app.services.dilution import apply_dilution_correction
from app.services.distributions import binned_distribution
from app.services.molar_mass import (
    compute_molar_mass,
    optical_constant,
    select_angles,
    zimm_fit_per_slice,
)
from app.services.moments import compute_moments
from app.services.normalization import normalize_mals
from app.services.peak_areas import peak_area, recovery_fraction


# ---------------------------------------------------------------------------
# Despiking
# ---------------------------------------------------------------------------
class TestDespiking:
    def test_off_level_is_noop(self):
        s = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        result = despike(np.arange(5), s, level="off")
        assert np.allclose(result, s)

    def test_removes_isolated_spike(self):
        s = np.array([1.0, 1.0, 10.0, 1.0, 1.0, 1.0, 1.0])
        result = despike(np.arange(7), s, level="medium")
        assert result[2] < 10.0
        assert result[2] < 5.0

    def test_preserves_smooth_signal(self):
        s = np.linspace(0, 10, 50)
        result = despike(np.arange(50), s, level="medium")
        assert np.allclose(result, s, atol=0.5)

    def test_empty_input(self):
        result = despike(np.array([]), np.array([]), level="heavy")
        assert result.size == 0


# ---------------------------------------------------------------------------
# Concentration
# ---------------------------------------------------------------------------
class TestConcentration:
    def test_ri_concentration(self):
        ri = np.array([0.0, 0.001, 0.002, 0.001, 0.0])
        c = concentration_from_ri(ri, dn_dc=0.2)
        assert np.allclose(c, ri / 0.2)

    def test_ri_zero_dndc_returns_nan(self):
        ri = np.array([0.0, 0.001, 0.002])
        c = concentration_from_ri(ri, dn_dc=0.0)
        assert np.all(np.isnan(c))

    def test_uv_concentration(self):
        a = np.array([0.0, 0.5, 1.0, 0.5, 0.0])
        c = concentration_from_uv(a, extinction=2.0, cell_length=1.0)
        assert np.allclose(c, a / 2.0)

    def test_combine_ri_and_uv(self):
        c_ri = np.array([0.1, 0.2, np.nan, 0.4])
        c_uv = np.array([0.11, 0.22, 0.33, 0.44])
        combined = combine_concentrations(c_ri, c_uv)
        assert np.isclose(combined[0], 0.1)
        assert np.isclose(combined[2], 0.33)

    def test_empty_inputs(self):
        assert concentration_from_ri(np.array([]), 0.2).size == 0
        assert concentration_from_uv(np.array([]), 2.0, 1.0).size == 0


# ---------------------------------------------------------------------------
# Molar mass (Zimm fit)
# ---------------------------------------------------------------------------
class TestMolarMass:
    def test_optical_constant_positive(self):
        K = optical_constant(n0=1.401, dn_dc=0.185, wavelength_nm=658.0)
        assert K > 0
        assert np.isfinite(K)

    def test_zimm_fit_recovers_known_M(self):
        """Synthetic: generate R(theta) for a known M and Rg, fit, recover M."""
        n0 = 1.401
        dn_dc = 0.185
        wavelength_nm = 658.0
        K = optical_constant(n0, dn_dc, wavelength_nm)
        lambda_sol = (wavelength_nm * 1e-9) / n0
        angles = np.array([32.0, 44.0, 57.0, 72.0, 90.0, 108.0, 126.0, 141.0])
        theta_rad = np.deg2rad(angles)
        x = np.sin(theta_rad / 2) ** 2

        M_true = 30000.0
        Rg_true = 15e-9  # 15 nm in metres
        c = 0.003

        P_form = 1.0 - (16.0 * np.pi**2 / (3.0 * lambda_sol**2)) * Rg_true**2 * x
        P_form = np.maximum(P_form, 0.01)
        R_theta = K * c * M_true * P_form

        m_fit, rg_fit = zimm_fit_per_slice(R_theta, c, x, K, lambda_sol)
        assert abs(m_fit - M_true) / M_true < 0.05
        if np.isfinite(rg_fit):
            assert abs(rg_fit - Rg_true) / Rg_true < 0.20

    def test_zimm_fit_degenerate_returns_nan(self):
        R = np.array([0.0, 0.0, 0.0])
        x = np.array([0.1, 0.3, 0.5])
        m, rg = zimm_fit_per_slice(R, 0.001, x, 1e-7, 5e-7)
        assert np.isnan(m)

    def test_compute_molar_mass_shape(self):
        n_slices = 10
        n_angles = 5
        R = np.ones((n_slices, n_angles)) * 1e-6
        c = np.ones(n_slices) * 0.001
        angles = np.array([57.0, 72.0, 90.0, 108.0, 126.0])
        result = compute_molar_mass(R, c, angles, 1.401, 0.185, 658.0)
        assert result["molar_mass"].shape == (n_slices,)
        assert result["radius"].shape == (n_slices,)

    def test_select_angles_keeps_majority(self):
        n0 = 1.401
        dn_dc = 0.185
        wavelength_nm = 658.0
        K = optical_constant(n0, dn_dc, wavelength_nm)
        lambda_sol = (wavelength_nm * 1e-9) / n0
        angles = np.array([32.0, 44.0, 57.0, 72.0, 90.0, 108.0, 126.0, 141.0])
        theta_rad = np.deg2rad(angles)
        x = np.sin(theta_rad / 2) ** 2

        M_true = 30000.0
        Rg_true = 15e-9
        c = 0.003
        P_form = 1.0 - (16.0 * np.pi**2 / (3.0 * lambda_sol**2)) * Rg_true**2 * x
        P_form = np.maximum(P_form, 0.01)
        R_theta = K * c * M_true * P_form

        R_theta[0] *= 0.3
        R_theta[7] *= 0.3

        mask = select_angles(R_theta, c, x, K)
        assert mask.sum() >= 5
        assert not mask[0]
        assert not mask[7]


# ---------------------------------------------------------------------------
# Moments
# ---------------------------------------------------------------------------
class TestMoments:
    def test_known_monodisperse(self):
        c = np.array([1.0, 2.0, 3.0, 2.0, 1.0])
        M = np.full(5, 10000.0)
        m = compute_moments(c, M)
        assert abs(m["Mn"] - 10000) < 1
        assert abs(m["Mw"] - 10000) < 1
        assert abs(m["Mz"] - 10000) < 1
        assert abs(m["Pd"] - 1.0) < 0.01

    def test_known_polydisperse(self):
        c = np.array([1.0, 1.0, 1.0, 1.0])
        M = np.array([5000.0, 10000.0, 20000.0, 40000.0])
        m = compute_moments(c, M)
        Mn_expected = 4 / (1 / 5000 + 1 / 10000 + 1 / 20000 + 1 / 40000)
        Mw_expected = (5000 + 10000 + 20000 + 40000) / 4
        Mz_expected = (5000**2 + 10000**2 + 20000**2 + 40000**2) / (5000 + 10000 + 20000 + 40000)
        assert abs(m["Mn"] - Mn_expected) / Mn_expected < 0.01
        assert abs(m["Mw"] - Mw_expected) / Mw_expected < 0.01
        assert abs(m["Mz"] - Mz_expected) / Mz_expected < 0.01
        assert abs(m["Pd"] - Mw_expected / Mn_expected) / (Mw_expected / Mn_expected) < 0.01

    def test_skips_nan_and_zero(self):
        c = np.array([1.0, 0.0, 2.0, np.nan])
        M = np.array([10000.0, 20000.0, np.nan, 30000.0])
        m = compute_moments(c, M)
        assert np.isfinite(m["Mw"])
        assert m["Mw"] > 0

    def test_empty_returns_nan(self):
        m = compute_moments(np.array([]), np.array([]))
        assert np.isnan(m["Mn"])
        assert np.isnan(m["Mw"])


# ---------------------------------------------------------------------------
# Peak areas
# ---------------------------------------------------------------------------
class TestPeakAreas:
    def test_peak_area_constant(self):
        t = np.array([0.0, 1.0, 2.0, 3.0])
        s = np.array([1.0, 1.0, 1.0, 1.0])
        area = peak_area(t, s)
        assert abs(area - 3.0) < 0.01

    def test_peak_area_triangle(self):
        t = np.array([0.0, 1.0, 2.0])
        s = np.array([0.0, 1.0, 0.0])
        area = peak_area(t, s)
        assert abs(area - 1.0) < 0.01

    def test_recovery_fraction(self):
        r = recovery_fraction(0.05, flow_rate_ml_min=1.0, injected_mass=0.005)
        assert abs(r - (0.05 * 1.0 / 0.005)) < 0.001

    def test_recovery_no_flow_rate(self):
        r = recovery_fraction(0.05, flow_rate_ml_min=None, injected_mass=0.005)
        assert np.isnan(r)

    def test_empty(self):
        assert np.isnan(peak_area(np.array([]), np.array([])))


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------
class TestNormalization:
    def test_1d_signal(self):
        s = np.array([1.0, 2.0, 3.0])
        result = normalize_mals(s, [2.0, 2.0, 2.0], 1e-5)
        assert np.allclose(result, s / 2.0 * 1e-5)

    def test_2d_signal(self):
        s = np.array([[1.0, 2.0], [3.0, 4.0]])
        result = normalize_mals(s, [2.0, 4.0], 1.0)
        assert np.allclose(result[:, 0], [0.5, 1.5])
        assert np.allclose(result[:, 1], [0.5, 1.0])

    def test_zero_norm_coeff_replaced(self):
        s = np.array([1.0, 2.0])
        result = normalize_mals(s, [0.0, 0.0], 1.0)
        assert np.allclose(result, s)


# ---------------------------------------------------------------------------
# Distributions
# ---------------------------------------------------------------------------
class TestDistributions:
    def test_binned_distribution(self):
        M = np.array([10000.0, 20000.0, 30000.0, 40000.0])
        c = np.array([1.0, 2.0, 3.0, 4.0])
        result = binned_distribution(M, c, n_bins=10)
        assert len(result["bin_centers"]) == 10
        assert result["weights"].sum() > 0

    def test_empty(self):
        result = binned_distribution(np.array([]), np.array([]))
        assert len(result["bin_centers"]) == 0


# ---------------------------------------------------------------------------
# Band broadening (stub)
# ---------------------------------------------------------------------------
class TestBandBroadening:
    def test_noop(self):
        s = np.array([1.0, 2.0, 3.0])
        result = apply_band_broadening_correction(np.arange(3), s)
        assert np.allclose(result, s)


# ---------------------------------------------------------------------------
# Dilution
# ---------------------------------------------------------------------------
class TestDilution:
    def test_passthrough_no_factor(self):
        s = np.array([1.0, 2.0, 3.0])
        result = apply_dilution_correction(s, dilution_factor=None)
        assert np.allclose(result, s)

    def test_correction(self):
        s = np.array([0.5, 1.0, 1.5])
        result = apply_dilution_correction(s, dilution_factor=0.5)
        assert np.allclose(result, [1.0, 2.0, 3.0])
