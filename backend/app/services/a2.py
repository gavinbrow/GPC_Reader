"""Second virial coefficient (A2) / Zimm plot analysis.

The second virial coefficient A2 quantifies non-ideality of polymer-solvent
interaction. A positive A2 indicates a good solvent (polymer-solvent
interactions favoured); a negative A2 indicates a poor solvent (polymer-polymer
interactions favoured, approaching precipitation). A2 ~ 0 indicates a theta
solvent.

Two modes are supported:

**Online A2** — determined from a single GPC/SEC run by performing a global
Zimm fit across all slices within a peak.  The per-slice Zimm equation is:

    K*c / R(theta) = 1/M + (16*pi^2 / (3*lambda_sol^2)) * Rg^2 * sin^2(theta/2) + 2*A2*c

At the peak center, a 2-D linear fit of ``K*c/R`` vs ``(sin^2(theta/2), c)``
yields A2 from the coefficient of the ``c`` term.  However, in a standard
GPC/SEC run the concentration varies across the peak, providing the spread
in ``c`` needed for the fit.  The fit is done globally across all slices and
angles within the peak window:

    y = K*c_i / R(theta_j, slice_i)  =  a + b * x_ij + d * c_i

where ``x_ij = sin^2(theta_j/2)`` and ``d = 2*A2``.  So ``A2 = d / 2``.

**Batch A2** — determined from multiple injections at different concentrations
for the same sample.  A plot of ``K*c / R(0)`` vs ``c`` (the Zimm plot
extrapolated to zero angle) gives A2 from the slope: ``slope = 2*A2``.

    K*c / R(0) = 1/Mw + 2*A2*c

A linear fit of ``y = K*c/R(0)`` vs ``x = c`` yields ``A2 = slope / 2`` and
``Mw = 1 / intercept``.
"""

from __future__ import annotations

