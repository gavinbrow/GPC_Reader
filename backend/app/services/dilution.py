"""Dilution-factor correction engine.

For Phase 3a this is a simplified pass-through: the dilution correction is only
relevant when a viscometer is present and a dilution factor is configured. When
no viscometer / dilution configuration exists the signal is returned unchanged.
"""

from __future__ import annotations

from typing import Optional

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def apply_dilution_correction(signal, dilution_factor: Optional[float] = None):
    """Apply dilution-factor correction to a concentration signal.

    Parameters
    ----------
    signal : array-like
        Concentration (or detector signal) to correct.
    dilution_factor : float, optional
        Fraction of original concentration after the split (0 < df <= 1).
        If None or <= 0, the signal is returned unchanged (pass-through).

    Returns
    -------
    np.ndarray
        Corrected signal. When no dilution factor is supplied this is the
        input unchanged (Phase 3a simplification).
    """
    s = _clean(signal)
    if s.size == 0:
        return s
    if dilution_factor is None or dilution_factor <= 0 or not np.isfinite(dilution_factor):
        return s
    return s / float(dilution_factor)
