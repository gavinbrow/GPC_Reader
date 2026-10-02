"""Molecular conformation analysis — log(Rg) vs log(M) Mark-Houwink-style plot.

The conformation plot is log(Rg) versus log(M).  For an ideal polymer the
relationship is a power law  Rg = k * M^a, so a linear fit of log(Rg) against
log(M) yields a slope ``a`` (the conformation exponent) and an intercept
``log(k)``.  The slope is interpreted qualitatively:

    a ~ 0.33  →  compact sphere (Rg ~ M^(1/3))
    a ~ 0.50  →  random coil (theta condition, Rg ~ M^(1/2))
    a ~ 1.00  →  rigid rod (Rg ~ M)

Real polymers fall between these ideal limits; the returned
``conformation_class`` string labels the closest ideal class.

The input arrays are the per-slice molar mass (g/mol) and radius of
gyration (nm) stored in the ``zimm_slice`` computed-data rows by the
procedure orchestrator.
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def _classify_slope(slope: float) -> str:
    if not np.isfinite(slope):
        return "insufficient data"
    if slope <= 0.417:
        return "sphere"
    if slope <= 0.75:
        return "random coil"
    return "rod"


def compute_conformation(molar_mass, radius, concentration=None):
    """Compute the conformation plot (log Rg vs log M) and slope interpretation.

    Parameters
    ----------
    molar_mass : array-like
        Per-slice molar mass (g/mol).
    radius : array-like
        Per-slice radius of gyration (nm).
    concentration : array-like, optional
        Per-slice concentration (g/mL).  When supplied it is used only to
        filter to eluting slices (c > 0); the conformation fit itself is
        independent of concentration.

    Returns
    -------
    dict
        ``{"log_m": list, "log_rg": list, "slope": float, "intercept": float,
        "r_squared": float, "n_points": int, "conformation_class": str}``.
        When fewer than three valid points are available the slope,
        intercept and r_squared are NaN and the class is ``"insufficient
        data"``; the (possibly empty) log arrays are still returned.
    """
    m = _clean(molar_mass)
    rg = _clean(radius)
    n = min(m.size, rg.size)
    if n == 0:
        return {
            "log_m": [],
            "log_rg": [],
            "slope": float(np.nan),
            "intercept": float(np.nan),
            "r_squared": float(np.nan),
            "n_points": 0,
            "conformation_class": "insufficient data",
        }
    m = m[:n]
    rg = rg[:n]
    valid = np.isfinite(m) & np.isfinite(rg) & (m > 0) & (rg > 0)
    if concentration is not None:
        c = _clean(concentration)
        c = c[:n] if c.size >= n else c
        if c.size == n:
            valid &= np.isfinite(c) & (c > 0)
    n_valid = int(valid.sum())
    if n_valid < 3:
        log_m: list = []
        log_rg: list = []
        if n_valid > 0:
            log_m = np.log10(m[valid]).tolist()
            log_rg = np.log10(rg[valid]).tolist()
        return {
            "log_m": log_m,
            "log_rg": log_rg,
            "slope": float(np.nan),
            "intercept": float(np.nan),
            "r_squared": float(np.nan),
            "n_points": n_valid,
            "conformation_class": "insufficient data",
        }

    log_m_arr = np.log10(m[valid])
    log_rg_arr = np.log10(rg[valid])
    try:
        coeffs = np.polyfit(log_m_arr, log_rg_arr, 1)
    except Exception:
        return {
            "log_m": log_m_arr.tolist(),
            "log_rg": log_rg_arr.tolist(),
            "slope": float(np.nan),
            "intercept": float(np.nan),
            "r_squared": float(np.nan),
            "n_points": n_valid,
            "conformation_class": "insufficient data",
        }
    slope = float(coeffs[0])
    intercept = float(coeffs[1])
    rg_pred = slope * log_m_arr + intercept
    ss_res = float(np.sum((log_rg_arr - rg_pred) ** 2))
    ss_tot = float(np.sum((log_rg_arr - np.mean(log_rg_arr)) ** 2))
    r_squared = float(1.0 - ss_res / ss_tot) if ss_tot > 0 else float(np.nan)
    if not np.isfinite(r_squared):
        r_squared = float(np.nan)
    return {
        "log_m": log_m_arr.tolist(),
        "log_rg": log_rg_arr.tolist(),
        "slope": slope,
        "intercept": intercept,
        "r_squared": r_squared,
        "n_points": n_valid,
        "conformation_class": _classify_slope(slope),
    }