from typing import Optional

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def online_a2(
    R_theta: np.ndarray,
    c: np.ndarray,
    angles_deg: np.ndarray,
    K: float,
    wavelength_nm: float,
    n0: float,
    angle_mask: Optional[np.ndarray] = None,
) -> dict:
    """Determine A2 online from a single GPC/SEC peak.

    Performs a global 2-variable linear fit across all slices and kept angles
    within the peak:

        K*c_i / R(theta_j, i) = a + b * sin^2(theta_j/2) + d * c_i

    where ``d = 2*A2``, ``a = 1/Mw``, and ``b`` relates to Rg.

    Parameters
    ----------
    R_theta : array-like (2-D: n_slices x n_angles)
        Rayleigh ratios at each slice and angle.
    c : array-like (n_slices)
        Concentration at each slice (g/mL).
    angles_deg : array-like
        Detector angles in degrees.
    K : float
        Optical constant.
    wavelength_nm : float
        Laser wavelength in nm.
    n0 : float
        Solvent refractive index.
    angle_mask : array-like (bool), optional
        Pre-computed keep-mask over the angle axis.

    Returns
    -------
    dict
        ``{"a2": float, "mw": float, "rg": float, "n_points": int,
           "r_squared": float, "fit_quality": str}``.
        NaN if the fit fails or there is insufficient concentration spread.
    """
    R = _clean(R_theta)
    if R.ndim != 2 or R.size == 0:
        return {"a2": np.nan, "mw": np.nan, "rg": np.nan,
                "n_points": 0, "r_squared": np.nan, "fit_quality": "no_data"}
    n_slices, n_angles = R.shape
    c_arr = _clean(c)
    angles = np.asarray(angles_deg, dtype=float)
    if angles.size < n_angles:
        angles = np.pad(angles, (0, n_angles - angles.size), constant_values=90.0)
    angles = angles[:n_angles]

    if angle_mask is None:
        angle_mask = np.ones(n_angles, dtype=bool)
    if angle_mask.sum() < 3:
        return {"a2": np.nan, "mw": np.nan, "rg": np.nan,
                "n_points": 0, "r_squared": np.nan, "fit_quality": "too_few_angles"}

    theta_rad = np.deg2rad(angles)
    x_ang = np.sin(theta_rad / 2.0) ** 2

    rows = []
    y_vals = []
    x_vals = []
    c_vals = []
    for i in range(n_slices):
        ci = c_arr[i]
        if not np.isfinite(ci) or ci <= 0:
            continue
        for j in range(n_angles):
            if not angle_mask[j]:
                continue
            Rij = R[i, j]
            if not np.isfinite(Rij) or Rij <= 0:
                continue
            yij = K * ci / Rij
            if not np.isfinite(yij):
                continue
            y_vals.append(yij)
            x_vals.append(x_ang[j])
            c_vals.append(ci)

    y_arr = np.array(y_vals, dtype=float)
    x_arr = np.array(x_vals, dtype=float)
    c_arr2 = np.array(c_vals, dtype=float)
    n_pts = y_arr.size

    if n_pts < 4:
        return {"a2": np.nan, "mw": np.nan, "rg": np.nan,
                "n_points": n_pts, "r_squared": np.nan, "fit_quality": "too_few_points"}

    c_spread = float(np.nanmax(c_arr2) - np.nanmin(c_arr2))
    if c_spread <= 0 or not np.isfinite(c_spread):
        return {"a2": np.nan, "mw": np.nan, "rg": np.nan,
                "n_points": n_pts, "r_squared": np.nan, "fit_quality": "no_concentration_spread"}

    design = np.column_stack([np.ones(n_pts), x_arr, c_arr2])
    try:
        if np.linalg.cond(design) > 1e10:
            return {"a2": np.nan, "mw": np.nan, "rg": np.nan,
                    "n_points": n_pts, "r_squared": np.nan, "fit_quality": "ill_conditioned"}
        coeffs, residuals, _, _ = np.linalg.lstsq(design, y_arr, rcond=None)
    except Exception:
        return {"a2": np.nan, "mw": np.nan, "rg": np.nan,
                "n_points": n_pts, "r_squared": np.nan, "fit_quality": "fit_failed"}

    a, b, d = coeffs[0], coeffs[1], coeffs[2]
    A2 = d / 2.0

    mw = 1.0 / a if np.isfinite(a) and a > 0 else np.nan

    lambda_m = float(wavelength_nm) * 1e-9
    lambda_sol = lambda_m / float(n0)
    rg2 = b * mw * 3.0 * lambda_sol ** 2 / (16.0 * np.pi ** 2) if np.isfinite(mw) else np.nan
    rg = float(np.sqrt(rg2)) if np.isfinite(rg2) and rg2 >= 0 else np.nan

    y_fit = design @ coeffs
    ss_res = float(np.sum((y_arr - y_fit) ** 2))
    ss_tot = float(np.sum((y_arr - np.mean(y_arr)) ** 2))
    r_sq = 1.0 - ss_res / ss_tot if ss_tot > 0 else np.nan

    quality = "good" if r_sq > 0.8 else "moderate" if r_sq > 0.5 else "poor"

    return {"a2": float(A2), "mw": float(mw), "rg": float(rg),
            "n_points": n_pts, "r_squared": float(r_sq), "fit_quality": quality}


def batch_a2(
    concentrations: np.ndarray,
    rayleigh_ratio_zero: np.ndarray,
    K: float,
) -> dict:
    """Determine A2 from multiple injections at different concentrations.

    Fits a line to the Zimm plot extrapolated to zero angle:

        K*c / R(0) = 1/Mw + 2*A2*c

    Parameters
    ----------
    concentrations : array-like
        Concentration of each injection (g/mL).
    rayleigh_ratio_zero : array-like
        Rayleigh ratio at zero angle for each injection.
    K : float
        Optical constant.

    Returns
    -------
    dict
        ``{"a2": float, "mw": float, "slope": float, "intercept": float,
           "r_squared": float, "n_points": int}``.
    """
    c = _clean(concentrations)
    R0 = _clean(rayleigh_ratio_zero)
    if c.size < 2 or R0.size < 2:
        return {"a2": np.nan, "mw": np.nan, "slope": np.nan,
                "intercept": np.nan, "r_squared": np.nan, "n_points": 0}
    n = min(c.size, R0.size)
    c = c[:n]
    R0 = R0[:n]
    if K <= 0:
        return {"a2": np.nan, "mw": np.nan, "slope": np.nan,
                "intercept": np.nan, "r_squared": np.nan, "n_points": n}

    y = K * c / R0
    finite = np.isfinite(y) & np.isfinite(c) & (c > 0) & (R0 > 0)
    if finite.sum() < 2:
        return {"a2": np.nan, "mw": np.nan, "slope": np.nan,
                "intercept": np.nan, "r_squared": np.nan, "n_points": int(finite.sum())}

    xf = c[finite]
    yf = y[finite]
    try:
        coeffs = np.polyfit(xf, yf, 1)
    except Exception:
        return {"a2": np.nan, "mw": np.nan, "slope": np.nan,
                "intercept": np.nan, "r_squared": np.nan, "n_points": int(finite.sum())}

    slope = float(coeffs[0])
    intercept = float(coeffs[1])
    A2 = slope / 2.0
    mw = 1.0 / intercept if np.isfinite(intercept) and intercept > 0 else np.nan

    y_fit = np.polyval(coeffs, xf)
    ss_res = float(np.sum((yf - y_fit) ** 2))
    ss_tot = float(np.sum((yf - np.mean(yf)) ** 2))
    r_sq = 1.0 - ss_res / ss_tot if ss_tot > 0 else np.nan

    return {"a2": float(A2), "mw": float(mw), "slope": slope,
            "intercept": intercept, "r_squared": float(r_sq),
            "n_points": int(finite.sum())}


