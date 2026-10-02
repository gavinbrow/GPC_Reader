"""dn/dc determination — online (100% mass recovery) and calibration modes.

The specific refractive-index increment (dn/dc, mL/g) can be determined
from a known-mass injection when 100% mass recovery is assumed.  The RI
peak area is the time integral of the baseline-subtracted delta_RI signal:

    ri_area = integral(delta_RI) dt

The injected mass eluting as the peak is, for 100% recovery,

    injected_mass = (ri_area / (dn/dc)) * flow_rate

rearranged:

    dn/dc = ri_area * flow_rate / injected_mass

(ri_area in delta_RI*min, flow_rate in mL/min, injected_mass in g, dn/dc
in mL/g).

For a third-party RI detector with a calibration constant, dn/dc can be
determined from the calibration constant and the measured peak area:

    dn/dc = ri_calibration_constant / (ri_peak_area * flow_rate)

The exact form of the calibration constant depends on the instrument; this
helper assumes the convention above and returns NaN if the inputs are
non-finite or non-positive.
"""

from __future__ import annotations

import numpy as np


def determine_dndc_from_concentration(ri_area, flow_rate, injected_mass):
    """Determine dn/dc assuming 100% mass recovery.

    Parameters
    ----------
    ri_area : float
        Time-integral of the baseline-subtracted RI signal (delta_RI*min).
    flow_rate : float
        Mobile-phase flow rate (mL/min).
    injected_mass : float
        Total mass injected (g).

    Returns
    -------
    float
        dn/dc (mL/g), or NaN if any input is non-finite or non-positive.
    """
    vals = [ri_area, flow_rate, injected_mass]
    if any(v is None for v in vals):
        return float(np.nan)
    if any(not np.isfinite(float(v)) for v in vals):
        return float(np.nan)
    if flow_rate <= 0 or injected_mass <= 0:
        return float(np.nan)
    return float(ri_area * flow_rate / injected_mass)


def determine_dndc_from_calibration(ri_calibration_constant, ri_peak_area, flow_rate):
    """Determine dn/dc from a third-party RI calibration constant.

    Parameters
    ----------
    ri_calibration_constant : float
        RI calibration constant (instrument-specific).
    ri_peak_area : float
        Time-integral of the RI peak (delta_RI*min).
    flow_rate : float
        Mobile-phase flow rate (mL/min).

    Returns
    -------
    float
        dn/dc (mL/g), or NaN if any input is non-finite or non-positive.
    """
    vals = [ri_calibration_constant, ri_peak_area, flow_rate]
    if any(v is None for v in vals):
        return float(np.nan)
    if any(not np.isfinite(float(v)) for v in vals):
        return float(np.nan)
    if ri_peak_area <= 0 or flow_rate <= 0:
        return float(np.nan)
    return float(ri_calibration_constant / (ri_peak_area * flow_rate))
