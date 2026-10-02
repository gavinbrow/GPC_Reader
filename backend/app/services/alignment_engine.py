"""Interdetector alignment engine.

Design (Phase 2.4) + stub for the cross-correlation-based interdetector delay
estimation that mirrors Wyatt ASTRA's ``WDetermineInterDetectorDelayProcedure``.

This module is intentionally *not wired* into any route or procedure chain in
Phase 2.4 — the algorithm is implemented because it is pure NumPy/SciPy and
self-contained, but applying the delay (interpolation onto a common time grid)
is deferred to Phase 3a per ``architecture.md`` §6.

============================================================================
DESIGN — Interdetector alignment via normalized cross-correlation
============================================================================

Why alignment is needed
-----------------------
In a GPC/SEC system the detectors (MALS, UV, RI, viscometer) sit at different
points along the flow path. A given analyte slice therefore arrives at each
detector at a *different* time. Before signals from two detectors can be
combined (e.g. to compute molar mass from LS + RI, or to overlay chromatograms)
the signals must be shifted onto a common time axis. The size of that shift is
the **interdetector delay**, and it is the job of ASTRA procedure #4,
``WDetermineInterDetectorDelayProcedure`` (see ``architecture.md`` §11, and the
``WDirectoryEntry`` table in any .afe8).

Units
-----
The delay can be expressed in two equivalent units:

* **time** — minutes (``delay_min``). This is what the cross-correlation
  produces directly, because the input signals are indexed by time (min).
* **volume** — millilitres (``delay_ml``). Volume = time × flow rate, where
  the flow rate (mL/min) comes from ``WFluidConnectionProfile`` (the
  ``m_dInterdetectorVolume`` field is itself stored in mL) or from the HPLC
  device profile (``WHplcDeviceProfile`` flow-rate signal). When a flow rate
  is supplied to ``estimate_delay`` the returned dict includes ``delay_ml``;
  otherwise it is ``None``.

Reference vs. aligned detector
------------------------------
The **reference** detector is the one whose time axis is left unchanged; all
other detectors are shifted to match it. RI is the conventional reference
because its peaks are sharp and narrow, giving a well-localised
cross-correlation maximum. The signal to align is then LS (MALS). The design
does not hard-code this — ``estimate_delay`` takes ``time_ref``/``signal_ref``
and ``time_other``/``signal_other`` and is detector-agnostic; the choice of
which detector is the reference is made by the caller (the Phase 3a
orchestrator / route).

Algorithm
---------
1. **Preprocessing (optional).**
   * Baseline subtraction — reuse ``baseline_engine.subtract_baseline`` /
     ``compute_baseline`` so the cross-correlation is dominated by peak shape
     rather than DC offset. This is optional and controlled by the caller; the
     stub here accepts already-processed signals.
   * Smoothing — a light low-pass (e.g. ``scipy.signal.savgol_filter``) can be
     applied to suppress noise before correlation. Not done inside
     ``estimate_delay``; the caller decides.

2. **Resample onto a common uniform grid.**
   Cross-correlation by lag-shifting assumes the two signals share a common,
   ideally uniform, sample spacing. If ``time_ref`` and ``time_other`` are
   already on the same grid (the common case — both come from the same
   acquisition clock), the signals are used directly. If they differ in length
   or spacing, the non-reference signal is linearly interpolated onto the
   reference time grid (``numpy.interp``) before correlation. This keeps the
   lag-to-delay conversion a simple multiplication by the sample spacing.

3. **Normalized cross-correlation over a bounded lag window.**
   Rather than computing the full ``scipy.signal.correlate`` (which is O(N²)
   and explores delays far outside the physical range), we restrict the search
   to ``±search_window_min`` around zero lag. This is both faster and more
   robust: it avoids spurious maxima at large, physically-meaningless delays.

   For each candidate lag ``k`` (in samples) within the window we compute the
   normalized cross-correlation coefficient:

       r(k) = Σ [(s_ref[i] - μ_ref) · (s_other[i+k] - μ_other)]
              / (σ_ref · σ_other · N_overlap)

   The normalization makes ``r`` range in ``[-1, 1]`` and independent of the
   two signals' absolute amplitudes, so a tall LS peak and a small RI peak can
   still correlate well. The lag ``k*`` maximising ``r(k)`` is the best
   interdetector delay in samples.

   Implementation: ``scipy.signal.correlate`` with ``method="direct"`` on the
   mean-subtracted, unit-variance-normalised signals, then crop the resulting
   lag axis to the search window. (For very long signals an FFT method is
   available, but ``method="auto"`` lets SciPy choose.)

4. **Convert lag to physical delay.**
   ``delay_min = k* · dt`` where ``dt`` is the (uniform) sample spacing in
   minutes, derived from the reference time axis. Sign convention: a positive
   ``delay_min`` means the *other* detector lags the reference — i.e. its
   signal arrives *later*, so to align it we **subtract** the delay from its
   time axis (see ``apply_alignment``).

5. **Volume conversion.**
   If ``flow_rate_ml_min`` is provided,
   ``delay_ml = delay_min · flow_rate_ml_min``.

Search range
------------
Default ``search_window_min = 0.5`` min. For a typical 1.0 mL/min flow this is
±0.5 mL, which comfortably spans real interdetector volumes (typically
0.05–0.25 mL for DAWN→Optilab). The window is sampled at the detector's time
resolution (``dt``), so ``n_lags = 2 · round(search_window_min / dt) + 1``.

Manual override
---------------
A user may enter a delay directly (in min or mL) instead of trusting the
cross-correlation. The Phase 3a orchestrator will store the manual value in
the ``procedure_states`` table / ``WFluidConnectionProfile`` and skip
estimation. ``estimate_delay`` is only called when no manual override is
present. A convenience for converting a manual mL value to minutes is:
``delay_min = delay_ml / flow_rate_ml_min``.

Applying the alignment (Phase 3a — stubbed here)
------------------------------------------------
Once a delay is known, the non-reference detector's time axis is shifted by
``-delay_min`` so its peaks line up with the reference. If the two detectors
must end up on an *identical* grid (for slice-by-slice molar-mass math), the
aligned signal is re-interpolated onto the reference grid. That interpolation
is Phase 3a work; ``apply_alignment`` here is a simple time-shift stub.

Reference
---------
Wyatt ASTRA ``WDetermineInterDetectorDelayProcedure`` — the corresponding
table (``WDetermineInterDetectorDelayProcedure``) exists in every .afe8 and
holds the procedure's stored parameters/results. See ``architecture.md`` §11
for the full procedure chain.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from scipy import signal as scipy_signal


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, 0.0)


def _uniform_dt(time: np.ndarray) -> Optional[float]:
    """Return the median sample spacing of *time*, or None if empty."""
    if time.size < 2:
        return None
    diffs = np.diff(time)
    diffs = diffs[np.isfinite(diffs)]
    if diffs.size == 0:
        return None
    return float(np.median(diffs))


def estimate_delay(
    time_ref,
    signal_ref,
    time_other,
    signal_other,
    search_window_min: float = 0.5,
    flow_rate_ml_min: Optional[float] = None,
) -> dict:
    """Estimate the interdetector delay between two detector signals.

    Parameters
    ----------
    time_ref, signal_ref : array-like
        Time axis (min) and signal of the **reference** detector (typically RI).
    time_other, signal_other : array-like
        Time axis (min) and signal of the detector to align (typically LS).
    search_window_min : float
        Half-width of the lag search window in minutes. Only lags within
        ``±search_window_min`` are evaluated.
    flow_rate_ml_min : float, optional
        HPLC flow rate in mL/min. If supplied, the returned dict includes
        ``delay_ml``.

    Returns
    -------
    dict
        ``{"delay_min": float|None, "delay_ml": float|None,
           "correlation": float|None, "n_lags": int}``

        * ``delay_min`` — signed delay in minutes. Positive means the *other*
          detector lags the reference (shift its time axis by ``-delay_min``).
        * ``delay_ml`` — ``delay_min · flow_rate_ml_min`` if a flow rate was
          given, else ``None``.
        * ``correlation`` — the normalised cross-correlation value at the
          chosen lag (in ``[-1, 1]``).
        * ``n_lags`` — number of candidate lags evaluated.
        Any of the float fields is ``None`` when the inputs are too short or
        degenerate to estimate a delay.
    """
    t_ref = _clean(time_ref)
    s_ref = _clean(signal_ref)
    t_other = _clean(time_other)
    s_other = _clean(signal_other)

    n_ref = t_ref.size
    n_other = t_other.size
    if n_ref < 2 or n_other < 2 or len(s_ref) != n_ref or len(s_other) != n_other:
        return {"delay_min": None, "delay_ml": None, "correlation": None, "n_lags": 0}

    dt = _uniform_dt(t_ref)
    if dt is None or dt <= 0:
        return {"delay_min": None, "delay_ml": None, "correlation": None, "n_lags": 0}

    if t_other.size != t_ref.size or not np.allclose(t_other, t_ref, atol=dt * 1e-3):
        s_other = np.interp(t_ref, t_other, s_other)

    n = t_ref.size
    max_lag = max(1, int(round(search_window_min / dt)))
    max_lag = min(max_lag, n - 1)
    n_lags = 2 * max_lag + 1

    r = s_ref - s_ref.mean()
    o = s_other - s_other.mean()
    r_norm = np.sqrt(np.dot(r, r))
    o_norm = np.sqrt(np.dot(o, o))
    if r_norm == 0 or o_norm == 0:
        return {"delay_min": None, "delay_ml": None, "correlation": None, "n_lags": n_lags}

    full = scipy_signal.correlate(o, r, mode="full")
    center = full.size // 2
    lo = max(0, center - max_lag)
    hi = min(full.size, center + max_lag + 1)
    window = full[lo:hi]
    denom = r_norm * o_norm
    window_norm = window / denom if denom != 0 else window

    rel_offsets = np.arange(lo, hi) - center
    best_idx = int(np.argmax(window_norm))
    best_lag = int(rel_offsets[best_idx])
    best_corr = float(window_norm[best_idx])
    delay_min = float(best_lag * dt)

    delay_ml = None
    if flow_rate_ml_min is not None and flow_rate_ml_min > 0:
        delay_ml = delay_min * float(flow_rate_ml_min)

    return {
        "delay_min": delay_min,
        "delay_ml": delay_ml,
        "correlation": best_corr,
        "n_lags": int(n_lags),
    }


def apply_alignment(time, signal, delay_min: float, ref_time=None):
    """Shift a detector's time axis by the interdetector delay and optionally
    interpolate onto a reference time grid.

    The non-reference detector's time axis is shifted by ``-delay_min`` so its
    peaks line up with the reference.  If ``ref_time`` is provided, the shifted
    signal is linearly interpolated onto that grid (``numpy.interp``) so all
    detectors share an identical time axis.

    Parameters
    ----------
    time : array-like
        Detector time axis (minutes).
    signal : array-like
        Detector signal (1-D for a scalar detector; for a 2-D MALS matrix the
        caller should interpolate each column separately — this function only
        handles 1-D).
    delay_min : float or None
        Interdetector delay in minutes. Positive means the other detector lags
        the reference (shift its time axis by ``-delay_min``).
    ref_time : array-like, optional
        Reference time grid to interpolate onto.  If None, the shifted
        ``(time - delay_min, signal)`` is returned without interpolation.

    Returns
    -------
    (np.ndarray, np.ndarray)
        ``(aligned_time, aligned_signal)``.  If ``ref_time`` is given,
        ``aligned_time`` is ``ref_time``; otherwise it is the shifted input.
    """
    t = _clean(time)
    s = _clean(signal)
    if t.size == 0:
        return t, s
    if delay_min is not None and np.isfinite(delay_min):
        t_shifted = t - float(delay_min)
    else:
        t_shifted = t
    if ref_time is None:
        return t_shifted, s
    ref = _clean(ref_time)
    if ref.size == 0:
        return t_shifted, s
    finite = np.isfinite(t_shifted) & np.isfinite(s)
    if finite.sum() < 2:
        return ref, np.full_like(ref, np.nan)
    s_interp = np.interp(ref, t_shifted[finite], s[finite])
    return ref, s_interp


def align_detectors(detectors: dict, delays: dict, reference: str | None = None) -> dict:
    """Apply a set of interdetector delays and align all detectors onto one grid.

    Each non-reference detector's time axis is shifted by its delay and
    interpolated onto the reference detector's time grid.

    When no detector carries a 2-D ``"values"`` matrix (the simple 1-D
    "signal"-only format used by the Phase 2.4 stub tests), the input
    ``detectors`` dict is returned unchanged so callers that only need
    1-D alignment can use :func:`apply_alignment` directly.

    Parameters
    ----------
    detectors : dict
        Mapping of detector code -> ``{"time": [...], "signal": [...]}``.
        For 2-D MALS/UV the value should have ``"values"`` (2-D ndarray) and
        ``"time"`` (1-D ndarray); these are interpolated column-by-column.
    delays : dict
        Mapping of detector code -> delay in minutes.  The reference detector
        is expected to have a delay of 0.0 or be absent.
    reference : str, optional
        Detector code whose time grid is the reference.  If None, the first
        detector in ``detectors`` is used.

    Returns
    -------
    dict
        New mapping of detector code -> ``{"time": ref_time, "values": ...}``
        where all detectors share the reference time axis.  Returns the input
        unchanged when no 2-D matrices are present.
    """
    if not detectors:
        return {}
    has_matrix = any("values" in d and d["values"] is not None for d in detectors.values())
    if not has_matrix:
        return detectors
    if reference is None:
        reference = next(iter(detectors))
    if reference not in detectors:
        return detectors

    ref_data = detectors[reference]
    ref_time = np.asarray(ref_data.get("time", []), dtype=float)
    if ref_time.size == 0:
        return detectors

    result: dict = {}
    result[reference] = {"time": ref_time, "signal": ref_data.get("signal")}
    if "values" in ref_data:
        result[reference]["values"] = ref_data["values"]

    for code, data in detectors.items():
        if code == reference:
            continue
        delay = delays.get(code, 0.0)
        t = np.asarray(data.get("time", []), dtype=float)
        sig = data.get("signal")
        vals = data.get("values")

        if vals is not None and vals.ndim == 2:
            if t.size == 0 or t.shape[0] != vals.shape[0]:
                result[code] = data
                continue
            t_shifted = t - float(delay) if delay is not None and np.isfinite(delay) else t
            aligned = np.empty((ref_time.size, vals.shape[1]))
            for j in range(vals.shape[1]):
                finite = np.isfinite(t_shifted) & np.isfinite(vals[:, j])
                if finite.sum() < 2:
                    aligned[:, j] = np.nan
                else:
                    aligned[:, j] = np.interp(ref_time, t_shifted[finite], vals[finite, j])
            result[code] = {"time": ref_time, "values": aligned}
        elif sig is not None:
            t_a, s_a = apply_alignment(t, sig, delay, ref_time=ref_time)
            result[code] = {"time": t_a, "signal": s_a}
        else:
            result[code] = data

    return result
