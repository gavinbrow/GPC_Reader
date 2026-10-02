"""Viscometry — intrinsic viscosity, Mark-Houwink-Sakurada, hydrodynamic radius.

The Mark-Houwink-Sakurada (MHS) equation relates intrinsic viscosity to
molar mass:

    [eta] = K * M^a

Taking logs:  log([eta]) = log(K) + a*log(M).  A linear fit of log(IV) vs
log(M) yields the MHS constants K (intercept) and a (slope), with an
R-squared goodness of fit.

The hydrodynamic radius follows from the Flory-Fox / Einstein-Simha
relation expressed for a sphere of equivalent hydrodynamic volume:

    Rh = (3 * M * [eta] / (10 * pi * N_A))^(1/3)

with M in g/mol, [eta] in mL/g (= cm^3/g) and N_A Avogadro's number; the
result is in cm and is converted to nm by multiplying by 1e7.

The universal (Benoit) calibration concept identifies the hydrodynamic
volume V_h = M * [eta]; that product is returned per slice as
``universal_molar_mass``.

If no viscometer data is supplied (intrinsic_viscosity and
specific_viscosity both None) the function returns empty arrays with NaN
MHS constants — the module is a no-op stretch goal.
"""

from __future__ import annotations

import numpy as np

N_A = 6.02214076e23


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def compute_viscometry(time, intrinsic_viscosity=None, specific_viscosity=None,
                       molar_mass=None, concentration=None):
    """Compute intrinsic viscosity, MHS fit and hydrodynamic radius per slice.

    Parameters
    ----------
    time : array-like
        Per-slice elution time (minutes).
    intrinsic_viscosity : array-like, optional
        Per-slice intrinsic viscosity [eta] (mL/g).  Required for the MHS
        fit and hydrodynamic radius.
    specific_viscosity : array-like, optional
        Per-slice specific viscosity (eta_sp, dimensionless).
    molar_mass : array-like, optional
        Per-slice molar mass (g/mol); required for the MHS fit and Rh.
    concentration : array-like, optional
        Per-slice concentration (g/mL); informational.

    Returns
    -------
    dict
        ``{"time": list, "intrinsic_viscosity": list,
        "specific_viscosity": list, "hydrodynamic_radius": list,
        "mhs_K": float, "mhs_a": float, "mhs_r_squared": float,
        "universal_molar_mass": list}``.  When no IV data is present the
        arrays are empty and the MHS constants are NaN.
    """
    t = _clean(time)
    n = t.size if t.size > 0 else 0

    has_iv = intrinsic_viscosity is not None
    has_sp = specific_viscosity is not None

    iv = _clean(intrinsic_viscosity) if has_iv else np.array([])
    sp = _clean(specific_viscosity) if has_sp else np.array([])
    m = _clean(molar_mass) if molar_mass is not None else np.array([])
    c = _clean(concentration) if concentration is not None else np.array([])

    if n == 0 or (not has_iv and not has_sp):
        return {
            "time": t.tolist() if n else [],
            "intrinsic_viscosity": [],
            "specific_viscosity": [],
            "hydrodynamic_radius": [],
            "mhs_K": float(np.nan),
            "mhs_a": float(np.nan),
            "mhs_r_squared": float(np.nan),
            "universal_molar_mass": [],
        }

    out_iv = np.full(n, np.nan)
    out_sp = np.full(n, np.nan)
    if iv.size > 0:
        k = min(n, iv.size)
        out_iv[:k] = iv[:k]
    if sp.size > 0:
        k = min(n, sp.size)
        out_sp[:k] = sp[:k]

    m_arr = np.full(n, np.nan)
    if m.size > 0:
        k = min(n, m.size)
        m_arr[:k] = m[:k]

    rh = np.full(n, np.nan)
    universal = np.full(n, np.nan)
    valid_iv = np.isfinite(out_iv) & (out_iv > 0)
    valid_m = np.isfinite(m_arr) & (m_arr > 0)
    valid = valid_iv & valid_m
    if valid.any():
        m_v = m_arr[valid]
        iv_v = out_iv[valid]
        volume_cm3 = 3.0 * m_v * iv_v / (10.0 * np.pi * N_A)
        volume_cm3 = np.where(volume_cm3 > 0, volume_cm3, np.nan)
        rh_v = np.power(volume_cm3, 1.0 / 3.0) * 1e7
        rh[valid] = rh_v
        universal[valid] = m_v * iv_v

    mhs_K = float(np.nan)
    mhs_a = float(np.nan)
    mhs_r2 = float(np.nan)
    if valid.sum() >= 3:
        log_m = np.log10(m_arr[valid])
        log_iv = np.log10(out_iv[valid])
        try:
            coeffs = np.polyfit(log_m, log_iv, 1)
            mhs_a = float(coeffs[0])
            log_K = float(coeffs[1])
            mhs_K = float(10.0 ** log_K)
            pred = mhs_a * log_m + log_K
            ss_res = float(np.sum((log_iv - pred) ** 2))
            ss_tot = float(np.sum((log_iv - np.mean(log_iv)) ** 2))
            if ss_tot > 0:
                mhs_r2 = float(1.0 - ss_res / ss_tot)
        except Exception:
            pass

    return {
        "time": t.tolist(),
        "intrinsic_viscosity": np.where(np.isfinite(out_iv), out_iv, np.nan).tolist(),
        "specific_viscosity": np.where(np.isfinite(out_sp), out_sp, np.nan).tolist(),
        "hydrodynamic_radius": np.where(np.isfinite(rh), rh, np.nan).tolist(),
        "mhs_K": mhs_K,
        "mhs_a": mhs_a,
        "mhs_r_squared": mhs_r2,
        "universal_molar_mass": np.where(np.isfinite(universal), universal, np.nan).tolist(),
    }
