"""Peak-area and recovery calculations.

Peak area is the time-integral of the concentration signal within the peak
region.  Recovery is the ratio of the peak area to the total injected mass
(when known).
"""

from __future__ import annotations

from typing import Optional

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def peak_area(time, signal):
    """Integrate a signal over time (trapezoidal rule).

    Parameters
    ----------
    time : array-like
        Time axis (minutes).
    signal : array-like
        Signal to integrate (e.g. concentration).

    Returns
    -------
    float
        Peak area (signal * minutes). NaN on degenerate input.
    """
    t = _clean(time)
    s = _clean(signal)
    n = min(t.size, s.size)
    if n < 2:
        return np.nan
    t = t[:n]
    s = s[:n]
    finite = np.isfinite(t) & np.isfinite(s)
    if finite.sum() < 2:
        return np.nan
    return float(np.trapezoid(s[finite], t[finite]))


def recovery_fraction(peak_area_val, flow_rate_ml_min: Optional[float],
                      injected_mass: Optional[float]):
    """Compute the mass-recovery fraction.

    recovery = (peak_area * flow_rate) / injected_mass

    Parameters
    ----------
    peak_area_val : float
        Integrated concentration (g*min/mL).
    flow_rate_ml_min : float, optional
        Flow rate (mL/min). If None or <= 0, recovery is NaN.
    injected_mass : float, optional
        Total injected mass (g). If None or <= 0, recovery is NaN.

    Returns
    -------
    float
        Recovery fraction (dimensionless), or NaN.
    """
    if (peak_area_val is None or not np.isfinite(peak_area_val)
            or flow_rate_ml_min is None or flow_rate_ml_min <= 0
            or injected_mass is None or injected_mass <= 0):
        return np.nan
    return float(peak_area_val * flow_rate_ml_min / injected_mass)
