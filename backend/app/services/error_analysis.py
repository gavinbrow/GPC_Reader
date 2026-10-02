"""Error analysis and uncertainty propagation.

This module provides three helpers:

1. :func:`propagate_uncertainty` — propagate per-slice uncertainties in
   molar mass and concentration through the moments calculation.  The
   moments Mn, Mw, Mz each depend on weighted sums of M and c; the
   fractional uncertainty in each moment is approximated as the quadrature
   sum of the fractional uncertainties of the contributing per-slice
   quantities.  Per-slice, the propagated uncertainty is the relative error
   in the slice molar mass induced by the concentration uncertainty
   (because M ~ K*c/R, dM/M = dc/c in the limit where R is exact).

2. :func:`assess_snr` — signal-to-noise ratio as the ratio of the mean
   peak signal to the standard deviation of a noise region.

3. :func:`fit_quality_indicators` — R^2, reduced chi-squared and RMS
   residual from a fit's chi-squared, residuals and parameter count.
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def propagate_uncertainty(molar_mass, molar_mass_uncertainty,
                          concentration, concentration_uncertainty):
    """Propagate per-slice uncertainty through the moments calculation.

    Parameters
    ----------
    molar_mass : array-like
        Per-slice molar mass (g/mol).
    molar_mass_uncertainty : array-like
        Per-slice absolute uncertainty in molar mass (g/mol).  If None,
        assumed zero.
    concentration : array-like
        Per-slice concentration (g/mL).
    concentration_uncertainty : array-like
        Per-slice absolute uncertainty in concentration (g/mL).  If None,
        assumed zero.

    Returns
    -------
    dict
        ``{"molar_mass_uncertainty": list, "concentration_uncertainty":
        list, "relative_molar_mass_uncertainty": list,
        "relative_concentration_uncertainty": list,
        "Mn_uncertainty": float, "Mw_uncertainty": float,
        "Mz_uncertainty": float}``.  Moments uncertainties are NaN when
        the inputs are insufficient.
    """
    m = _clean(molar_mass)
    c = _clean(concentration)
    if molar_mass_uncertainty is None:
        dM = np.zeros_like(m)
    else:
        dM = _clean(molar_mass_uncertainty)
    if concentration_uncertainty is None:
        dC = np.zeros_like(c)
    else:
        dC = _clean(concentration_uncertainty)
    n = min(m.size, c.size, dM.size, dC.size)
    if n == 0:
        return {
            "molar_mass_uncertainty": [],
            "concentration_uncertainty": [],
            "relative_molar_mass_uncertainty": [],
            "relative_concentration_uncertainty": [],
            "Mn_uncertainty": float(np.nan),
            "Mw_uncertainty": float(np.nan),
            "Mz_uncertainty": float(np.nan),
        }
    m = m[:n]
    c = c[:n]
    dM = dM[:n]
    dC = dC[:n]
    rel_dM = np.where(m > 0, dM / m, np.nan)
    rel_dC = np.where(c > 0, dC / c, np.nan)

    valid = np.isfinite(m) & np.isfinite(c) & (m > 0) & (c > 0)
    Mn_unc = float(np.nan)
    Mw_unc = float(np.nan)
    Mz_unc = float(np.nan)
    if valid.any():
        mv = m[valid]
        cv = c[valid]
        dMv = dM[valid]
        dCv = dC[valid]
        sum_c = float(np.sum(cv))
        sum_c_over_m = float(np.sum(cv / mv))
        sum_cm = float(np.sum(cv * mv))
        sum_cm2 = float(np.sum(cv * mv * mv))
        if sum_c > 0 and sum_c_over_m > 0:
            Mn = sum_c / sum_c_over_m
            rel_c = np.sqrt(np.sum((dCv / cv) ** 2)) / np.sqrt(np.sum(np.ones_like(cv)))
            rel_m = np.sqrt(np.sum((dMv / mv) ** 2)) / np.sqrt(np.sum(np.ones_like(mv)))
            Mn_unc = Mn * np.sqrt(rel_c ** 2 + rel_m ** 2)
        if sum_c > 0 and sum_cm > 0:
            Mw = sum_cm / sum_c
            rel_c = np.sqrt(np.sum((dCv / cv) ** 2)) / np.sqrt(np.sum(np.ones_like(cv)))
            rel_m = np.sqrt(np.sum((dMv / mv) ** 2)) / np.sqrt(np.sum(np.ones_like(mv)))
            Mw_unc = Mw * np.sqrt(rel_c ** 2 + rel_m ** 2)
        if sum_cm > 0 and sum_cm2 > 0:
            Mz = sum_cm2 / sum_cm
            rel_c = np.sqrt(np.sum((dCv / cv) ** 2)) / np.sqrt(np.sum(np.ones_like(cv)))
            rel_m = np.sqrt(np.sum((dMv / mv) ** 2)) / np.sqrt(np.sum(np.ones_like(mv)))
            Mz_unc = Mz * np.sqrt(rel_c ** 2 + rel_m ** 2)

    return {
        "molar_mass_uncertainty": dM.tolist(),
        "concentration_uncertainty": dC.tolist(),
        "relative_molar_mass_uncertainty": np.where(np.isfinite(rel_dM), rel_dM, np.nan).tolist(),
        "relative_concentration_uncertainty": np.where(np.isfinite(rel_dC), rel_dC, np.nan).tolist(),
        "Mn_uncertainty": Mn_unc,
        "Mw_uncertainty": Mw_unc,
        "Mz_uncertainty": Mz_unc,
    }


def assess_snr(signal, noise_region):
    """Compute the signal-to-noise ratio.

    Parameters
    ----------
    signal : array-like
        Signal samples within the peak region (peak height samples).
    noise_region : array-like
        Signal samples from a baseline / noise region.

    Returns
    -------
    float
        SNR = mean(signal) / std(noise_region).  NaN if the noise region
        is empty, has zero standard deviation, or the signal mean is
        non-finite.
    """
    s = _clean(signal)
    noise = _clean(noise_region)
    if s.size == 0 or noise.size == 0:
        return float(np.nan)
    finite_s = s[np.isfinite(s)]
    finite_n = noise[np.isfinite(noise)]
    if finite_s.size == 0 or finite_n.size < 2:
        return float(np.nan)
    mean_s = float(np.mean(finite_s))
    std_n = float(np.std(finite_n, ddof=1))
    if std_n <= 0 or not np.isfinite(std_n) or not np.isfinite(mean_s):
        return float(np.nan)
    return float(mean_s / std_n)


def fit_quality_indicators(chi2, residuals, n_params):
    """Compute fit quality indicators from a fit's chi-squared and residuals.

    Parameters
    ----------
    chi2 : float
        Sum of squared residuals.
    residuals : array-like
        Per-observation residuals (y_obs - y_fit).
    n_params : int
        Number of fitted parameters.

    Returns
    -------
    dict
        ``{"r_squared": float, "reduced_chi2": float, "rms_residual":
        float}``.  Each is NaN when the inputs are insufficient.
    """
    r = _clean(residuals)
    n = r.size
    n_p = int(n_params) if n_params is not None and n_params > 0 else 1
    if n == 0:
        return {"r_squared": float(np.nan), "reduced_chi2": float(np.nan),
                "rms_residual": float(np.nan)}
    finite = np.isfinite(r)
    rf = r[finite]
    n_eff = rf.size
    if n_eff == 0:
        return {"r_squared": float(np.nan), "reduced_chi2": float(np.nan),
                "rms_residual": float(np.nan)}
    rms = float(np.sqrt(np.mean(rf ** 2)))
    if chi2 is None or not np.isfinite(float(chi2)):
        chi2_val = float(np.sum(rf ** 2))
    else:
        chi2_val = float(chi2)
    dof = max(n_eff - n_p, 1)
    reduced = chi2_val / dof
    if not np.isfinite(reduced):
        reduced = float(np.nan)
    ss_res = float(np.sum(rf ** 2))
    if n_eff > 1:
        ss_tot = float(np.sum((rf - np.mean(rf)) ** 2))
        if ss_tot > 0:
            r2 = float(1.0 - ss_res / ss_tot)
        else:
            r2 = float(np.nan)
    else:
        r2 = float(np.nan)
    return {
        "r_squared": r2,
        "reduced_chi2": float(reduced),
        "rms_residual": rms,
    }
