"""Conventional and universal column calibration and column-profile metrics.

A SEC column is calibrated by injecting narrow polydispersity standards of
known molar mass and recording their elution volume (or time).  The
calibration curve is the relationship between elution volume and molar
mass, expressed in log space:

    log(M) = a0 + a1*V + a2*V^2 + ...           (conventional)

With a viscometer, the universal (Benoit) calibration uses the hydrodynamic
volume:

    log(M * [eta]) = a0 + a1*V + a2*V^2 + ...   (universal)

The polynomial coefficients are obtained by least-squares fit of
``log(M)`` (or ``log(M*[eta])``) versus elution volume.  The fit quality is
reported as the coefficient of determination ``r_squared``.

Column profile metrics characterise peak shape and separation performance:

    * Plate count (USP):    N = 5.54 * (tR / W_half)^2
    * Asymmetry factor:     As = (tR - t_front10) / (t_back10 - tR)
    * Tailing factor (USP): T = W_0.05 / (2 * f)
    * Resolution (two peaks): Rs = 2*(tR2 - tR1) / (W1 + W2)
"""

from __future__ import annotations

from typing import Optional

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def _r_squared(y, y_fit) -> float:
    ss_res = float(np.sum((y - y_fit) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    if ss_tot <= 0:
        return float(np.nan)
    r2 = 1.0 - ss_res / ss_tot
    return float(r2) if np.isfinite(r2) else float(np.nan)


def fit_calibration_curve(elution_volumes, molar_masses,
                          viscometer_iv=None, degree: int = 3):
    """Fit a conventional or universal column-calibration curve.

    Parameters
    ----------
    elution_volumes : array-like
        Elution volumes (mL) or times (min) of the calibration standards.
    molar_masses : array-like
        Peak molar masses of the standards (g/mol).
    viscometer_iv : array-like, optional
        Intrinsic viscosities [eta] of the standards (mL/g).  When
        supplied a universal calibration is fit on ``log(M*[eta])``;
        otherwise a conventional calibration on ``log(M)`` is used.
    degree : int
        Polynomial degree for the fit (default 3).

    Returns
    -------
    dict
        ``{"elution_volume": list, "log_m": list, "fit_log_m": list,
        "coefficients": list, "r_squared": float, "calibration_type":
        "conventional"|"universal"}``.
    """
    v = _clean(elution_volumes)
    m = _clean(molar_masses)
    iv = _clean(viscometer_iv) if viscometer_iv is not None else None
    n = min(v.size, m.size)
    if iv is not None:
        n = min(n, iv.size)
    if n < 2:
        return {
            "elution_volume": [],
            "log_m": [],
            "fit_log_m": [],
            "coefficients": [],
            "r_squared": float(np.nan),
            "calibration_type": "universal" if iv is not None else "conventional",
        }
    v = v[:n]
    m = m[:n]
    if iv is not None:
        iv = iv[:n]
        valid = np.isfinite(v) & np.isfinite(m) & np.isfinite(iv) & (m > 0) & (iv > 0)
    else:
        valid = np.isfinite(v) & np.isfinite(m) & (m > 0)
    if valid.sum() < 2:
        return {
            "elution_volume": [],
            "log_m": [],
            "fit_log_m": [],
            "coefficients": [],
            "r_squared": float(np.nan),
            "calibration_type": "universal" if iv is not None else "conventional",
        }
    vv = v[valid]
    mv = m[valid]
    if iv is not None:
        ivv = iv[valid]
        y = np.log10(mv * ivv)
        cal_type = "universal"
    else:
        y = np.log10(mv)
        cal_type = "conventional"
    deg = max(1, min(int(degree), int(valid.sum()) - 1))
    try:
        coeffs = np.polyfit(vv, y, deg)
    except Exception:
        return {
            "elution_volume": vv.tolist(),
            "log_m": y.tolist(),
            "fit_log_m": [],
            "coefficients": [],
            "r_squared": float(np.nan),
            "calibration_type": cal_type,
        }
    fit_y = np.polyval(coeffs, vv)
    r2 = _r_squared(y, fit_y)
    return {
        "elution_volume": vv.tolist(),
        "log_m": y.tolist(),
        "fit_log_m": fit_y.tolist(),
        "coefficients": coeffs.tolist(),
        "r_squared": r2,
        "calibration_type": cal_type,
    }


def apply_calibration(elution_volumes, coefficients):
    """Evaluate a fitted calibration curve at the given elution volumes.

    Parameters
    ----------
    elution_volumes : array-like
        Elution volumes (or times) at which to evaluate the calibration.
    coefficients : array-like
        Polynomial coefficients (highest power first), as returned by
        :func:`fit_calibration_curve`.

    Returns
    -------
    np.ndarray
        Molar masses (g/mol) at each elution volume.  NaN where the input
        is non-finite or the coefficients are missing.
    """
    v = _clean(elution_volumes)
    coeffs = np.asarray(coefficients, dtype=float)
    if v.size == 0 or coeffs.size == 0:
        return np.array([])
    log_m = np.polyval(coeffs, v)
    m = 10.0 ** log_m
    m = np.where(np.isfinite(v), m, np.nan)
    return m


def _width_at_height(time, signal, fraction: float) -> Optional[tuple[float, float, float]]:
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


def column_profile(time, signal, peak_start=None, peak_end=None):
    """Compute column profile metrics for a single chromatographic peak.

    Parameters
    ----------
    time : array-like
        Elution time axis (minutes).
    signal : array-like
        Detector signal (e.g. RI concentration or MALS).
    peak_start, peak_end : float, optional
        Peak integration bounds (minutes).  When supplied the signal is
        trimmed to this window before computing metrics.

    Returns
    -------
    dict
        ``{"retention_time": float, "peak_max": float, "width_baseline":
        float, "width_half_height": float, "asymmetry_factor": float,
        "tailing_factor": float, "plate_count": float, "resolution":
        Optional[float]}``.  ``resolution`` is always None here (it
        requires two peaks); use :func:`resolution_between_peaks` in
        :mod:`peak_statistics`.
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

    half = _width_at_height(tf, sf, 0.5)
    w_half = half[0] if half is not None else np.nan
    tenth = _width_at_height(tf, sf, 0.1)
    if tenth is not None:
        t_front10 = tenth[1]
        t_back10 = tenth[2]
        if tR > t_front10 and (t_back10 - tR) > 0:
            asym = (t_back10 - tR) / (tR - t_front10)
        else:
            asym = np.nan
    else:
        asym = np.nan
    fifth = _width_at_height(tf, sf, 0.05)
    if fifth is not None:
        w_05 = fifth[0]
        t_front5 = fifth[1]
        if (tR - t_front5) > 0:
            f = tR - t_front5
            tailing = w_05 / (2.0 * f)
        else:
            tailing = np.nan
    else:
        tailing = np.nan
    if tf.size >= 2:
        w_base = float(tf[-1] - tf[0])
    else:
        w_base = float(np.nan)

    if np.isfinite(w_half) and w_half > 0 and tR > 0:
        plate = 5.54 * (tR / w_half) ** 2
    else:
        plate = np.nan

    return {
        "retention_time": tR,
        "peak_max": peak_val,
        "width_baseline": float(w_base) if np.isfinite(w_base) else float(np.nan),
        "width_half_height": float(w_half) if np.isfinite(w_half) else float(np.nan),
        "asymmetry_factor": float(asym) if np.isfinite(asym) else float(np.nan),
        "tailing_factor": float(tailing) if np.isfinite(tailing) else float(np.nan),
        "plate_count": float(plate) if np.isfinite(plate) else float(np.nan),
        "resolution": None,
    }


def resolution_between_peaks(t1, t2, w1, w2):
    """Chromatographic resolution between two peaks.

    Parameters
    ----------
    t1, t2 : float
        Retention times of the two peaks (minutes).
    w1, w2 : float
        Baseline peak widths (minutes).

    Returns
    -------
    float
        Resolution Rs = 2*(t2 - t1) / (w1 + w2).  NaN if widths are
        non-positive or non-finite.
    """
    vals = [t1, t2, w1, w2]
    if any(v is None or not np.isfinite(v) for v in vals):
        return float(np.nan)
    if w1 <= 0 or w2 <= 0:
        return float(np.nan)
    return float(2.0 * (t2 - t1) / (w1 + w2))
