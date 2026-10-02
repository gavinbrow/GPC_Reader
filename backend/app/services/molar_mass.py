"""Molar-mass calculation via Zimm / Debye / Berry fits.

Per-slice fit of the angular light-scattering equation.  Three fit models are
supported (selected via the ``fit_model`` argument to
:func:`compute_molar_mass`):

**Zimm** (fit_model = 0, the default and historical path):

    K*c / R(theta) = 1/M * (1 + (16*pi^2 / (3*lambda_sol^2)) * Rg^2 * sin^2(theta/2)) + 2*A2*c

With A2 = 0 (negligible at low c) this reduces to a linear fit:

    y = a + b*x,   where  y = K*c/R(theta),   x = sin^2(theta/2)

    M = 1/a
    Rg = sqrt( b * M * 3 * lambda_sol^2 / (16*pi^2) )

**Debye** (fit_model = 1):

    R(theta) / (K*c) = M * (1 - (16*pi^2 / (3*lambda_sol^2)) * Rg^2 * sin^2(theta/2)) - 2*A2*c*M^2

    y = R(theta)/(K*c),  x = sin^2(theta/2)
    M = a (intercept)
    Rg = sqrt( (-b/a) * 3 * lambda_sol^2 / (16*pi^2) )   (slope is negative)

**Berry** (fit_model = 2):

    sqrt(K*c / R(theta)) = 1/sqrt(M) * (1 + (8*pi^2 / (3*lambda_sol^2)) * Rg^2 * sin^2(theta/2)) + A2*c*sqrt(M)

    y = sqrt(K*c/R(theta)),  x = sin^2(theta/2)
    sqrt(M) = 1/a  →  M = 1/a^2
    Rg = sqrt( b / a * 3 * lambda_sol^2 / (8*pi^2) )

All three models support 1st-order (linear in x) and 2nd-order (quadratic in x)
fits via the ``fit_degree`` argument (1 or 2; default 1).  For 2nd-order fits
M is always taken from the intercept ``a``; Rg is taken from the linear
coefficient ``b`` using the same formula as the 1st-order case.  The
2nd-order coefficient captures curvature / non-ideality.

A condition-number check on the design matrix plus a NaN fallback guards every
per-slice fit, so degenerate angle distributions never propagate NaNs through
the moments calculation.

Angles are selected via an iterative leave-one-out residual test at the peak
center, rejecting systematic outliers (typically the extreme low/high angles).
The selected angle mask is then applied to all slices for consistency.  Angle
selection always uses the Zimm form (the historical behaviour) so the chosen
detectors are stable across models.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

N_A = 6.02214076e23


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def optical_constant(n0: float, dn_dc: float, wavelength_nm: float) -> float:
    """Compute the optical constant K.

    K = 4 * pi^2 * n0^2 * (dn/dc)^2 / (N_A * lambda_0^4)

    Uses CGS units internally: lambda in cm, dn/dc in mL/g — so K*c*M is
    dimensionless (the Rayleigh ratio) when c is in g/mL and M in g/mol.

    Parameters
    ----------
    n0 : float
        Solvent refractive index.
    dn_dc : float
        Specific refractive-index increment (mL/g).
    wavelength_nm : float
        Laser wavelength in nanometres.

    Returns
    -------
    float
        Optical constant K.
    """
    lambda_cm = float(wavelength_nm) * 1e-7
    if lambda_cm <= 0 or n0 <= 0 or dn_dc <= 0:
        return np.nan
    return 4.0 * np.pi**2 * n0**2 * dn_dc**2 / (N_A * lambda_cm**4)


def select_angles(R_peak, c_peak, x_all, K, min_angles: int = 5, max_remove: int = 3,
                  improvement_ratio: float = 0.8):
    """Globally select detector angles by iterative leave-one-out at one slice.

    At each round, the angle whose removal most reduces the fit RMS is dropped,
    provided the improvement exceeds ``improvement_ratio`` (i.e. new RMS < old
    RMS * ratio).  This rejects systematically deviating detectors (typically
    the extreme low and high angles) and keeps the rest for all slices.

    Parameters
    ----------
    R_peak : array-like
        Rayleigh ratios at the reference (peak-center) slice, one per angle.
    c_peak : float
        Concentration at the reference slice.
    x_all : array-like
        sin^2(theta/2) for each angle.
    K : float
        Optical constant.
    min_angles : int
        Minimum number of angles to retain.
    max_remove : int
        Maximum number of angles to remove.
    improvement_ratio : float
        Remove an angle only if new_rms < old_rms * improvement_ratio.

    Returns
    -------
    np.ndarray (bool)
        Boolean mask over the angle axis (True = keep).
    """
    R = _clean(R_peak)
    x = np.asarray(x_all, dtype=float)
    n = x.size
    keep = np.ones(n, dtype=bool)
    if n <= min_angles:
        return keep

    for _ in range(max_remove):
        if keep.sum() <= min_angles:
            break
        y = K * c_peak / R
        finite = np.isfinite(y) & np.isfinite(x) & (R > 0) & keep
        if finite.sum() < 3:
            break
        try:
            coeffs = np.polyfit(x[finite], y[finite], 1)
            y_fit = np.polyval(coeffs, x[finite])
            current_rms = float(np.sqrt(np.mean((y[finite] - y_fit) ** 2)))
        except Exception:
            break
        if not np.isfinite(current_rms) or current_rms == 0:
            break

        best_rms = np.inf
        best_remove = -1
        kept_idx = np.where(keep)[0]
        for k in kept_idx:
            test = keep.copy()
            test[k] = False
            tf = finite & test
            if tf.sum() < 2:
                continue
            try:
                c2 = np.polyfit(x[tf], y[tf], 1)
                yf2 = np.polyval(c2, x[tf])
                r2 = float(np.sqrt(np.mean((y[tf] - yf2) ** 2)))
                if r2 < best_rms:
                    best_rms = r2
                    best_remove = k
            except Exception:
                continue
        if best_remove < 0 or best_rms >= current_rms * improvement_ratio:
            break
        keep[best_remove] = False

    return keep


def _cond_check(xf, degree):
    if degree == 1:
        design = np.vstack([np.ones_like(xf), xf]).T
    else:
        design = np.vstack([np.ones_like(xf), xf, xf ** 2]).T
    try:
        return float(np.linalg.cond(design))
    except Exception:
        return np.inf


def _fit_quality(yf, y_fit, degree):
    n = int(yf.size)
    n_params = degree + 1
    resid = yf - y_fit
    chi2 = float(np.sum(resid ** 2)) / max(n - n_params, 1)
    return chi2, resid


def zimm_fit_per_slice(R_row, c, x, K, lambda_sol, fit_degree: int = 1,
                       return_quality: bool = False):
    """Single-slice Zimm fit (1st or 2nd order).

    With ``fit_degree=1`` and ``return_quality=False`` (the defaults) this
    function is numerically identical to the original Phase 3a implementation.

    Parameters
    ----------
    R_row : array-like
        Rayleigh ratios at the kept angles for this slice.
    c : float
        Concentration at this slice.
    x : array-like
        sin^2(theta/2) at the kept angles.
    K, lambda_sol : float
        Optical constant and wavelength in solution.
    fit_degree : int
        1 (linear, default) or 2 (quadratic).
    return_quality : bool
        If True, return ``(M, Rg, quality)`` where ``quality`` is a dict with
        ``chi2``, ``residuals`` and ``n_angles_used``.

    Returns
    -------
    (M, Rg) or (M, Rg, quality)
        M in g/mol, Rg in metres, or (NaN, NaN) on failure.
    """
    R = _clean(R_row)
    y = K * c / R
    finite = np.isfinite(y) & np.isfinite(x) & (R > 0)
    n_need = 3 if fit_degree == 2 else 2
    if finite.sum() < n_need:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    xf = x[finite]
    yf = y[finite]
    if _cond_check(xf, fit_degree) > 1e10:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    try:
        coeffs = np.polyfit(xf, yf, fit_degree)
    except Exception:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    a = coeffs[fit_degree]
    b = coeffs[fit_degree - 1]
    if a <= 0 or not np.isfinite(a):
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    M = 1.0 / a
    Rg2 = b * M * 3.0 * lambda_sol ** 2 / (16.0 * np.pi ** 2)
    if not np.isfinite(Rg2) or Rg2 < 0:
        Rg = np.nan
    else:
        Rg = float(np.sqrt(Rg2))
    if return_quality:
        y_fit = np.polyval(coeffs, xf)
        chi2, resid = _fit_quality(yf, y_fit, fit_degree)
        return M, Rg, {"chi2": chi2, "residuals": resid,
                       "n_angles_used": int(finite.sum())}
    return M, Rg


def debye_fit_per_slice(R_row, c, x, K, lambda_sol, fit_degree: int = 1,
                        return_quality: bool = False):
    """Single-slice Debye fit (1st or 2nd order).

    Debye form:  y = R(theta)/(K*c) = M - M*(16*pi^2/(3*lambda^2))*Rg^2*x - 2*A2*c*M^2

    With A2 = 0:  y = a + b*x  where a = M, b = -M*(16*pi^2/(3*lambda^2))*Rg^2.

        M = a
        Rg = sqrt( (-b/a) * 3 * lambda_sol^2 / (16*pi^2) )    (b is negative)

    For 2nd-order, M is taken from the intercept ``a`` and Rg from the linear
    coefficient ``b`` (same formula).  A2 is not yet read from the peak in this
    per-slice path (kept for a future iteration); the c-dependent term is
    dropped as for Zimm.
    """
    R = _clean(R_row)
    if c <= 0 or K <= 0:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": 0}
        return np.nan, np.nan
    y = R / (K * c)
    finite = np.isfinite(y) & np.isfinite(x) & (R > 0)
    n_need = 3 if fit_degree == 2 else 2
    if finite.sum() < n_need:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    xf = x[finite]
    yf = y[finite]
    if _cond_check(xf, fit_degree) > 1e10:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    try:
        coeffs = np.polyfit(xf, yf, fit_degree)
    except Exception:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    a = coeffs[fit_degree]
    b = coeffs[fit_degree - 1]
    if a <= 0 or not np.isfinite(a):
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    M = a
    Rg2 = (-b / a) * 3.0 * lambda_sol ** 2 / (16.0 * np.pi ** 2)
    if not np.isfinite(Rg2) or Rg2 < 0:
        Rg = np.nan
    else:
        Rg = float(np.sqrt(Rg2))
    if return_quality:
        y_fit = np.polyval(coeffs, xf)
        chi2, resid = _fit_quality(yf, y_fit, fit_degree)
        return M, Rg, {"chi2": chi2, "residuals": resid,
                       "n_angles_used": int(finite.sum())}
    return M, Rg


def berry_fit_per_slice(R_row, c, x, K, lambda_sol, fit_degree: int = 1,
                        return_quality: bool = False):
    """Single-slice Berry fit (1st or 2nd order).

    Berry form:  y = sqrt(K*c/R(theta)) = 1/sqrt(M) * (1 + (8*pi^2/(3*lambda^2))*Rg^2*x) + A2*c*sqrt(M)

    With A2 = 0:  y = a + b*x  where a = 1/sqrt(M), b = (8*pi^2/(3*lambda^2))*Rg^2 / sqrt(M).

        sqrt(M) = 1/a  →  M = 1/a^2
        Rg = sqrt( b / a * 3 * lambda_sol^2 / (8*pi^2) )

    For 2nd-order, M is taken from the intercept (1/a^2) and Rg from the linear
    coefficient ``b``.
    """
    R = _clean(R_row)
    if c <= 0 or K <= 0:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": 0}
        return np.nan, np.nan
    ratio = K * c / R
    finite = np.isfinite(ratio) & np.isfinite(x) & (ratio > 0)
    n_need = 3 if fit_degree == 2 else 2
    if finite.sum() < n_need:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    xf = x[finite]
    yf = np.sqrt(ratio[finite])
    if _cond_check(xf, fit_degree) > 1e10:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    try:
        coeffs = np.polyfit(xf, yf, fit_degree)
    except Exception:
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    a = coeffs[fit_degree]
    b = coeffs[fit_degree - 1]
    if a <= 0 or not np.isfinite(a):
        if return_quality:
            return np.nan, np.nan, {"chi2": np.nan, "residuals": np.array([]),
                                    "n_angles_used": int(finite.sum())}
        return np.nan, np.nan
    sqrt_M = 1.0 / a
    M = 1.0 / (a * a)
    Rg2 = (b / a) * 3.0 * lambda_sol ** 2 / (8.0 * np.pi ** 2)
    if not np.isfinite(Rg2) or Rg2 < 0:
        Rg = np.nan
    else:
        Rg = float(np.sqrt(Rg2))
    if return_quality:
        y_fit = np.polyval(coeffs, xf)
        chi2, resid = _fit_quality(yf, y_fit, fit_degree)
        return M, Rg, {"chi2": chi2, "residuals": resid,
                       "n_angles_used": int(finite.sum())}
    return M, Rg


_FIT_DISPATCH = {
    0: zimm_fit_per_slice,
    1: debye_fit_per_slice,
    2: berry_fit_per_slice,
}


def _model_name(fit_model: int) -> str:
    return {0: "zimm", 1: "debye", 2: "berry"}.get(fit_model, "zimm")


def compute_molar_mass(R_theta, c, angles_deg, n0, dn_dc, wavelength_nm,
                      angle_mask: Optional[np.ndarray] = None,
                      fit_model: int = 0, fit_degree: int = 1,
                      return_quality: bool = False):
    """Compute per-slice molar mass and Rg via the chosen fit model.

    Parameters
    ----------
    R_theta : array-like (2-D: n_slices x n_angles)
        Rayleigh ratios at each slice and angle.
    c : array-like (n_slices)
        Concentration at each slice (g/mL).
    angles_deg : array-like
        Detector angles in degrees.
    n0 : float
        Solvent refractive index.
    dn_dc : float
        Specific refractive-index increment (mL/g).
    wavelength_nm : float
        Laser wavelength (nm).
    angle_mask : array-like (bool), optional
        Pre-computed keep-mask over the angle axis. If None, a mask is
        computed via :func:`select_angles` at the peak (max-c) slice.
    fit_model : int
        0 = Zimm (default), 1 = Debye, 2 = Berry.
    fit_degree : int
        1 (linear, default) or 2 (quadratic).
    return_quality : bool
        If True, additionally compute per-slice angular fit quality metrics
        (chi-squared, residuals, n_angles_used) and include them in the
        returned dict under the keys ``chi2``, ``residuals`` and
        ``n_angles_used``.  When False the Zimm 1st-order path is
        numerically identical to the original Phase 3a implementation.

    Returns
    -------
    dict
        ``{"molar_mass": ndarray, "radius": ndarray, "angle_mask": ndarray,
           "K": float, "lambda_sol": float, "x": ndarray,
           "fit_model": str, "fit_degree": int}``.  When
        ``return_quality=True`` also includes ``"chi2"``, ``"residuals"``
        (list of per-slice residual arrays) and ``"n_angles_used"``.
    """
    R = _clean(R_theta)
    if R.ndim != 2:
        base = {"molar_mass": np.array([]), "radius": np.array([]),
                "angle_mask": np.array([]), "K": np.nan,
                "lambda_sol": np.nan, "x": np.array([]),
                "fit_model": _model_name(fit_model), "fit_degree": fit_degree}
        if return_quality:
            base.update({"chi2": np.array([]), "residuals": [],
                         "n_angles_used": np.array([], dtype=int)})
        return base
    n_slices, n_angles = R.shape
    c_arr = _clean(c)
    angles = np.asarray(angles_deg, dtype=float)
    if angles.size < n_angles:
        angles = np.pad(angles, (0, n_angles - angles.size), constant_values=90.0)
    angles = angles[:n_angles]

    K = optical_constant(n0, dn_dc, wavelength_nm)
    lambda_m = float(wavelength_nm) * 1e-9
    lambda_sol = lambda_m / float(n0)
    theta_rad = np.deg2rad(angles)
    x_all = np.sin(theta_rad / 2.0) ** 2

    if angle_mask is None:
        valid_c = np.isfinite(c_arr) & (c_arr > 0)
        if valid_c.any():
            peak_idx = int(np.argmax(np.where(valid_c, c_arr, -np.inf)))
        else:
            peak_idx = 0
        angle_mask = select_angles(R[peak_idx], c_arr[peak_idx] if np.isfinite(c_arr[peak_idx]) else 0.0,
                                   x_all, K)

    x_keep = x_all[angle_mask]
    M = np.full(n_slices, np.nan)
    Rg = np.full(n_slices, np.nan)
    chi2_arr = np.full(n_slices, np.nan) if return_quality else None
    resid_list: list = [] if return_quality else None
    n_used_arr = np.zeros(n_slices, dtype=int) if return_quality else None

    fitter = _FIT_DISPATCH.get(fit_model, zimm_fit_per_slice)
    for i in range(n_slices):
        ci = c_arr[i]
        if not np.isfinite(ci) or ci <= 0:
            if return_quality:
                resid_list.append(np.array([]))
            continue
        Rk = R[i, angle_mask]
        if return_quality:
            m, rg, q = fitter(Rk, ci, x_keep, K, lambda_sol,
                              fit_degree=fit_degree, return_quality=True)
            M[i] = m
            Rg[i] = rg
            chi2_arr[i] = q["chi2"]
            resid_list.append(np.asarray(q["residuals"], dtype=float))
            n_used_arr[i] = q["n_angles_used"]
        else:
            m, rg = fitter(Rk, ci, x_keep, K, lambda_sol, fit_degree=fit_degree)
            M[i] = m
            Rg[i] = rg

    out = {"molar_mass": M, "radius": Rg, "angle_mask": angle_mask,
           "K": K, "lambda_sol": lambda_sol, "x": x_all,
           "fit_model": _model_name(fit_model), "fit_degree": fit_degree}
    if return_quality:
        out["chi2"] = chi2_arr
        out["residuals"] = resid_list
        out["n_angles_used"] = n_used_arr
    return out
