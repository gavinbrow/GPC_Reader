"""Absorption correction for absorbing samples in GPC/SEC.

When a sample absorbs light at the laser wavelength, the MALS signal is
attenuated as the beam passes through the flow cell.  The forward monitor
( transmitted light ) measures this absorption.  The correction factor is:

    I_corrected = I_measured / T

where ``T`` is the transmittance (forward monitor / incident intensity).

If the forward monitor signal drops significantly in the peak region compared
to the baseline ( pure solvent ), the MALS signal is corrected by dividing by
the transmittance.  This prevents overestimation of molar mass for absorbing
samples.

The corrected Rayleigh ratio is:

    R_corrected(theta) = R_measured(theta) / T(slice)

where ``T(slice) = FM(slice) / FM_baseline`` and ``FM`` is the forward monitor
signal.

The corrected molar mass is then computed from the corrected R values.  Since
``M ~ 1/R``, if R is reduced by absorption (T < 1), the uncorrected M is
overestimated.  The correction brings M back to its true value:

    M_corrected = M_uncorrected * T
"""

from __future__ import annotations

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def compute_transmittance(
    forward_monitor: np.ndarray,
    time_axis: np.ndarray,
    peak_start: float,
    peak_end: float,
    baseline_pct: float = 10.0,
) -> np.ndarray:
    """Compute per-slice transmittance from the forward monitor signal.

    The baseline ( pure solvent ) transmittance is estimated from the regions
    outside the peak.  The per-slice transmittance is:

        T(slice) = FM(slice) / FM_baseline

    where ``FM_baseline`` is the mean of the forward monitor signal in the
    baseline regions ( outside the peak window ).

    Parameters
    ----------
    forward_monitor : array-like
        Forward monitor signal ( transmitted intensity ).
    time_axis : array-like
        Time axis in minutes.
    peak_start : float
        Peak start time in minutes.
    peak_end : float
        Peak end time in minutes.
    baseline_pct : float
        Percentage of the pre-peak and post-peak regions to use for baseline
        estimation ( default 10% of the total run on each side ).

    Returns
    -------
    np.ndarray
        Per-slice transmittance ( same length as forward_monitor ).
        Values > 1 are clipped to 1.0 ( no amplification ).
    """
    fm = _clean(forward_monitor)
    t = _clean(time_axis)
    n = min(fm.size, t.size)
    if n == 0:
        return np.array([])
    fm = fm[:n]
    t = t[:n]

    in_peak = (t >= peak_start) & (t <= peak_end)
    outside = ~in_peak & np.isfinite(fm) & (fm > 0)

    if outside.sum() < 3:
        fm_baseline = float(np.nanmedian(fm[np.isfinite(fm) & (fm > 0)])) if np.any(np.isfinite(fm) & (fm > 0)) else np.nan
    else:
        fm_baseline = float(np.nanmean(fm[outside]))

    if not np.isfinite(fm_baseline) or fm_baseline <= 0:
        return np.ones(n)

    transmittance = fm / fm_baseline
    transmittance = np.where(np.isfinite(transmittance), transmittance, 1.0)
    transmittance = np.clip(transmittance, 0.01, 1.0)
    return transmittance


def correct_mals_signal(
    mals_data: np.ndarray,
    forward_monitor: np.ndarray,
    time_axis: np.ndarray,
    peak_start: float,
    peak_end: float,
    baseline_pct: float = 10.0,
) -> dict:
    """Correct MALS signal for sample absorption.

    Divides the MALS signal at each slice by the transmittance to recover
    the true scattering intensity.

    Parameters
    ----------
    mals_data : array-like (2-D: n_slices x n_angles)
        Raw MALS Rayleigh ratios or voltages.
    forward_monitor : array-like
        Forward monitor signal.
    time_axis : array-like
        Time axis in minutes.
    peak_start : float
        Peak start time.
    peak_end : float
        Peak end time.
    baseline_pct : float
        Percentage of baseline regions for transmittance estimation.

    Returns
    -------
    dict
        ``{"corrected_mals": ndarray, "transmittance": ndarray,
           "mean_transmittance_in_peak": float,
           "absorption_detected": bool}``.
    """
    R = _clean(mals_data)
    fm = _clean(forward_monitor)
    t = _clean(time_axis)

    if R.ndim != 2 or R.size == 0:
        return {"corrected_mals": np.array([]), "transmittance": np.array([]),
                "mean_transmittance_in_peak": np.nan, "absorption_detected": False}

    n_slices = R.shape[0]
    n = min(n_slices, fm.size, t.size)
    R = R[:n]
    fm = fm[:n]
    t = t[:n]

    T = compute_transmittance(fm, t, peak_start, peak_end, baseline_pct)

    T_2d = T[:, np.newaxis]
    R_corrected = R / T_2d
    R_corrected = np.where(np.isfinite(R_corrected), R_corrected, np.nan)

    in_peak = (t >= peak_start) & (t <= peak_end)
    T_in_peak = T[in_peak]
    mean_T = float(np.nanmean(T_in_peak)) if T_in_peak.size > 0 else np.nan
    absorption = np.isfinite(mean_T) and mean_T < 0.95

    return {"corrected_mals": R_corrected, "transmittance": T,
            "mean_transmittance_in_peak": mean_T,
            "absorption_detected": bool(absorption)}


def correct_molar_mass(
    molar_mass: np.ndarray,
    forward_monitor: np.ndarray,
    time_axis: np.ndarray,
    peak_start: float,
    peak_end: float,
    baseline_pct: float = 10.0,
) -> dict:
    """Correct molar mass for absorption.

    Since ``M ~ 1/R`` and absorption reduces R by factor T, the uncorrected
    M is overestimated by ``1/T``.  The corrected M is:

        M_corrected = M_uncorrected * T

    Parameters
    ----------
    molar_mass : array-like
        Uncorrected per-slice molar mass.
    forward_monitor : array-like
        Forward monitor signal.
    time_axis : array-like
        Time axis in minutes.
    peak_start : float
        Peak start time.
    peak_end : float
        Peak end time.
    baseline_pct : float
        Baseline percentage for transmittance estimation.

    Returns
    -------
    dict
        ``{"corrected_molar_mass": ndarray, "transmittance": ndarray,
           "correction_factor_mean": float,
           "absorption_detected": bool}``.
    """
    M = _clean(molar_mass)
    fm = _clean(forward_monitor)
    t = _clean(time_axis)

    n = min(M.size, fm.size, t.size)
    if n == 0:
        return {"corrected_molar_mass": np.array([]), "transmittance": np.array([]),
                "correction_factor_mean": np.nan, "absorption_detected": False}

    M = M[:n]
    fm = fm[:n]
    t = t[:n]

    T = compute_transmittance(fm, t, peak_start, peak_end, baseline_pct)
    M_corrected = M * T
    M_corrected = np.where(np.isfinite(M_corrected), M_corrected, np.nan)

    in_peak = (t >= peak_start) & (t <= peak_end)
    T_in_peak = T[in_peak]
    mean_T = float(np.nanmean(T_in_peak)) if T_in_peak.size > 0 else np.nan
    absorption = np.isfinite(mean_T) and mean_T < 0.95

    return {"corrected_molar_mass": M_corrected, "transmittance": T,
            "correction_factor_mean": mean_T,
            "absorption_detected": bool(absorption)}
