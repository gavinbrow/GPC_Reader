"""Concentration calculation from RI and UV detector signals.

  - RI:  c = (RI_signal - baseline) / dn_dc
         (the RI "raw signal" in ASTRA .afe8 files is the dimensionless
         refractive-index change delta_RI, so c = delta_RI / (dn/dc).)

  - UV:  c = A / (epsilon * l)
         where A is absorbance, epsilon is the extinction coefficient
         (mL/(g*cm)), and l is the cell length (cm).

  When both RI and UV concentrations are available they are combined (RI is
  the primary source; UV is used only when RI is absent or to fill gaps).
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def concentration_from_ri(ri_signal, dn_dc: float):
    """Compute concentration (g/mL) from an RI signal.

    The ASTRA "RI raw signal" (data-name code 12025) is the dimensionless
    refractive-index change, so:

        c = delta_RI / (dn/dc)

    Parameters
    ----------
    ri_signal : array-like
        Baseline-subtracted RI signal (delta_RI, dimensionless).
    dn_dc : float
        Specific refractive-index increment in mL/g.

    Returns
    -------
    np.ndarray
        Concentration in g/mL.
    """
    s = _clean(ri_signal)
    if s.size == 0:
        return s
    if dn_dc is None or dn_dc == 0 or not np.isfinite(dn_dc):
        return np.full_like(s, np.nan)
    return s / float(dn_dc)


def concentration_from_uv(uv_signal, extinction: float, cell_length: float):
    """Compute concentration (g/mL) from a UV absorbance signal.

        c = A / (epsilon * l)

    Parameters
    ----------
    uv_signal : array-like
        UV absorbance (AU), baseline-subtracted.
    extinction : float
        UV extinction coefficient in mL/(g*cm).
    cell_length : float
        UV cell path length in cm.

    Returns
    -------
    np.ndarray
        Concentration in g/mL.
    """
    s = _clean(uv_signal)
    if s.size == 0:
        return s
    denom = float(extinction) * float(cell_length)
    if denom <= 0 or not np.isfinite(denom):
        return np.full_like(s, np.nan)
    return s / denom


def combine_concentrations(c_ri, c_uv):
    """Combine RI and UV concentrations.

    RI is the primary concentration source. UV is used only to fill slices
    where RI is non-finite or non-positive.

    Parameters
    ----------
    c_ri, c_uv : array-like
        Concentration arrays (g/mL) from RI and UV respectively.

    Returns
    -------
    np.ndarray
        Combined concentration.
    """
    ri = _clean(c_ri)
    uv = _clean(c_uv)
    n = max(ri.size, uv.size)
    if n == 0:
        return np.array([])
    result = np.full(n, np.nan)
    if ri.size == n:
        result = ri.copy()
    elif ri.size > 0:
        result[:ri.size] = ri
    if uv.size > 0:
        fill = np.isfinite(uv) & (uv > 0) & (~np.isfinite(result) | (result <= 0))
        if uv.size == n:
            result[fill] = uv[fill]
        elif uv.size < n:
            result[:uv.size][fill] = uv[fill]
    return result
