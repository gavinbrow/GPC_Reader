"""Baseline computation and subtraction engine.

Pure NumPy/SciPy helpers for chromatogram baseline modelling:
  - constant, linear, and point-pair baselines
  - auto-baseline via rolling minimum (morphological approach)
  - baseline subtraction

All public functions accept and return NumPy arrays where possible.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from scipy.ndimage import minimum_filter1d


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def _out_of_window_mask(time: np.ndarray, x1: Optional[float], x2: Optional[float]) -> np.ndarray:
    if x1 is None or x2 is None or len(time) == 0:
        return np.ones(len(time), dtype=bool)
    lo, hi = (x1, x2) if x1 <= x2 else (x2, x1)
    return (time < lo) | (time > hi)


def compute_baseline(
    time,
    signal,
    baseline_type: int,
    x1: Optional[float] = None,
    x2: Optional[float] = None,
    y1: Optional[float] = None,
    y2: Optional[float] = None,
):
    """Return (baseline_array, slope, intercept, std_dev).

    baseline_type: 0=constant, 1=linear, 2=point-pair.
    """
    t = _clean(time)
    s = _clean(signal)
    n = len(t)
    if n == 0 or len(s) != n:
        zeros = np.zeros(max(len(s), n))
        return zeros, 0.0, 0.0, 0.0

    if baseline_type == 0:
        mask = _out_of_window_mask(t, x1, x2)
        pts = s[mask]
        pts = pts[np.isfinite(pts)]
        mean = float(np.mean(pts)) if pts.size > 0 else 0.0
        baseline = np.full(n, mean)
        slope = 0.0
        intercept = mean
        residual = s - baseline
        rpts = residual[mask]
        rpts = rpts[np.isfinite(rpts)]
        std_dev = float(np.std(rpts)) if rpts.size > 0 else 0.0
        return baseline, slope, intercept, std_dev

    if baseline_type == 1:
        mask = _out_of_window_mask(t, x1, x2)
        if not mask.any():
            n10 = max(1, n // 10)
            mask = np.zeros(n, dtype=bool)
            mask[:n10] = True
            mask[-n10:] = True
        tx = t[mask]
        sx = s[mask]
        finite = np.isfinite(tx) & np.isfinite(sx)
        tx = tx[finite]
        sx = sx[finite]
        if tx.size >= 2:
            slope, intercept = np.polyfit(tx, sx, 1)
            slope = float(slope)
            intercept = float(intercept)
        else:
            slope = 0.0
            intercept = float(np.mean(sx)) if sx.size > 0 else 0.0
        baseline = slope * t + intercept
        residual = s - baseline
        rpts = residual[mask]
        rpts = rpts[np.isfinite(rpts)]
        std_dev = float(np.std(rpts)) if rpts.size > 0 else 0.0
        return baseline, slope, intercept, std_dev

    if baseline_type == 2:
        if x1 is None or x2 is None or y1 is None or y2 is None:
            zeros = np.zeros(n)
            return zeros, 0.0, 0.0, 0.0
        dx = (x2 - x1)
        if dx == 0:
            zeros = np.zeros(n)
            return zeros, 0.0, 0.0, 0.0
        slope = float((y2 - y1) / dx)
        intercept = float(y1 - slope * x1)
        baseline = slope * t + intercept
        mask = _out_of_window_mask(t, x1, x2)
        residual = s - baseline
        rpts = residual[mask]
        rpts = rpts[np.isfinite(rpts)]
        std_dev = float(np.std(rpts)) if rpts.size > 0 else 0.0
        return baseline, slope, intercept, std_dev

    zeros = np.zeros(n)
    return zeros, 0.0, 0.0, 0.0


def subtract_baseline(signal, baseline):
    """Return signal - baseline."""
    s = _clean(signal)
    b = _clean(baseline)
    if s.size == 0:
        return s
    if b.size != s.size:
        b = np.broadcast_to(b, s.shape) if b.size == 1 else np.zeros_like(s)
    return s - b


def auto_baseline(time, signal, width_std_dev: float = 3.0, num_passes: int = 1):
    """Auto-detect baseline using a rolling-minimum / morphological approach.

    Returns (baseline, slope, intercept, std_dev).
    """
    t = _clean(time)
    s = _clean(signal)
    n = len(t)
    if n == 0 or len(s) != n:
        zeros = np.zeros(max(len(s), n))
        return zeros, 0.0, 0.0, 0.0

    finite = np.isfinite(s)
    if not finite.any():
        return np.zeros(n), 0.0, 0.0, 0.0
    if n == 1:
        return np.array([s[0]]), 0.0, float(s[0]), 0.0

    sig = np.where(finite, s, np.nan)
    std = float(np.nanstd(sig))
    if not np.isfinite(std) or std == 0:
        const = float(np.nanmean(sig))
        baseline = np.full(n, const)
        return baseline, 0.0, const, 0.0

    window = max(1, int(n * (width_std_dev / 100.0)))
    if window > n:
        window = n
    if window % 2 == 0:
        window = max(1, window - 1)

    baseline = minimum_filter1d(sig, size=window, mode="nearest")
    residual = sig - baseline

    for _ in range(max(0, num_passes - 1)):
        rstd = float(np.nanstd(residual))
        if not np.isfinite(rstd) or rstd == 0:
            break
        w = max(1, int(n * (width_std_dev / 100.0)))
        if w > n:
            w = n
        if w % 2 == 0:
            w = max(1, w - 1)
        baseline = minimum_filter1d(sig, size=w, mode="nearest")
        residual = sig - baseline

    tf = np.where(np.isfinite(t), t, 0.0)
    bf = np.where(np.isfinite(baseline), baseline, 0.0)
    if np.count_nonzero(np.isfinite(baseline)) >= 2:
        slope, intercept = np.polyfit(tf, bf, 1)
        slope = float(slope)
        intercept = float(intercept)
    else:
        slope = 0.0
        intercept = float(np.nanmean(baseline)) if np.isfinite(np.nanmean(baseline)) else 0.0

    rpts = residual[np.isfinite(residual)]
    std_dev = float(np.std(rpts)) if rpts.size > 0 else 0.0
    return baseline, slope, intercept, std_dev


def compute_baseline_subtracted_chromatogram(time, signal, baseline_params: dict):
    """Given stored baseline params, recompute the baseline and subtract it.

    Returns (time, subtracted_signal, baseline_array).
    """
    t = _clean(time)
    s = _clean(signal)
    if t.size == 0 or s.size == 0:
        return t, s, np.zeros(max(t.size, s.size))

    baseline, _, _, _ = compute_baseline(
        t,
        s,
        baseline_type=int(baseline_params.get("baseline_type") or 0),
        x1=baseline_params.get("x1"),
        x2=baseline_params.get("x2"),
        y1=baseline_params.get("y1"),
        y2=baseline_params.get("y2"),
    )
    subtracted = subtract_baseline(s, baseline)
    return t, subtracted, baseline
