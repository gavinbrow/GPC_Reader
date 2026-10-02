"""Determine the UV extinction coefficient from RI data.

When MALS, UV, and RI detectors are all present, the UV extinction coefficient
can be determined by comparing the UV and RI peak areas (both proportional to
concentration for a well-separated peak):

    epsilon = (A_peak_area / l) / c_peak_area

where ``c_peak_area`` is the integral of the RI-derived concentration and
``A_peak_area`` is the integral of the UV absorbance.
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def extinction_from_ri(time, ri_signal, uv_signal, dn_dc: float, cell_length: float):
    """Estimate the UV extinction coefficient from RI and UV peak areas.

    Parameters
    ----------
    time : array-like
        Time axis (minutes) common to both signals.
    ri_signal : array-like
        Baseline-subtracted RI signal (delta_RI, dimensionless).
    uv_signal : array-like
        Baseline-subtracted UV absorbance (AU).
    dn_dc : float
        Specific refractive-index increment (mL/g).
    cell_length : float
        UV cell path length (cm).

    Returns
    -------
    float
        Estimated UV extinction coefficient (mL/(g*cm)), or NaN if it cannot
        be determined.
    """
    t = _clean(time)
    ri = _clean(ri_signal)
    uv = _clean(uv_signal)
    if t.size < 2 or ri.size < 2 or uv.size < 2:
        return np.nan

    n = min(t.size, ri.size, uv.size)
    t = t[:n]
    ri = ri[:n]
    uv = uv[:n]

    if dn_dc is None or dn_dc <= 0 or cell_length <= 0:
        return np.nan

    finite = np.isfinite(ri) & np.isfinite(uv) & np.isfinite(t)
    if finite.sum() < 2:
        return np.nan

    if t.size > 1:
        dt = float(np.median(np.diff(t[finite])))
    else:
        dt = 1.0
    if dt <= 0:
        dt = 1.0

    ri_area = float(np.nansum(ri[finite] * dt))
    uv_area = float(np.nansum(uv[finite] * dt))
    if ri_area <= 0 or uv_area <= 0:
        return np.nan

    c_area = ri_area / float(dn_dc)
    if c_area <= 0:
        return np.nan

    epsilon = (uv_area / float(cell_length)) / c_area
    if not np.isfinite(epsilon) or epsilon <= 0:
        return np.nan
    return float(epsilon)
