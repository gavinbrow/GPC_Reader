"""Peak statistics — plate count, asymmetry, tailing, resolution.

These are the standard USP chromatographic figures of merit, computed for
each detector peak within an integration window:

    * Plate count (N):     N = 5.54 * (tR / W_half)^2
    * Asymmetry factor:    As = (t_back10 - tR) / (tR - t_front10)
    * Tailing factor:      T  = W_0.05 / (2 * f)
    * Peak width:          baseline width and width at half height

``resolution_between_peaks`` is a standalone helper that returns the USP
resolution between two peaks from their retention times and baseline
widths.
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def _width_at_height(time, signal, fraction: float):
    """Return (width, t_front, t_back) at ``fraction`` of peak height."""
    t = _clean(time)
    s = _clean(signal)
    n = min(t.size, s.size)
    if n < 3:
        return None
    t = t[:n]
    s = s[:n]
    finite = np.isfinite(t) & np.isfinite(s)
    if finite.sum() < 3:
        return None
    tf = t[finite]
    sf = s[finite]
    peak_idx = int(np.argmax(sf))
    peak_val = sf[peak_idx]
    if peak_val <= 0 or not np.isfinite(peak_val):
        return None
    tR = float(tf[peak_idx])
    threshold = fraction * peak_val
    front = tf[:peak_idx + 1]
    front_s = sf[:peak_idx + 1]
    front_mask = front_s <= threshold
    if front_mask.any():
        i_front = int(np.flatnonzero(front_mask)[-1])
        if i_front + 1 < front.size:
            t_front = float(np.interp(threshold,
                                      [front_s[i_front], front_s[i_front + 1]],
                                      [front[i_front], front[i_front + 1]]))
        else:
            t_front = float(front[i_front])
    else:
        t_front = float(front[0])
    back = tf[peak_idx:]
    back_s = sf[peak_idx:]
    back_mask = back_s <= threshold
    if back_mask.any():
        i_back = int(np.flatnonzero(back_mask)[0])
        if i_back > 0:
            t_back = float(np.interp(threshold,
                                     [back_s[i_back - 1], back_s[i_back]],
                                     [back[i_back - 1], back[i_back]]))
        else:
            t_back = float(back[i_back])
    else:
        t_back = float(back[-1])
    width = t_back - t_front
    return width, t_front, t_back


def compute_peak_statistics(time, signal, peak_start=None, peak_end=None):
    """Compute standard chromatographic peak statistics for a single peak.

    Parameters
    ----------
    time : array-like
        Elution time axis (minutes).
    signal : array-like
        Detector signal for the peak (e.g. RI or MALS).
    peak_start, peak_end : float, optional
        Peak integration bounds (minutes).  When supplied the signal is
        trimmed to this window before computing metrics.

    Returns
    -------
    dict
        ``{"retention_time": float, "peak_max": float, "width_baseline":
        float, "width_half_height": float, "asymmetry_factor": float,
        "tailing_factor": float, "plate_count": float,
        "resolution": Optional[float]}``.
    """
    t = _clean(time)
    s = _clean(signal)
    n = min(t.size, s.size)
    if n == 0:
        return {
            "retention_time": float(np.nan),
            "peak_max": float(np.nan),
            "width_baseline": float(np.nan),
            "width_half_height": float(np.nan),
            "asymmetry_factor": float(np.nan),
            "tailing_factor": float(np.nan),
            "plate_count": float(np.nan),
            "resolution": None,
        }
    t = t[:n]
    s = s[:n]
    if peak_start is not None and peak_end is not None:
        mask = (t >= float(peak_start)) & (t <= float(peak_end))
        if mask.sum() < 3:
            mask = np.ones(n, dtype=bool)
    else:
        mask = np.ones(n, dtype=bool)
    tf = t[mask]
    sf = s[mask]
    finite = np.isfinite(tf) & np.isfinite(sf)
    if finite.sum() < 3:
        return {
            "retention_time": float(np.nan),
            "peak_max": float(np.nan),
            "width_baseline": float(np.nan),
            "width_half_height": float(np.nan),
            "asymmetry_factor": float(np.nan),
            "tailing_factor": float(np.nan),
            "plate_count": float(np.nan),
            "resolution": None,
        }
    tf = tf[finite]
    sf = sf[finite]
    sf = sf - np.nanmin(sf)
    peak_idx = int(np.argmax(sf))
    peak_val = float(sf[peak_idx])
    tR = float(tf[peak_idx])
    w_base = float(tf[-1] - tf[0])

    half = _width_at_height(tf, sf, 0.5)
    w_half = half[0] if half is not None else float(np.nan)
    tenth = _width_at_height(tf, sf, 0.1)
    if tenth is not None:
        t_front10 = tenth[1]
        t_back10 = tenth[2]
        if tR > t_front10 and (t_back10 - tR) > 0:
            asym = float((t_back10 - tR) / (tR - t_front10))
        else:
            asym = float(np.nan)
    else:
        asym = float(np.nan)
    fifth = _width_at_height(tf, sf, 0.05)
    if fifth is not None:
        w_05 = fifth[0]
        t_front5 = fifth[1]
        if (tR - t_front5) > 0:
            f = tR - t_front5
            tailing = float(w_05 / (2.0 * f))
        else:
            tailing = float(np.nan)
    else:
        tailing = float(np.nan)
    if np.isfinite(w_half) and w_half > 0 and tR > 0:
        plate = float(5.54 * (tR / w_half) ** 2)
    else:
        plate = float(np.nan)
    return {
        "retention_time": tR,
        "peak_max": peak_val,
        "width_baseline": w_base,
        "width_half_height": float(w_half) if np.isfinite(w_half) else float(np.nan),
        "asymmetry_factor": asym,
        "tailing_factor": tailing,
        "plate_count": plate,
        "resolution": None,
    }


def resolution_between_peaks(t1, t2, w1, w2):
    """Compute the chromatographic resolution between two peaks.

    Parameters
    ----------
    t1, t2 : float
        Retention times of the first and second peaks (minutes).
    w1, w2 : float
        Baseline widths of the two peaks (minutes).

    Returns
    -------
    float
        Resolution Rs = 2*(t2 - t1) / (w1 + w2).  NaN if widths are
        non-positive or any value is non-finite.
    """
    vals = [t1, t2, w1, w2]
    if any(v is None or not np.isfinite(v) for v in vals):
        return float(np.nan)
    if w1 <= 0 or w2 <= 0:
        return float(np.nan)
    return float(2.0 * (t2 - t1) / (w1 + w2))
