"""Molar-mass moment calculations (Mn, Mw, Mz, Pd).

  Mn = sum(c_i) / sum(c_i / M_i)
  Mw = sum(c_i * M_i) / sum(c_i)
  Mz = sum(c_i * M_i^2) / sum(c_i * M_i)
  Pd = Mw / Mn

Only slices where M_i is finite and c_i > 0 are included.
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def compute_moments(c, molar_mass):
    """Compute (Mn, Mw, Mz, Pd) from per-slice concentration and molar mass.

    Parameters
    ----------
    c : array-like
        Per-slice concentration (g/mL).
    molar_mass : array-like
        Per-slice molar mass (g/mol).

    Returns
    -------
    dict
        ``{"Mn": float, "Mw": float, "Mz": float, "Pd": float}``
        Any value is NaN if it cannot be computed.
    """
    cc = _clean(c)
    mm = _clean(molar_mass)
    n = min(cc.size, mm.size)
    if n == 0:
        return {"Mn": np.nan, "Mw": np.nan, "Mz": np.nan, "Pd": np.nan}
    cc = cc[:n]
    mm = mm[:n]

    valid = np.isfinite(cc) & np.isfinite(mm) & (cc > 0) & (mm > 0)
    if not valid.any():
        return {"Mn": np.nan, "Mw": np.nan, "Mz": np.nan, "Pd": np.nan}

    c_v = cc[valid]
    m_v = mm[valid]

    sum_c = float(np.nansum(c_v))
    sum_c_over_m = float(np.nansum(c_v / m_v))
    sum_cm = float(np.nansum(c_v * m_v))
    sum_cm2 = float(np.nansum(c_v * m_v * m_v))

    Mn = sum_c / sum_c_over_m if sum_c_over_m > 0 else np.nan
    Mw = sum_cm / sum_c if sum_c > 0 else np.nan
    Mz = sum_cm2 / sum_cm if sum_cm > 0 else np.nan
    Pd = Mw / Mn if (np.isfinite(Mn) and Mn > 0 and np.isfinite(Mw)) else np.nan

    return {"Mn": float(Mn), "Mw": float(Mw), "Mz": float(Mz), "Pd": float(Pd)}
