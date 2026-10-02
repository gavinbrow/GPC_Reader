"""Physical-units conversion for MALS signals.

Converts raw MALS detector voltages into the Rayleigh ratio R(theta):

    R(theta_i) = raw_signal_i / norm_coeff_i * calibration_constant

This is the excess Rayleigh ratio (cm^-1) at each detection angle.
"""

from __future__ import annotations

import numpy as np

from app.services.normalization import normalize_mals


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def volts_to_rayleigh_ratio(raw_signal, norm_coeffs, calibration_constant: float):
    """Convert raw MALS volts to the Rayleigh ratio R(theta).

    This is identical to ``normalize_mals`` — the calibration constant already
    carries the volts→Rayleigh-ratio conversion factor.

    Parameters
    ----------
    raw_signal : array-like (1-D or 2-D)
        Baseline-subtracted raw MALS voltages.
    norm_coeffs : array-like
        Per-detector normalization coefficients.
    calibration_constant : float
        MALS calibration constant (Rayleigh ratio per volt).

    Returns
    -------
    np.ndarray
        R(theta) values with the same shape as ``raw_signal``.
    """
    return normalize_mals(raw_signal, norm_coeffs, calibration_constant)
