"""Literature dn/dc (refractive-index increment) values for common polymer/solvent pairs.

Values are in mL/g.  These are starting seed entries; real-world values vary
with wavelength, temperature, and molecular weight.  Always confirm against
primary literature for production work.
"""

from __future__ import annotations

DNDC_LIBRARY: list[dict] = [
    {
        "polymer": "Polystyrene",
        "solvent": "THF",
        "dn_dc": 0.185,
        "source": "literature",
        "notes": "PS in THF at 25C, 633 nm; common SEC-MALS reference.",
    },
    {
        "polymer": "Polymethyl methacrylate",
        "solvent": "THF",
        "dn_dc": 0.089,
        "source": "literature",
        "notes": "PMMA in THF at 25C.",
    },
    {
        "polymer": "Protein",
        "solvent": "Guanidine HCl 6M",
        "dn_dc": 0.165,
        "source": "literature",
        "notes": "Typical unfolded protein in 6M GdnHCl; use ~0.185 in water.",
    },
    {
        "polymer": "Polystyrene",
        "solvent": "Toluene",
        "dn_dc": 0.111,
        "source": "literature",
        "notes": "PS in toluene at 25C.",
    },
    {
        "polymer": "Polymethyl methacrylate",
        "solvent": "Chloroform",
        "dn_dc": 0.057,
        "source": "literature",
        "notes": "PMMA in chloroform at 25C.",
    },
    {
        "polymer": "BSA",
        "solvent": "Water",
        "dn_dc": 0.185,
        "source": "literature",
        "notes": "Bovine serum albumin in aqueous buffer.",
    },
    {
        "polymer": "Dextran",
        "solvent": "Water",
        "dn_dc": 0.147,
        "source": "literature",
        "notes": "Dextran in water at 25C.",
    },
    {
        "polymer": "Polyethylene oxide",
        "solvent": "Water",
        "dn_dc": 0.135,
        "source": "literature",
        "notes": "PEO in water at 25C.",
    },
]


def get_all() -> list[dict]:
    """Return the entire library (shallow copy of list)."""
    return list(DNDC_LIBRARY)


def search_library(polymer: str | None = None, solvent: str | None = None) -> list[dict]:
    """Case-insensitive substring match on polymer and/or solvent.

    None means no filter on that field.
    """
    p_lower = polymer.lower() if polymer else None
    s_lower = solvent.lower() if solvent else None
    out = []
    for entry in DNDC_LIBRARY:
        ep = (entry.get("polymer") or "").lower()
        es = (entry.get("solvent") or "").lower()
        if p_lower is not None and p_lower not in ep:
            continue
        if s_lower is not None and s_lower not in es:
            continue
        out.append(entry)
    return out


def validate_dndc(dn_dc: float) -> list[str]:
    """Return a list of warning strings for the given dn/dc value.

    Empty list means no warnings.  Typical polymer dn/dc values fall in
    0.05-0.30 mL/g; values outside this range get a warning.
    """
    if dn_dc is None:
        return []
    try:
        v = float(dn_dc)
    except (TypeError, ValueError):
        return []
    if v < 0.05 or v > 0.30:
        return [f"dn/dc {v} mL/g is outside the typical range 0.05-0.30 mL/g"]
    return []
