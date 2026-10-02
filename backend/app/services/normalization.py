"""MALS normalization engine.

Divides each MALS detector channel by its normalization coefficient and
multiplies by the instrument calibration constant, converting raw detector
voltages into normalized light-scattering signals.
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def normalize_mals(raw_signal, norm_coeffs, calibration_constant: float):
    """Normalize a multi-angle MALS signal.

    For each detector column *j*:
        normalized[:, j] = raw[:, j] / norm_coeff[j] * calibration_constant

    A norm_coeff of 0 or NaN is replaced by 1.0 (no normalization).

    Parameters
    ----------
    raw_signal : array-like (1-D or 2-D)
        Raw MALS voltages. If 2-D, columns are detector channels.
    norm_coeffs : array-like
        Normalization coefficients (one per column for 2-D input).
    calibration_constant : float
        Instrument calibration constant (Rayleigh ratio per volt).

    Returns
    -------
    np.ndarray
        Normalized signal, same shape as input.
    """
    s = _clean(raw_signal)
    nc = np.asarray(norm_coeffs, dtype=float)
    cal = float(calibration_constant)
    if not np.isfinite(cal) or cal == 0:
        cal = 1.0

    if s.ndim == 1:
        if nc.size == 0:
            return s * cal
        n = min(s.size, nc.size)
        factor = np.ones(n)
        for j in range(n):
            c = nc[j]
            factor[j] = c if np.isfinite(c) and c != 0 else 1.0
        return s[:n] / factor[:n] * cal

    if s.ndim == 2:
        ncols = s.shape[1]
        result = np.empty_like(s)
        for j in range(ncols):
            if j < nc.size and np.isfinite(nc[j]) and nc[j] != 0:
                result[:, j] = s[:, j] / nc[j] * cal
            else:
                result[:, j] = s[:, j] * cal
        return result

    return s
