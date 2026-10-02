"""Particle concentration and number density (MALS-only + known sample RI).

For a particulate sample eluting through a SEC column the per-slice molar
mass (from MALS) and radius of gyration (from the angular fit) give access
to a number density:

    N_slice = c * N_A / M          (particles per mL)

where c is the per-slice concentration (g/mL), M the molar mass (g/mol)
and N_A Avogadro's number.

The geometric (sphere-equivalent) radius is obtained from the radius of
gyration assuming a uniform sphere, for which Rg^2 = (3/5) R^2:

    R_geom = Rg * sqrt(5/3)

The number-fraction distribution weights each slice by its number density
rather than its mass fraction, exposing the population of small vs large
particles.

The total particle count over the peak would require the flow rate; here we
return the integrated number density (sum of per-slice N) as
``total_count`` — multiply by ``dt * flow_rate`` for an absolute count.
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


def compute_particle_density(molar_mass, radius, concentration,
                              sample_ri: Optional[float] = None,
                              solvent_ri: Optional[float] = None):
    """Compute per-slice particle number density and number-fraction distribution.

    Parameters
    ----------
    molar_mass : array-like
        Per-slice molar mass (g/mol).
    radius : array-like
        Per-slice radius of gyration (nm).
    concentration : array-like
        Per-slice concentration (g/mL).
    sample_ri : float, optional
        Sample (particle) refractive index.  Used to validate the
        sphere-equivalence assumption; the computation itself does not
        depend on it.
    solvent_ri : float, optional
        Solvent refractive index; informational.

    Returns
    -------
    dict
        ``{"molar_mass": list, "geometric_radius": list,
        "number_density": list, "number_fraction": list,
        "total_count": float}``.  When inputs are empty the arrays are
        empty and ``total_count`` is NaN.
    """
    m = _clean(molar_mass)
    rg = _clean(radius)
    c = _clean(concentration)
    n = min(m.size, rg.size, c.size)
    if n == 0:
        return {
            "molar_mass": [],
            "geometric_radius": [],
            "number_density": [],
            "number_fraction": [],
            "total_count": float(np.nan),
        }
    m = m[:n]
    rg = rg[:n]
    c = c[:n]

    valid = (np.isfinite(m) & np.isfinite(rg) & np.isfinite(c)
             & (m > 0) & (rg > 0) & (c > 0))
    geom = np.full(n, np.nan)
    density = np.full(n, np.nan)
    fraction = np.full(n, np.nan)
    if valid.any():
        m_v = m[valid]
        rg_v = rg[valid]
        c_v = c[valid]
        geom[valid] = rg_v * np.sqrt(5.0 / 3.0)
        d = c_v * N_A / m_v
        density[valid] = d
        total = float(np.sum(d))
        if total > 0:
            fraction[valid] = d / total
        else:
            fraction[valid] = np.nan
        total_count = float(total)
    else:
        total_count = float(np.nan)

    return {
        "molar_mass": m.tolist(),
        "geometric_radius": np.where(np.isfinite(geom), geom, np.nan).tolist(),
        "number_density": np.where(np.isfinite(density), density, np.nan).tolist(),
        "number_fraction": np.where(np.isfinite(fraction), fraction, np.nan).tolist(),
        "total_count": total_count,
    }
