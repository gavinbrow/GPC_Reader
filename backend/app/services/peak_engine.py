"""Peak detection engine.

Pure NumPy helpers for chromatogram peak detection:
  - threshold-based contiguous-region detection
  - baseline-percent and minimum-width filtering
  - fallback to global max region so a real chromatogram is never empty
"""

from __future__ import annotations

from typing import Optional

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def auto_detect_peaks(
    time,
    signal,
    baseline_percent: float = 2.0,
    min_peak_width: float = 0.05,
    threshold: Optional[float] = None,
) -> list[dict]:
    """Return a list of detected-peak dicts.

    Each dict has keys:
        range_start: float, range_end: float,
        range_number: int, max_value: float, max_index: float

    Algorithm:
      1. Compute a robust baseline as the median of the signal.
      2. Estimate noise via std (fallback to MAD if std is degenerate).
      3. Choose a threshold: explicit, or baseline + max(noise*5, range*pct).
      4. Find contiguous regions where signal > threshold.
      5. Keep regions whose time-width >= min_peak_width.
      6. If nothing survives, fall back to the single most-prominent region
         so auto-detection is never empty on a real chromatogram.
    """
    t = _clean(time)
    s = _clean(signal)
    n = len(t)

    if n == 0 or len(s) == 0:
        return []
    if len(s) != n:
        m = min(len(s), n)
        t = t[:m]
        s = s[:m]
        n = m
    if n == 1:
        return []
    finite = np.isfinite(s)
    if not finite.any():
        return []

    sig = np.where(finite, s, np.nan)
    baseline = float(np.nanmedian(sig))
    if not np.isfinite(baseline):
        baseline = 0.0

    noise = float(np.nanstd(sig))
    if not np.isfinite(noise) or noise == 0:
        mad = float(np.nanmedian(np.abs(sig - baseline)))
        noise = mad if np.isfinite(mad) and mad > 0 else 0.0

    sig_max = float(np.nanmax(sig))
    if not np.isfinite(sig_max):
        return []

    if threshold is not None:
        threshold_val = float(threshold)
    else:
        amp = max(noise * 5.0, (sig_max - baseline) * baseline_percent / 100.0)
        threshold_val = baseline + amp

    mask = np.where(finite, sig > threshold_val, False)
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return _fallback_peak(t, sig, baseline, min_peak_width)

    edges = np.diff(idx)
    breaks = np.flatnonzero(edges > 1)
    starts = np.concatenate(([idx[0]], idx[breaks + 1]))
    ends = np.concatenate((idx[breaks], [idx[-1]]))

    tf = np.where(np.isfinite(t), t, 0.0)

    peaks: list[dict] = []
    for s_i, e_i in zip(starts, ends, strict=False):
        if e_i < s_i:
            continue
        width = float(tf[e_i] - tf[s_i])
        if width < min_peak_width:
            continue
        seg = sig[s_i:e_i + 1]
        seg_finite = seg[np.isfinite(seg)]
        if seg_finite.size == 0:
            continue
        local_max = float(np.nanmax(seg_finite))
        rel_idx = int(np.nanargmax(seg))
        max_idx = s_i + rel_idx
        peaks.append({
            "range_start": float(tf[s_i]),
            "range_end": float(tf[e_i]),
            "range_number": 0,
            "max_value": local_max,
            "max_index": float(tf[max_idx]),
        })

    if not peaks:
        return _fallback_peak(t, sig, baseline, min_peak_width)

    for i, p in enumerate(peaks, start=1):
        p["range_number"] = i
    return peaks


def _fallback_peak(t: np.ndarray, s: np.ndarray, baseline: float, min_peak_width: float) -> list[dict]:
    """Return a single peak spanning the most prominent region above baseline.

    Falls back to the global-max neighbourhood when no region crosses the
    strict threshold, so auto-detection is never empty on a real chromatogram.
    """
    n = len(t)
    if n == 0:
        return []
    finite = np.isfinite(s)
    if not finite.any():
        return []
    tf = np.where(np.isfinite(t), t, 0.0)
    sf = np.where(finite, s, -np.inf)
    max_idx = int(np.argmax(sf))
    max_val = float(sf[max_idx])
    if not np.isfinite(max_val):
        return []

    half = max(1, int(n * 0.01))
    lo = max(0, max_idx - half)
    hi = min(n - 1, max_idx + half)
    width = float(tf[hi] - tf[lo])
    if width < min_peak_width:
        span = max(1, n // 20)
        lo = max(0, max_idx - span)
        hi = min(n - 1, max_idx + span)
    return [{
        "range_start": float(tf[lo]),
        "range_end": float(tf[hi]),
        "range_number": 1,
        "max_value": max_val,
        "max_index": float(tf[max_idx]),
    }]
