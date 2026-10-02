"""Procedure orchestrator — runs the ASTRA analysis procedure chain.

The orchestrator loads raw chromatogram data (full resolution via
:class:`astra_reader.AstraReader`), applies stored baselines, aligns
detectors (RI reference), normalizes MALS, converts to physical units,
computes per-slice molar mass via the Zimm fit, and derives moments
(Mn/Mw/Mz/Pd) for each peak.

Results are written to the ``peaks`` and ``computed_data`` tables, and
``procedure_states`` rows record which procedures have run.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Optional

import numpy as np
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    Baseline,
    ComputedData,
    Experiment,
    Peak,
    ProcedureState,
)
from app.services.alignment_engine import estimate_delay
from app.services.band_broadening import apply_band_broadening_correction
from app.services.baseline_engine import auto_baseline, compute_baseline, subtract_baseline
from app.services.concentration import (
    combine_concentrations,
    concentration_from_ri,
    concentration_from_uv,
)
from app.services.molar_mass import compute_molar_mass, optical_constant, select_angles
from app.services.moments import compute_moments
from app.services.peak_areas import peak_area

logger = logging.getLogger(__name__)

THF_RI = 1.401

PROCEDURE_CHAIN = [
    ("despiking", 1),
    ("baseline", 2),
    ("alignment", 3),
    ("normalization", 4),
    ("physical_units", 5),
    ("band_broadening", 6),
    ("concentration", 7),
    ("molar_mass", 8),
    ("moments", 9),
    ("peak_areas", 10),
    ("distributions", 11),
]

_DEFAULT_DISABLED = {"band_broadening"}

_PROCEDURE_PCT = {name: round((i + 1) / len(PROCEDURE_CHAIN) * 100) for i, (name, _) in enumerate(PROCEDURE_CHAIN)}


def _get_config(experiment: Experiment, field: str) -> dict:
    raw = getattr(experiment, field, None)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


def _find_ri_signal(reader) -> Optional[tuple]:
    """Return (time, signal) for the RI raw signal (code 12025)."""
    for v in reader.vector_data:
        if v.instrument_class == "WNGOInstrumentProfile" and v.data_name_code == 12025:
            if v.data_values.size > 10:
                return np.asarray(v.index_values, dtype=float), np.asarray(v.data_values, dtype=float)
    ri_chrom = reader.get_ri_chromatogram()
    if ri_chrom is not None and ri_chrom.data_values.size > 10:
        return np.asarray(ri_chrom.index_values, dtype=float), np.asarray(ri_chrom.data_values, dtype=float)
    return None


def _find_mals_matrix(reader) -> Optional[tuple]:
    """Return (time, angles, values_2d) for the 8-column MALS matrix."""
    best = None
    best_cols = 0
    for m in reader.matrix_data:
        if m.instrument_class in ("WHeleos8Profile", "WHeleosNeonProfile", "WMiniDawnProfile", "WTreosProfile"):
            if m.values.ndim == 2 and m.values.shape[1] > best_cols:
                best = m
                best_cols = m.values.shape[1]
    if best is not None:
        return (np.asarray(best.row_index, dtype=float),
                np.asarray(best.column_index, dtype=float),
                np.asarray(best.values, dtype=float))
    mc = reader.get_mals_chromatogram()
    if mc is not None and mc.values.ndim == 2:
        return (np.asarray(mc.row_index, dtype=float),
                np.asarray(mc.column_index, dtype=float),
                np.asarray(mc.values, dtype=float))
    return None


def _find_uv_matrix(reader) -> Optional[tuple]:
    """Return (time, channels, values_2d) for the UV matrix, or None."""
    for m in reader.matrix_data:
        if m.instrument_class == "WHplcUVDeviceProfile":
            if m.values.ndim == 2 and m.values.size > 0:
                return (np.asarray(m.row_index, dtype=float),
                        np.asarray(m.column_index, dtype=float),
                        np.asarray(m.values, dtype=float))
    return None


def _detector_config_angles(mals_config: dict, n_cols: int) -> np.ndarray:
    angles = mals_config.get("detector_angles", [])
    arr = np.asarray(angles, dtype=float) if angles else np.array([])
    if arr.size < n_cols:
        arr = np.pad(arr, (0, n_cols - arr.size), constant_values=90.0)
    return arr[:n_cols]


def _get_solvent_ri(sample_config: dict) -> float:
    real_ri = float(sample_config.get("real_ri", 0.0) or 0.0)
    if 1.30 <= real_ri <= 1.45:
        return real_ri
    return THF_RI


def _detector_processing(processing: dict, det: str) -> tuple[float, float]:
    """Return (shift_min, broaden_sigma_min) for a detector from the stored
    ``sample_config.processing`` map (the same values the chromatogram view
    uses).  Missing entries default to (0, 0)."""
    if not isinstance(processing, dict):
        return 0.0, 0.0
    d = processing.get(det) or {}
    try:
        shift = float(d.get("shift", 0.0) or 0.0)
    except (TypeError, ValueError):
        shift = 0.0
    try:
        broaden = float(d.get("broaden", 0.0) or 0.0)
    except (TypeError, ValueError):
        broaden = 0.0
    return shift, broaden


def _gaussian_broaden(time, y, sigma_min: float):
    """Convolve a 1-D signal with a Gaussian of width ``sigma_min`` (minutes),
    with nearest-value (clamped) edges.  Mirrors the frontend
    ``lib/processing.ts`` ``gaussianBroaden1d`` so what the user sees on the
    chromatogram is what the analysis computes.  A no-op when the width is
    narrower than the sampling resolution."""
    y = np.asarray(y, dtype=float)
    if sigma_min is None or sigma_min <= 0 or y.size < 3:
        return y
    t = np.asarray(time, dtype=float)
    if t.size < 2:
        return y
    dt = float(np.median(np.diff(t)))
    if not np.isfinite(dt) or dt <= 0:
        return y
    sigma_samples = sigma_min / dt
    if sigma_samples < 0.25:
        return y
    radius = max(1, int(np.ceil(sigma_samples * 3)))
    idx = np.arange(-radius, radius + 1)
    kernel = np.exp(-(idx ** 2) / (2.0 * sigma_samples ** 2))
    kernel /= kernel.sum()
    yy = np.where(np.isfinite(y), y, 0.0)
    padded = np.pad(yy, (radius, radius), mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def _ensure_procedure_states(db: Session, experiment_id: int) -> None:
    existing = {ps.procedure_name: ps for ps in db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id).all()}
    for name, order in PROCEDURE_CHAIN:
        if name not in existing:
            ps = ProcedureState(
                experiment_id=experiment_id,
                procedure_name=name,
                procedure_order=order,
                is_enabled=name not in _DEFAULT_DISABLED,
                has_been_run=False,
                version=1,
            )
            db.add(ps)
        elif name in _DEFAULT_DISABLED:
            ps = existing[name]
            if not ps.parameters:
                ps.is_enabled = False
    db.flush()


def _get_procedure_state(db: Session, experiment_id: int, name: str) -> Optional[ProcedureState]:
    return db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id,
        ProcedureState.procedure_name == name,
    ).first()


def _procedure_params(ps: Optional[ProcedureState]) -> dict:
    if ps is None or not ps.parameters:
        return {}
    try:
        return json.loads(ps.parameters)
    except (json.JSONDecodeError, TypeError):
        return {}


def _mark_procedure_run(db: Session, experiment_id: int, name: str) -> None:
    ps = db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id,
        ProcedureState.procedure_name == name,
    ).first()
    if ps is not None:
        ps.has_been_run = True
        ps.version = ps.version + 1
    else:
        order = next((o for n, o in PROCEDURE_CHAIN if n == name), 99)
        ps = ProcedureState(
            experiment_id=experiment_id,
            procedure_name=name,
            procedure_order=order,
            is_enabled=True,
            has_been_run=True,
            version=1,
        )
        db.add(ps)
    db.flush()


def _audit(db: Session, experiment_id: int, action: str, entity_id: int | None, changes: dict):
    log = AuditLog(
        experiment_id=experiment_id,
        user_id=None,
        action=action,
        entity_type="procedure",
        entity_id=entity_id,
        changes=json.dumps(changes, default=str),
    )
    db.add(log)


def run_analysis(
    experiment_id: int,
    db: Session,
    peak_id: int | None = None,
    progress_callback: Optional[Callable[[str, float, str], None]] = None,
) -> dict:
    """Run the full analysis procedure chain for an experiment.

    Parameters
    ----------
    experiment_id : int
        Experiment to analyse.
    db : Session
        Database session.
    peak_id : int, optional
        If set, only analyse the specified peak.
    progress_callback : callable, optional
        If supplied, called as ``progress_callback(procedure_name, pct, message)``
        after each procedure step completes.  Used by the WebSocket progress
        endpoint to stream updates to connected clients.

    Returns
    -------
    dict
        ``{"experiment_id": int, "peaks": [...], "message": str}``
    """

    def _progress(name: str, pct: float, msg: str) -> None:
        if progress_callback is not None:
            try:
                progress_callback(name, pct, msg)
            except Exception:
                logger.debug("progress_callback raised", exc_info=True)

    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        return {"experiment_id": experiment_id, "peaks": [], "message": "Experiment not found"}
    if not experiment.raw_data_path:
        return {"experiment_id": experiment_id, "peaks": [], "message": "No raw data path"}

    mals_config = _get_config(experiment, "mals_config")
    ri_config = _get_config(experiment, "ri_config")
    sample_config = _get_config(experiment, "sample_config")
    uv_config = _get_config(experiment, "uv_config")

    dn_dc = float(sample_config.get("dn_dc", 0.0) or 0.0)
    if dn_dc <= 0:
        dn_dc = 0.185
    n0 = _get_solvent_ri(sample_config)
    # Per-detector display corrections (inter-detector alignment + band
    # broadening) that the user set on the chromatogram.  These feed the
    # molar-mass computation so "what you see is what you compute" — the same
    # workflow ASTRA uses to bring a standard onto its nominal Mw / Dispersity.
    processing = sample_config.get("processing") or {}
    shift_ri, broaden_ri = _detector_processing(processing, "RI")
    shift_mals, broaden_mals = _detector_processing(processing, "MALS")
    shift_uv, broaden_uv = _detector_processing(processing, "UV")
    manual_align = shift_ri != 0.0 or shift_mals != 0.0
    wavelength_nm = float(mals_config.get("wavelength", 658.0) or 658.0)
    norm_coeffs_raw = mals_config.get("normalization_coefficients", [])
    norm_coeffs = np.asarray(norm_coeffs_raw, dtype=float) if norm_coeffs_raw else np.array([1.0])
    calib_const = float(mals_config.get("calibration_constant", 1.0) or 1.0)

    _ensure_procedure_states(db, experiment_id)
    _progress("despiking", _PROCEDURE_PCT["despiking"], "Procedure 'despiking' complete")

    from astra_reader import AstraReader
    reader = AstraReader(experiment.raw_data_path)
    try:
        ri_data = _find_ri_signal(reader)
        mals_data = _find_mals_matrix(reader)
        uv_data = _find_uv_matrix(reader)
    finally:
        reader.close()

    if ri_data is None or mals_data is None:
        logger.warning("run_analysis: missing RI or MALS data for experiment %s", experiment_id)
        return {"experiment_id": experiment_id, "peaks": [], "message": "Missing RI or MALS data"}

    t_ri, s_ri = ri_data
    t_m, det_nums, vals_m = mals_data
    angles = _detector_config_angles(mals_config, vals_m.shape[1])
    n_angles = vals_m.shape[1]
    if norm_coeffs.size < n_angles:
        norm_coeffs = np.pad(norm_coeffs, (0, n_angles - norm_coeffs.size), constant_values=1.0)
    norm_coeffs = norm_coeffs[:n_angles]

    stored_baselines = {b.detector_name: b for b in db.query(Baseline).filter(
        Baseline.experiment_id == experiment_id).all()}

    peaks_for_bl = db.query(Peak).filter(Peak.experiment_id == experiment_id).all()
    peak_bounds = []
    for p in peaks_for_bl:
        if p.range_start and p.range_end and p.range_start > 0 and p.range_end > p.range_start:
            peak_bounds.append((p.range_start, p.range_end))
    if not peak_bounds:
        peak_bounds = [(float(t_ri.min()), float(t_ri.max()) * 0.5)]

    bl_ri = None
    if "RI" in stored_baselines and stored_baselines["RI"].baseline_type == 0:
        b = stored_baselines["RI"]
        bl_arr, _, _, _ = compute_baseline(t_ri, s_ri, b.baseline_type,
                                           b.x1, b.x2, b.y1, b.y2)
        bl_ri = bl_arr
    if bl_ri is None:
        bl_ri, _, _, _ = auto_baseline(t_ri, s_ri)
    s_ri_sub = subtract_baseline(s_ri, bl_ri)
    if broaden_ri > 0:
        s_ri_sub = _gaussian_broaden(t_ri, s_ri_sub, broaden_ri)
    _mark_procedure_run(db, experiment_id, "baseline")
    _progress("baseline", _PROCEDURE_PCT["baseline"], "Procedure 'baseline' complete")

    bl_mals = np.zeros_like(vals_m)
    use_stored_mals_bl = "MALS" in stored_baselines and stored_baselines["MALS"].baseline_type == 0
    if use_stored_mals_bl:
        b = stored_baselines["MALS"]
        for j in range(n_angles):
            bl_j, _, _, _ = compute_baseline(t_m, vals_m[:, j], b.baseline_type,
                                             b.x1, b.x2, b.y1, b.y2)
            bl_mals[:, j] = bl_j
    else:
        x1_pk = min(b[0] for b in peak_bounds)
        x2_pk = max(b[1] for b in peak_bounds)
        for j in range(n_angles):
            bl_j, _, _, _ = compute_baseline(t_m, vals_m[:, j], 0,
                                             x1=x1_pk, x2=x2_pk)
            bl_mals[:, j] = bl_j
    vals_m_sub = subtract_baseline(vals_m, bl_mals)

    mals_summary = np.nanmean(vals_m_sub, axis=1) if vals_m_sub.ndim == 2 else vals_m_sub
    delay_result = estimate_delay(t_ri, s_ri_sub, t_m, mals_summary, search_window_min=0.5)
    delay_mals = delay_result.get("delay_min") or 0.0

    # Time on the RI axis at which to sample the concentration for each MALS
    # slice.  When the user has manually aligned the detectors on the
    # chromatogram, honour that (WYSIWYG): the RI concentration for MALS slice
    # i comes from RI time  t_m + (shift_MALS - shift_RI).  Otherwise fall back
    # to the automatically estimated inter-detector delay (cross-correlation).
    # Previously the estimated delay was computed and then thrown away
    # (c_ri_on_m was dead), so concentration and light-scattering were sampled
    # at the same raw time — misaligned by the physical inter-detector volume,
    # which smeared molar mass across the peak and inflated the dispersity.
    if manual_align:
        conc_sample_time = t_m + (shift_mals - shift_ri)
    else:
        conc_sample_time = t_m - delay_mals

    # Rayleigh ratio.  The solvent refractive-index-squared factor (n0^2) is the
    # scattering correction ASTRA applies but our raw calibration constant
    # omitted; without it absolute molar mass came out ~2x low (validated
    # against the PS 30k and 200k standards, which land on their nominal Mw
    # once n0^2 is included).
    ri_correction = n0 ** 2
    R_theta = np.zeros_like(vals_m_sub)
    for j in range(n_angles):
        nc = norm_coeffs[j] if np.isfinite(norm_coeffs[j]) and norm_coeffs[j] != 0 else 1.0
        R_theta[:, j] = vals_m_sub[:, j] / nc * calib_const * ri_correction
    if broaden_mals > 0:
        for j in range(n_angles):
            R_theta[:, j] = _gaussian_broaden(t_m, R_theta[:, j], broaden_mals)

    if uv_data is not None:
        t_uv, _, vals_uv = uv_data
        uv_summary = np.nanmean(vals_uv, axis=1) if vals_uv.ndim == 2 else vals_uv
        delay_uv_result = estimate_delay(t_ri, s_ri_sub, t_uv, uv_summary, search_window_min=0.5)
        delay_uv = delay_uv_result.get("delay_min") or 0.0
        # Same WYSIWYG rule as RI: honour the user's manual UV alignment when set,
        # otherwise use the auto-estimated UV delay.  Positive t_uv_shift moves
        # the UV signal onto the MALS grid at the aligned time.
        if manual_align or shift_uv != 0.0:
            t_uv_shifted = t_uv + (shift_uv - shift_mals)
        else:
            t_uv_shifted = t_uv - delay_uv
        vals_uv_aligned = np.empty((t_m.shape[0], vals_uv.shape[1]))
        for j in range(vals_uv.shape[1]):
            col = _gaussian_broaden(t_uv, vals_uv[:, j], broaden_uv) if broaden_uv > 0 else vals_uv[:, j]
            finite = np.isfinite(t_uv_shifted) & np.isfinite(col)
            if finite.sum() > 1:
                vals_uv_aligned[:, j] = np.interp(t_m, t_uv_shifted[finite], col[finite])
            else:
                vals_uv_aligned[:, j] = np.nan
    else:
        vals_uv_aligned = None
    _mark_procedure_run(db, experiment_id, "alignment")
    _progress("alignment", _PROCEDURE_PCT["alignment"], "Procedure 'alignment' complete")
    _mark_procedure_run(db, experiment_id, "normalization")
    _progress("normalization", _PROCEDURE_PCT["normalization"], "Procedure 'normalization' complete")
    _mark_procedure_run(db, experiment_id, "physical_units")
    _progress("physical_units", _PROCEDURE_PCT["physical_units"], "Procedure 'physical_units' complete")

    bb_state = _get_procedure_state(db, experiment_id, "band_broadening")
    bb_enabled = bb_state is not None and bb_state.is_enabled
    bb_params = _procedure_params(bb_state)
    if bb_enabled and not bb_params.get("enabled", False):
        bb_enabled = False
    if bb_enabled:
        bb_params["enabled"] = True
        s_ri_sub = apply_band_broadening_correction(t_ri, s_ri_sub, bb_params)
        for j in range(n_angles):
            R_theta[:, j] = apply_band_broadening_correction(t_m, R_theta[:, j], bb_params)
        if vals_uv_aligned is not None:
            for j in range(vals_uv_aligned.shape[1]):
                vals_uv_aligned[:, j] = apply_band_broadening_correction(
                    t_m, vals_uv_aligned[:, j], bb_params)
    _mark_procedure_run(db, experiment_id, "band_broadening")
    _progress("band_broadening", _PROCEDURE_PCT["band_broadening"], "Procedure 'band_broadening' complete")

    c_ri = concentration_from_ri(s_ri_sub, dn_dc)
    c_on_m = np.interp(conc_sample_time, t_ri, c_ri)
    c_final = c_on_m
    if vals_uv_aligned is not None and uv_config:
        cell_length = float(uv_config.get("cell_length", 10.0) or 10.0)
        extinction = float(sample_config.get("uv_extinction_coefficient", 0.0) or 0.0)
        if extinction > 0 and cell_length > 0:
            uv_col = 0
            if vals_uv_aligned.shape[1] > 0:
                c_uv = concentration_from_uv(vals_uv_aligned[:, uv_col], extinction, cell_length)
                c_uv_on_m = c_uv
                c_final = combine_concentrations(c_on_m, c_uv_on_m)
    _mark_procedure_run(db, experiment_id, "concentration")
    _progress("concentration", _PROCEDURE_PCT["concentration"], "Procedure 'concentration' complete")

    peaks_query = db.query(Peak).filter(Peak.experiment_id == experiment_id)
    if peak_id is not None:
        peaks_query = peaks_query.filter(Peak.id == peak_id)
    peaks = peaks_query.order_by(Peak.range_number).all()

    K = optical_constant(n0, dn_dc, wavelength_nm)
    lambda_sol = (wavelength_nm * 1e-9) / n0
    theta_rad = np.deg2rad(angles)
    x_all = np.sin(theta_rad / 2.0) ** 2

    # Choose the reference peak for the global angle-selection mask.  It must be
    # a peak with a real, bounded range — NOT a placeholder like the
    # range_number = -1 / (0, 0) row that sorts first.  A dummy peak's
    # ``range_start or t_m.min()`` expands to the whole chromatogram, so the
    # angle mask would be picked at the global-max-c slice (often a system/void
    # peak) and then applied to every real peak — which tanks the zero-angle
    # extrapolation for samples with genuine angular dependence (e.g. the 200k
    # standard came out ~2.3x low).  Isotropic samples masked it because any
    # angle set gives ~the same M.
    global_angle_mask: Optional[np.ndarray] = None
    ref_peak = next(
        (p for p in peaks
         if p.range_start is not None and p.range_end is not None
         and p.range_end > p.range_start > 0),
        None,
    )
    if ref_peak is not None:
        rs = ref_peak.range_start
        re = ref_peak.range_end
        mask_pk = (t_m >= rs) & (t_m <= re)
        valid_init = mask_pk & (c_final > 0) & np.isfinite(c_final)
        if valid_init.any():
            # Select the detector angles on a concentration-weighted *average* of
            # the peak rather than a single apex slice.  The per-slice greedy
            # leave-one-out selection is noise-sensitive: on a single slice it can
            # keep miscalibrated extreme angles (e.g. 32/44 deg when the file's
            # normalization coefficients are all 1.0) and drop good mid angles,
            # which wrecks the zero-angle extrapolation.  Averaging over the peak
            # gives a stable angular profile and a consistent mask.
            w = c_final[valid_init]
            R_avg = np.average(R_theta[valid_init], axis=0, weights=w)
            c_avg = float(np.average(c_final[valid_init], weights=w))
            global_angle_mask = select_angles(R_avg, c_avg, x_all, K)

    if global_angle_mask is None:
        global_angle_mask = np.ones(n_angles, dtype=bool)

    peak_results: list[dict] = []
    for peak in peaks:
        rs = peak.range_start if peak.range_start is not None else float(t_m.min())
        re = peak.range_end if peak.range_end is not None else float(t_m.max())
        mask_pk = (t_m >= rs) & (t_m <= re)

        peak_dn_dc = peak.dn_dc if peak.dn_dc and peak.dn_dc > 0 else dn_dc
        if peak_dn_dc != dn_dc:
            c_peak = concentration_from_ri(s_ri_sub, peak_dn_dc)
            c_on_m_peak = np.interp(conc_sample_time, t_ri, c_peak)
        else:
            c_on_m_peak = c_final.copy()
            c_on_m_peak[~mask_pk] = 0

        peak_fit_model = peak.ls_model if peak.ls_model is not None else 0
        peak_fit_degree = peak.ls_fit_degree if peak.ls_fit_degree is not None else 1
        mm_result = compute_molar_mass(R_theta, c_on_m_peak, angles, n0, peak_dn_dc,
                                       wavelength_nm, angle_mask=global_angle_mask,
                                       fit_model=peak_fit_model, fit_degree=peak_fit_degree,
                                       return_quality=True)
        M_slice = mm_result["molar_mass"]
        Rg_slice = mm_result["radius"]
        fit_model_name = mm_result.get("fit_model", "zimm")
        fit_degree_used = int(mm_result.get("fit_degree", peak_fit_degree))
        chi2_full = mm_result.get("chi2")
        residuals_full = mm_result.get("residuals")
        n_used_full = mm_result.get("n_angles_used")

        valid = mask_pk & (c_on_m_peak > 0) & np.isfinite(c_on_m_peak)
        idxs = np.flatnonzero(valid)
        M_valid = M_slice[idxs]
        c_valid = c_on_m_peak[idxs]
        finite = np.isfinite(M_valid) & (M_valid > 0)
        if finite.sum() < 2:
            peak.mn = None
            peak.mw = None
            peak.mz = None
            peak.polydispersity = None
            peak.rms_radius = None
            peak.peak_area = None
            peak.recovery = None
            peak.version = peak.version + 1
            db.flush()
            peak_results.append({
                "peak_id": peak.id,
                "range_number": peak.range_number,
                "Mn": None, "Mw": None, "Mz": None, "Pd": None,
            })
            continue

        moments = compute_moments(c_valid[finite], M_valid[finite])
        pa = peak_area(t_m[mask_pk & (c_on_m_peak > 0)], c_on_m_peak[mask_pk & (c_on_m_peak > 0)])

        rg_finite = Rg_slice[idxs][finite]
        rg_mean = float(np.nanmean(rg_finite)) if np.isfinite(np.nanmean(rg_finite)) else None

        peak.mn = moments["Mn"] if np.isfinite(moments["Mn"]) else None
        peak.mw = moments["Mw"] if np.isfinite(moments["Mw"]) else None
        peak.mz = moments["Mz"] if np.isfinite(moments["Mz"]) else None
        peak.polydispersity = moments["Pd"] if np.isfinite(moments["Pd"]) else None
        peak.rms_radius = rg_mean
        peak.peak_area = float(pa) if np.isfinite(pa) else None
        peak.recovery = None
        peak.version = peak.version + 1
        db.flush()

        peak_results.append({
            "peak_id": peak.id,
            "range_number": peak.range_number,
            "Mn": moments["Mn"],
            "Mw": moments["Mw"],
            "Mz": moments["Mz"],
            "Pd": moments["Pd"],
            "Rg": rg_mean,
            "peak_area": float(pa) if np.isfinite(pa) else None,
        })

        old_cd = db.query(ComputedData).filter(ComputedData.peak_id == peak.id).all()
        for cd in old_cd:
            db.delete(cd)
        db.flush()

        t_pk = t_m[mask_pk & (c_on_m_peak > 0)]
        M_pk = M_slice[mask_pk & (c_on_m_peak > 0)]
        Rg_pk = Rg_slice[mask_pk & (c_on_m_peak > 0)]
        c_pk = c_on_m_peak[mask_pk & (c_on_m_peak > 0)]
        computed_payload = {
            "time": t_pk.tolist(),
            "molar_mass": np.where(np.isfinite(M_pk), M_pk, np.nan).tolist(),
            "radius": np.where(np.isfinite(Rg_pk), Rg_pk, np.nan).tolist(),
            "concentration": np.where(np.isfinite(c_pk), c_pk, np.nan).tolist(),
            "fit_model": fit_model_name,
            "fit_degree": fit_degree_used,
        }
        cd_row = ComputedData(
            experiment_id=experiment_id,
            peak_id=peak.id,
            data_type="zimm_slice",
            data_values=json.dumps(computed_payload, default=str),
        )
        db.add(cd_row)

        if chi2_full is not None:
            chi2_pk = chi2_full[mask_pk & (c_on_m_peak > 0)]
            n_used_pk = n_used_full[mask_pk & (c_on_m_peak > 0)]
            resid_pk = []
            valid_idx = np.flatnonzero(mask_pk & (c_on_m_peak > 0))
            for ri in valid_idx:
                r = residuals_full[ri] if ri < len(residuals_full) else np.array([])
                resid_pk.append(np.where(np.isfinite(r), r, np.nan).tolist())
            angular_payload = {
                "time": t_pk.tolist(),
                "chi2": np.where(np.isfinite(chi2_pk), chi2_pk, np.nan).tolist(),
                "residuals": resid_pk,
                "n_angles_used": n_used_pk.tolist(),
                "fit_model": fit_model_name,
                "fit_degree": fit_degree_used,
            }
            cd_angular = ComputedData(
                experiment_id=experiment_id,
                peak_id=peak.id,
                data_type="angular_fit",
                data_values=json.dumps(angular_payload, default=str),
            )
            db.add(cd_angular)

    _mark_procedure_run(db, experiment_id, "molar_mass")
    _progress("molar_mass", _PROCEDURE_PCT["molar_mass"], "Procedure 'molar_mass' complete")
    _mark_procedure_run(db, experiment_id, "moments")
    _progress("moments", _PROCEDURE_PCT["moments"], "Procedure 'moments' complete")
    _mark_procedure_run(db, experiment_id, "peak_areas")
    _progress("peak_areas", _PROCEDURE_PCT["peak_areas"], "Procedure 'peak_areas' complete")
    _mark_procedure_run(db, experiment_id, "distributions")
    _progress("distributions", _PROCEDURE_PCT["distributions"], "Procedure 'distributions' complete")

    _audit(db, experiment_id, "RUN", None, {
        "action": "run_analysis",
        "peak_id": peak_id,
        "n_peaks": len(peaks),
    })
    db.commit()
    _progress("complete", 100.0, "Analysis complete")

    return {
        "experiment_id": experiment_id,
        "peaks": peak_results,
        "message": f"Analysis complete for {len(peaks)} peak(s)",
    }
