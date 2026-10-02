"""Despiking engine — median filter with MAD threshold.

Pure NumPy helpers for removing spike artifacts from chromatogram signals.
Spike levels: off (no filtering), light, medium, heavy — mapped to increasing
window sizes and thresholds.

All public functions accept and return NumPy arrays where possible.
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


_LEVEL_PARAMS = {
    "off": {"window": 1, "threshold": 0.0},
    "light": {"window": 3, "threshold": 5.0},
    "medium": {"window": 5, "threshold": 4.0},
    "heavy": {"window": 7, "threshold": 3.0},
}


def despike(time, signal, level: str = "off"):
    """Apply median-filter despiking with a MAD-based threshold.

    Parameters
    ----------
    time : array-like
        Time axis (minutes). Currently informational; filtering is index-based.
    signal : array-like
        Input signal (1-D).
    level : str
        One of "off", "light", "medium", "heavy".

    Returns
    -------
    np.ndarray
        Despiked signal (same length as input). Spikes above the MAD threshold
        are replaced by the local median.
    """
    s = _clean(signal)
    n = s.size
    if n == 0 or level == "off" or level not in _LEVEL_PARAMS:
        return s

    params = _LEVEL_PARAMS[level]
    window = params["window"]
    threshold = params["threshold"]
    if window < 3 or threshold <= 0:
        return s

    med = np.zeros(n)
    half = window // 2
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        seg = s[lo:hi]
        finite = seg[np.isfinite(seg)]
        if finite.size > 0:
            med[i] = float(np.median(finite))
        else:
            med[i] = np.nan

    residual = s - med
    finite_mask = np.isfinite(residual)
    if not finite_mask.any():
        return s
    valid_res = residual[finite_mask]
    abs_res = np.abs(valid_res)
    mad = float(np.median(abs_res))
    if mad <= 0:
        sorted_abs = np.sort(abs_res)
        if sorted_abs.size >= 2:
            p75 = float(sorted_abs[int(0.75 * (sorted_abs.size - 1))])
            mad = p75 if p75 > 0 else float(np.mean(abs_res))
        else:
            mad = float(np.mean(abs_res)) if abs_res.size > 0 else 0.0
    if mad <= 0 or not np.isfinite(mad):
        return s

    spike_mask = np.abs(residual) > threshold * mad
    result = s.copy()
    result[spike_mask] = med[spike_mask]
    return result
