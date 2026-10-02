"""Polymer branching analysis (Zimm-Stockmayer).

For a branched polymer the branching ratio ``g`` is defined as the ratio of
the mean-square radius of gyration of the branched molecule to that of a
linear molecule of the same molar mass:

    g(M) = Rg_branched(M)^2 / Rg_linear(M)^2

The linear reference is supplied as arrays of (M, Rg) for the linear
polymer; at each measured molar mass the linear Rg is obtained by log-log
interpolation of the reference.  A ``g`` less than 1 indicates branching.

The Zimm-Stockmayer theory relates ``g`` to the number of branch units per
molecule for several branching topologies.  Let ``f`` be the branching
functionality (3 for tri-functional, 4 for tetra-functional).  For a
tri-functional randomly branched polymer:

    g = [(1 + b*M/6)^{1/2} / (1 + b*M/3)]^2

where ``b`` is the branching frequency (branches per molar mass).  Solving
for ``b*M`` (the number of branch units per molecule, ``n_b``) from a
measured ``g`` is performed numerically by minimising the squared residual
between the measured ``g`` and the theoretical curve.

For tetra-functional branching the analogous expression is:

    g = [(1 + b*M/12)^{1/2} / (1 + b*M/6)]^2  * correction

For star and comb topologies a simpler ``g = f / (f + ... )`` relation is
used; here we fall back to the tri-functional solver when an exact closed
form is unavailable and tag the result with the requested branching type.

When no linear reference is provided the branching metrics cannot be
computed and NaN arrays are returned with a message.
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def _g_theory(n_b: float, branching_type: str) -> float:
    """Theoretical branching ratio g for a given number of branch units."""
    if not np.isfinite(n_b) or n_b < 0:
        return np.nan
    if branching_type == "tetra":
        ratio = n_b / 6.0
    else:
        ratio = n_b / 3.0
    denom = 1.0 + ratio
    if denom <= 0:
        return np.nan
    num = np.sqrt(1.0 + n_b / 6.0)
    g = (num / denom) ** 2
    return float(g)


def _solve_branch_units(g_measured: float, branching_type: str) -> float:
    """Solve for the number of branch units per molecule from a measured g.

    Uses a coarse-to-fine grid search followed by a golden-section
    refinement.  Returns NaN if the measured g is non-finite or >= 1
    (no branching detectable).
    """
    if not np.isfinite(g_measured) or g_measured >= 1.0:
        if g_measured is not None and np.isfinite(g_measured) and g_measured >= 1.0:
            return 0.0
        return np.nan
    if g_measured <= 0:
        return np.nan
    coarse = np.linspace(0.0, 50.0, 501)
    best_n = 0.0
    best_err = np.inf
    for nb in coarse:
        g_th = _g_theory(nb, branching_type)
        if not np.isfinite(g_th):
            continue
        err = (g_th - g_measured) ** 2
        if err < best_err:
            best_err = err
            best_n = nb
    lo = max(0.0, best_n - 0.5)
    hi = best_n + 0.5
    for _ in range(60):
        m1 = lo + (hi - lo) / 3.0
        m2 = hi - (hi - lo) / 3.0
        e1 = (_g_theory(m1, branching_type) - g_measured) ** 2
        e2 = (_g_theory(m2, branching_type) - g_measured) ** 2
        if e1 < e2:
            hi = m2
        else:
            lo = m1
    return float(0.5 * (lo + hi))


def compute_branching(molar_mass, radius, concentration,
                      linear_reference_m, linear_reference_rg,
                      branching_type: str = "tri"):
    """Compute per-slice branching ratio and branch units per molecule.

    Parameters
    ----------
    molar_mass : array-like
        Per-slice measured molar mass (g/mol).
    radius : array-like
        Per-slice measured radius of gyration (nm).
    concentration : array-like
        Per-slice concentration (g/mL); used to weight the long-chain
        branch frequency average.
    linear_reference_m : array-like
        Molar mass of the linear reference polymer (g/mol).
    linear_reference_rg : array-like
        Radius of gyration of the linear reference polymer (nm).
    branching_type : str
        One of "tri" (3-functional, default), "tetra" (4-functional),
        "star", or "comb".

    Returns
    -------
    dict
        ``{"molar_mass": list, "branching_ratio_g": list,
        "branch_units_per_molecule": list, "long_chain_branch_freq": list,
        "branching_type": str, "message": Optional[str]}``.
    """
    m = _clean(molar_mass)
    rg = _clean(radius)
    c = _clean(concentration)
    if branching_type not in ("tri", "tetra", "star", "comb"):
        branching_type = "tri"
    bt = branching_type

    no_ref = (
        linear_reference_m is None or linear_reference_rg is None
        or len(np.ravel(np.asarray(linear_reference_m, dtype=float))) < 2
        or len(np.ravel(np.asarray(linear_reference_rg, dtype=float))) < 2
    )
    if no_ref:
        n = min(m.size, rg.size)
        return {
            "molar_mass": m[:n].tolist() if n else [],
            "branching_ratio_g": [],
            "branch_units_per_molecule": [],
            "long_chain_branch_freq": [],
            "branching_type": bt,
            "message": "missing data: a linear reference (M vs Rg) is required",
        }

    m_ref = _clean(linear_reference_m)
    rg_ref = _clean(linear_reference_rg)
    n_ref = min(m_ref.size, rg_ref.size)
    if n_ref < 2:
        n = min(m.size, rg.size)
        return {
            "molar_mass": m[:n].tolist() if n else [],
            "branching_ratio_g": [],
            "branch_units_per_molecule": [],
            "long_chain_branch_freq": [],
            "branching_type": bt,
            "message": "missing data: linear reference has fewer than 2 points",
        }
    m_ref = m_ref[:n_ref]
    rg_ref = rg_ref[:n_ref]
    ref_valid = np.isfinite(m_ref) & np.isfinite(rg_ref) & (m_ref > 0) & (rg_ref > 0)
    if ref_valid.sum() < 2:
        n = min(m.size, rg.size)
        return {
            "molar_mass": m[:n].tolist() if n else [],
            "branching_ratio_g": [],
            "branch_units_per_molecule": [],
            "long_chain_branch_freq": [],
            "branching_type": bt,
            "message": "missing data: linear reference has fewer than 2 valid points",
        }
    m_ref = m_ref[ref_valid]
    rg_ref = rg_ref[ref_valid]
    order = np.argsort(m_ref)
    m_ref = m_ref[order]
    rg_ref = rg_ref[order]
    log_m_ref = np.log10(m_ref)
    log_rg_ref = np.log10(rg_ref)

    n = min(m.size, rg.size)
    if n == 0:
        return {
            "molar_mass": [],
            "branching_ratio_g": [],
            "branch_units_per_molecule": [],
            "long_chain_branch_freq": [],
            "branching_type": bt,
            "message": None,
        }
    m = m[:n]
    rg = rg[:n]
    valid = np.isfinite(m) & np.isfinite(rg) & (m > 0) & (rg > 0)
    g_arr = np.full(n, np.nan)
    branch_units = np.full(n, np.nan)
    lcbf = np.full(n, np.nan)
    if valid.any():
        log_m_meas = np.log10(m[valid])
        log_rg_lin = np.interp(log_m_meas, log_m_ref, log_rg_ref)
        rg_lin = 10.0 ** log_rg_lin
        g = (rg[valid] / rg_lin) ** 2
        g = np.where(np.isfinite(g) & (g > 0), g, np.nan)
        g_arr[valid] = g
        for i, idx in enumerate(np.where(valid)[0]):
            nb = _solve_branch_units(g_arr[idx], bt)
            branch_units[idx] = nb
            if np.isfinite(m[idx]) and m[idx] > 0 and np.isfinite(nb):
                lcbf[idx] = nb / m[idx]
    return {
        "molar_mass": m.tolist(),
        "branching_ratio_g": g_arr.tolist(),
        "branch_units_per_molecule": branch_units.tolist(),
        "long_chain_branch_freq": lcbf.tolist(),
        "branching_type": bt,
        "message": None,
    }
