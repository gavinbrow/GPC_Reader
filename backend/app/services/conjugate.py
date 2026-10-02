"""Protein conjugate / copolymer analysis (MALS + UV + RI three-detector).

For a two-component (protein + modifier) conjugate eluting through a SEC
column, the three detector signals carry complementary information:

    * MALS  →  weight-average molar mass of the whole conjugate (M_total)
    * UV    →  concentration of the UV-absorbing component (the protein)
    * RI    →  total concentration (protein + modifier)

Per-slice deconvolution:

    c_protein   = A_UV / (epsilon_protein * l)              (Beer-Lambert)
    c_total     = delta_RI / dn_dc                          (RI)
    c_modifier  = c_total - c_protein

    f_protein  = c_protein  / c_total          (0 .. 1)
    f_modifier = 1 - f_protein

The component molar masses follow from the total molar mass (from MALS) and
the mass fractions:

    M_protein   = M_total * f_protein
    M_modifier  = M_total * f_modifier

If the UV extinction of the modifier, the protein extinction, or the
modifier dn/dc is missing, the deconvolution cannot be performed and an
empty/NaN result with a ``"missing data"`` message is returned.
"""

from __future__ import annotations

import numpy as np

N_A = 6.02214076e23


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def compute_conjugate(mals_signal, uv_signal, ri_signal, time,
                      dn_dc_protein, dn_dc_modifier,
                      uv_ext_protein, uv_ext_modifier, cell_length):
    """Compute per-slice protein/modifier fractions and component molar masses.

    Parameters
    ----------
    mals_signal : array-like
        Per-slice MALS-derived total molar mass (g/mol).  This is the MALS
        weight-average molar mass of the conjugate at each slice.
    uv_signal : array-like
        Per-slice UV absorbance (AU), baseline-subtracted.
    ri_signal : array-like
        Per-slice RI signal (delta_RI, dimensionless), baseline-subtracted.
    time : array-like
        Per-slice elution time (minutes).
    dn_dc_protein : float
        Specific refractive-index increment of the protein (mL/g).
    dn_dc_modifier : float
        Specific refractive-index increment of the modifier (mL/g).
    uv_ext_protein : float
        UV extinction coefficient of the protein (mL/(g*cm)).
    uv_ext_modifier : float
        UV extinction coefficient of the modifier (mL/(g*cm)).
    cell_length : float
        UV cell path length (cm).

    Returns
    -------
    dict
        ``{"time": list, "total_molar_mass": list, "protein_fraction": list,
        "modifier_fraction": list, "protein_molar_mass": list,
        "modifier_molar_mass": list, "message": Optional[str]}``.
    """
    t = _clean(time)
    mals = _clean(mals_signal)
    uv = _clean(uv_signal)
    ri = _clean(ri_signal)

    missing = (
        dn_dc_protein is None or dn_dc_protein <= 0
        or dn_dc_modifier is None or dn_dc_modifier <= 0
        or uv_ext_protein is None or uv_ext_protein <= 0
        or cell_length is None or cell_length <= 0
    )
    if missing:
        return {
            "time": [],
            "total_molar_mass": [],
            "protein_fraction": [],
            "modifier_fraction": [],
            "protein_molar_mass": [],
            "modifier_molar_mass": [],
            "message": "missing data: dn/dc for both protein and modifier, "
                       "UV extinction for the protein, and the UV cell "
                       "length are all required",
        }

    n = min(t.size, mals.size, uv.size, ri.size)
    if n == 0:
        return {
            "time": [],
            "total_molar_mass": [],
            "protein_fraction": [],
            "modifier_fraction": [],
            "protein_molar_mass": [],
            "modifier_molar_mass": [],
            "message": None,
        }
    t = t[:n]
    mals = mals[:n]
    uv = uv[:n]
    ri = ri[:n]

    eps_p = float(uv_ext_protein)
    eps_m = float(uv_ext_modifier)
    dndc_p = float(dn_dc_protein)
    dndc_m = float(dn_dc_modifier)
    L = float(cell_length)

    c_total = ri / (dndc_p * 1.0)
    c_protein = uv / (eps_p * L)
    c_modifier = c_total - c_protein

    protein_fraction = np.full(n, np.nan)
    modifier_fraction = np.full(n, np.nan)
    valid = (np.isfinite(c_total)) & (c_total > 0)
    protein_fraction[valid] = c_protein[valid] / c_total[valid]
    protein_fraction = np.clip(protein_fraction, 0.0, 1.0)
    modifier_fraction = 1.0 - protein_fraction
    modifier_fraction[~np.isfinite(protein_fraction)] = np.nan

    protein_molar_mass = mals * protein_fraction
    modifier_molar_mass = mals * modifier_fraction

    return {
        "time": t.tolist(),
        "total_molar_mass": np.where(np.isfinite(mals), mals, np.nan).tolist(),
        "protein_fraction": np.where(np.isfinite(protein_fraction),
                                     protein_fraction, np.nan).tolist(),
        "modifier_fraction": np.where(np.isfinite(modifier_fraction),
                                      modifier_fraction, np.nan).tolist(),
        "protein_molar_mass": np.where(np.isfinite(protein_molar_mass),
                                       protein_molar_mass, np.nan).tolist(),
        "modifier_molar_mass": np.where(np.isfinite(modifier_molar_mass),
                                        modifier_molar_mass, np.nan).tolist(),
        "message": None,
    }