def zimm_plot_data(
    R_theta: np.ndarray,
    c: np.ndarray,
    angles_deg: np.ndarray,
    K: float,
    wavelength_nm: float,
    n0: float,
    angle_mask: Optional[np.ndarray] = None,
) -> dict:
    """Generate data for a Zimm plot (K*c/R vs sin^2(theta/2) + c/K).

    The classic Zimm plot is a graph of ``K*c/R(theta)`` vs
    ``sin^2(theta/2) + k*c`` where ``k`` is an arbitrary scaling constant
    chosen to spread the data visually.  Each angle forms a line of points
    at different concentrations; extrapolation to ``c=0`` gives the angular
    dependence, and extrapolation to ``theta=0`` gives the concentration
    dependence.

    Parameters
    ----------
    R_theta : array-like (2-D: n_slices x n_angles)
        Rayleigh ratios.
    c : array-like (n_slices)
        Concentration at each slice.
    angles_deg : array-like
        Detector angles in degrees.
    K : float
        Optical constant.
    wavelength_nm : float
        Laser wavelength in nm.
    n0 : float
        Solvent refractive index.
    angle_mask : array-like (bool), optional
        Keep-mask over angles.

    Returns
    -------
    dict
        ``{"x": list, "y": list, "angles": list, "concentrations": list,
           "k_scale": float, "a2": float, "mw": float, "rg": float}``.
    """
    R = _clean(R_theta)
    result = online_a2(R, c, angles_deg, K, wavelength_nm, n0, angle_mask)

    if R.ndim != 2 or R.size == 0:
        return {"x": [], "y": [], "angles": [], "concentrations": [],
                "k_scale": 0.0, "a2": np.nan, "mw": np.nan, "rg": np.nan}

    n_slices, n_angles = R.shape
    c_arr = _clean(c)
    angles = np.asarray(angles_deg, dtype=float)
    if angles.size < n_angles:
        angles = np.pad(angles, (0, n_angles - angles.size), constant_values=90.0)
    angles = angles[:n_angles]

    if angle_mask is None:
        angle_mask = np.ones(n_angles, dtype=bool)

    theta_rad = np.deg2rad(angles)
    x_ang = np.sin(theta_rad / 2.0) ** 2

    c_finite = c_arr[np.isfinite(c_arr) & (c_arr > 0)]
    if c_finite.size > 1:
        c_max = float(np.nanmax(c_finite))
        x_max = float(np.nanmax(x_ang[angle_mask])) if angle_mask.any() else 1.0
        k_scale = x_max / c_max if c_max > 0 else 1.0
    else:
        k_scale = 1.0

    xs: list[float] = []
    ys: list[float] = []
    angle_list: list[float] = []
    conc_list: list[float] = []
    for i in range(n_slices):
        ci = c_arr[i]
        if not np.isfinite(ci) or ci <= 0:
            continue
        for j in range(n_angles):
            if not angle_mask[j]:
                continue
            Rij = R[i, j]
            if not np.isfinite(Rij) or Rij <= 0:
                continue
            yij = K * ci / Rij
            if not np.isfinite(yij):
                continue
            xs.append(float(x_ang[j] + k_scale * ci))
            ys.append(float(yij))
            angle_list.append(float(angles[j]))
            conc_list.append(float(ci))

    return {"x": xs, "y": ys, "angles": angle_list, "concentrations": conc_list,
            "k_scale": k_scale, "a2": result["a2"], "mw": result["mw"],
            "rg": result["rg"]}
