"""Results routes — read computed results and export CSV."""

from __future__ import annotations

import csv
import io
import json
import logging

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import ComputedData, Experiment, Peak
from app.schemas import (
    A2Response,
    AbsorptionCorrectionRequest,
    AbsorptionCorrectionResponse,
    AngularFitResponse,
    AngularFitSliceResponse,
    BatchA2Request,
    BatchA2Response,
    BranchingResponse,
    BranchingSliceResponse,
    CalibrationResponse,
    ConformationResponse,
    ConformationSliceResponse,
    ConjugateResponse,
    ConjugateSliceResponse,
    DistributionResponse,
    DnDcDeterminationResponse,
    ErrorAnalysisResponse,
    MolarMassResponse,
    MolarMassSliceResponse,
    MomentsResponse,
    ParticleResponse,
    ParticleSliceResponse,
    PeakResultsResponse,
    PeakStatisticsListResponse,
    PeakStatisticsResponse,
    RadiusResponse,
    RadiusSliceResponse,
    ResultsResponse,
    ViscometryResponse,
    ViscometrySliceResponse,
    ZimmPlotResponse,
)
from app.services.a2 import batch_a2, online_a2, zimm_plot_data
from app.services.absorption_correction import correct_molar_mass
from app.services.branching import compute_branching
from app.services.chromatogram_service import load_chromatograms
from app.services.column_calibration import fit_calibration_curve
from app.services.conformation import compute_conformation
from app.services.conjugate import compute_conjugate
from app.services.distributions import compute_distribution
from app.services.dn_dc import (
    determine_dndc_from_calibration,
    determine_dndc_from_concentration,
)
from app.services.error_analysis import (
    assess_snr,
    fit_quality_indicators,
    propagate_uncertainty,
)
from app.services.molar_mass import optical_constant
from app.services.particle import compute_particle_density
from app.services.peak_statistics import compute_peak_statistics
from app.services.viscometry import compute_viscometry

logger = logging.getLogger(__name__)

router = APIRouter(tags=["results"])


def _get_experiment_or_404(experiment_id: int, db: Session) -> Experiment:
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )
    if not experiment.raw_data_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Raw data file path not found for this experiment",
        )
    return experiment


def _dispersity(p: Peak) -> float | None:
    """Return the dispersity Đ = Mw/Mn.

    Prefers the stored polydispersity value; when that is missing but both molar
    mass moments are present, computes Mw/Mn directly so the results table always
    shows a dispersity where the data allows.
    """
    if p.polydispersity is not None:
        try:
            if np.isfinite(float(p.polydispersity)):
                return float(p.polydispersity)
        except (TypeError, ValueError):
            pass
    try:
        mn = float(p.mn) if p.mn is not None else None
        mw = float(p.mw) if p.mw is not None else None
    except (TypeError, ValueError):
        return None
    if mn and mw and np.isfinite(mn) and np.isfinite(mw) and mn != 0:
        return mw / mn
    return None


def _peak_to_results(p: Peak) -> PeakResultsResponse:
    """Map a Peak ORM row to a PeakResultsResponse."""
    return PeakResultsResponse(
        peak_id=p.id,
        range_number=p.range_number,
        range_name=p.range_name,
        range_start=p.range_start,
        range_end=p.range_end,
        mn=p.mn,
        mw=p.mw,
        mz=p.mz,
        polydispersity=_dispersity(p),
        rms_radius=p.rms_radius,
        peak_area=p.peak_area,
        recovery=p.recovery,
        version=p.version,
    )


def _nan_to_none(lst) -> list:
    """Convert NaN/inf entries to None for JSON-safe output."""
    out = []
    for x in lst:
        if x is None:
            out.append(None)
            continue
        try:
            xf = float(x)
        except (TypeError, ValueError):
            out.append(None)
            continue
        out.append(None if not np.isfinite(xf) else xf)
    return out


def _load_slice_rows(db: Session, experiment_id: int, peak_id: int | None = None) -> list[ComputedData]:
    """Return zimm_slice ComputedData rows for an experiment, optionally filtered by peak."""
    q = db.query(ComputedData).filter(
        ComputedData.experiment_id == experiment_id,
        ComputedData.data_type == "zimm_slice",
    )
    if peak_id is not None:
        q = q.filter(ComputedData.peak_id == peak_id)
    return q.all()


def _parse_slice_payload(cd: ComputedData) -> dict | None:
    """Parse the JSON stored in ComputedData.data_values, returning None on failure."""
    if not cd.data_values:
        return None
    try:
        return json.loads(cd.data_values)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning("Malformed data_values for computed_data id=%s: %s", cd.id, e)
        return None


def _fmt_cell(v) -> str:
    """Format a numeric cell for CSV — empty string for NaN/None."""
    if v is None:
        return ""
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return ""
    return "" if not np.isfinite(fv) else repr(fv)


def _row_value(arr, i: int) -> str:
    """Return the i-th element of an array as a CSV cell, or '' if out of range/None."""
    if arr is None or i >= len(arr):
        return ""
    return _fmt_cell(arr[i])


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/results
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results", response_model=ResultsResponse)
def get_results(experiment_id: int, db: Session = Depends(get_db)):
    """Return aggregate results: peaks + whether slice data is available."""
    _get_experiment_or_404(experiment_id, db)
    peaks = db.query(Peak).filter(
        Peak.experiment_id == experiment_id
    ).order_by(Peak.range_number).all()
    slice_count = db.query(ComputedData).filter(
        ComputedData.experiment_id == experiment_id,
        ComputedData.data_type == "zimm_slice",
    ).count()
    return ResultsResponse(
        experiment_id=experiment_id,
        peaks=[_peak_to_results(p) for p in peaks],
        has_slice_data=slice_count > 0,
        message="Results available" if slice_count > 0 else "No slice data; run analysis first",
    )


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/results/peaks
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results/peaks", response_model=list[PeakResultsResponse])
def get_results_peaks(experiment_id: int, db: Session = Depends(get_db)):
    """Return per-peak computed results as a list."""
    _get_experiment_or_404(experiment_id, db)
    peaks = db.query(Peak).filter(
        Peak.experiment_id == experiment_id
    ).order_by(Peak.range_number).all()
    return [_peak_to_results(p) for p in peaks]


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/results/moments
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results/moments", response_model=MomentsResponse)
def get_results_moments(experiment_id: int, db: Session = Depends(get_db)):
    """Return moments (Mn, Mw, Mz, Pd) for all peaks."""
    _get_experiment_or_404(experiment_id, db)
    peaks = db.query(Peak).filter(
        Peak.experiment_id == experiment_id
    ).order_by(Peak.range_number).all()
    rows = [_peak_to_results(p) for p in peaks]
    return MomentsResponse(peaks=rows, total=len(rows))


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/results/molar-mass
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results/molar-mass", response_model=MolarMassResponse)
def get_results_molar_mass(
    experiment_id: int,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return per-slice molar-mass data (M(v)) for all peaks, or a single peak if filtered."""
    _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    slices: list[MolarMassSliceResponse] = []
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        slices.append(MolarMassSliceResponse(
            peak_id=cd.peak_id,
            time=_nan_to_none(payload.get("time", [])),
            molar_mass=_nan_to_none(payload.get("molar_mass", [])),
            concentration=_nan_to_none(payload.get("concentration", [])),
            fit_model=payload.get("fit_model"),
            fit_degree=payload.get("fit_degree"),
        ))
    return MolarMassResponse(peaks=slices, total=len(slices))


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/results/radius
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results/radius", response_model=RadiusResponse)
def get_results_radius(
    experiment_id: int,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return per-slice radius data (Rg(v)) for all peaks, or a single peak if filtered."""
    _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    slices: list[RadiusSliceResponse] = []
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        slices.append(RadiusSliceResponse(
            peak_id=cd.peak_id,
            time=_nan_to_none(payload.get("time", [])),
            radius=_nan_to_none(payload.get("radius", [])),
            concentration=_nan_to_none(payload.get("concentration", [])),
        ))
    return RadiusResponse(peaks=slices, total=len(slices))


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/results/distributions
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results/distributions", response_model=list[DistributionResponse])
def get_results_distributions(
    experiment_id: int,
    type: str = Query("diff", pattern="^(diff|cum)$"),
    bins: str = Query("auto", pattern="^(auto|[1-9][0-9]*)$"),
    smoothing: float = Query(0.0, ge=0),
    bandwidth: float | None = Query(None, ge=0),
    kernel: str = Query("gaussian"),
    range_min: float | None = Query(None),
    range_max: float | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return molar-mass distributions for each peak (KDE or binned fallback).

    Query parameters:
    - ``type``: ``diff`` (differential weights) or ``cum`` (cumulative sum).
    - ``bins``: ``auto`` (uses 50 bins) or an integer bin count.
    - ``smoothing``: KDE bandwidth override when > 0; 0 = automatic (Scott's rule).
    - ``bandwidth``: explicit KDE bandwidth (overrides ``smoothing`` when given).
    - ``kernel``: kernel name (only ``"gaussian"`` supported by scipy).
    - ``range_min`` / ``range_max``: optional molar-mass filter window.
    """
    _get_experiment_or_404(experiment_id, db)
    n_bins = 50 if bins == "auto" else int(bins)
    bw_override = bandwidth if bandwidth is not None and bandwidth > 0 else (
        smoothing if smoothing > 0 else None)
    rows = _load_slice_rows(db, experiment_id)
    out: list[DistributionResponse] = []
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        m = np.asarray(payload.get("molar_mass", []), dtype=float)
        c = np.asarray(payload.get("concentration", []), dtype=float)
        n = min(m.size, c.size)
        if n == 0:
            out.append(DistributionResponse(
                peak_id=cd.peak_id,
                bin_centers=[],
                weights=[],
                bin_edges=[],
                distribution_type=type,
                n_bins=n_bins,
                cumulative=[],
                kernel=kernel,
                method="kde",
            ))
            continue
        m = m[:n]
        c = c[:n]
        valid = np.isfinite(m) & np.isfinite(c) & (m > 0) & (c > 0)
        if range_min is not None:
            valid &= (m >= range_min)
        if range_max is not None:
            valid &= (m <= range_max)
        if valid.sum() < 2:
            out.append(DistributionResponse(
                peak_id=cd.peak_id,
                bin_centers=[],
                weights=[],
                bin_edges=[],
                distribution_type=type,
                n_bins=n_bins,
                cumulative=[],
                kernel=kernel,
                method="kde",
            ))
            continue
        dist = compute_distribution(m[valid], c[valid], n_bins=n_bins,
                                    bandwidth=bw_override, kernel=kernel,
                                    log_scale=True, range_min=range_min,
                                    range_max=range_max)
        method = dist.get("method", "kde")
        weights = dist["weights"].tolist()
        if type == "cum":
            cumulative = dist.get("cumulative")
            cumulative_list = cumulative.tolist() if cumulative is not None else (
                [0.0 for _ in weights])
        else:
            cumulative = []
            cumulative_list = []
        out.append(DistributionResponse(
            peak_id=cd.peak_id,
            bin_centers=_nan_to_none(dist["bin_centers"].tolist()),
            weights=_nan_to_none(weights),
            bin_edges=_nan_to_none(dist["bin_edges"].tolist()),
            distribution_type=type,
            n_bins=n_bins,
            cumulative=_nan_to_none(cumulative_list),
            bandwidth=dist.get("bandwidth"),
            kernel=dist.get("kernel"),
            method=method,
        ))
    return out


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/results/angular-fit
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results/angular-fit", response_model=AngularFitResponse)
def get_results_angular_fit(
    experiment_id: int,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return per-slice angular fit quality metrics (chi-squared, residuals).

    Reads ``computed_data`` rows with ``data_type="angular_fit"`` produced by
    the procedure orchestrator.  Supports an optional ``peak_id`` filter.
    """
    _get_experiment_or_404(experiment_id, db)
    q = db.query(ComputedData).filter(
        ComputedData.experiment_id == experiment_id,
        ComputedData.data_type == "angular_fit",
    )
    if peak_id is not None:
        q = q.filter(ComputedData.peak_id == peak_id)
    rows = q.all()
    slices: list[AngularFitSliceResponse] = []
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        slices.append(AngularFitSliceResponse(
            peak_id=cd.peak_id,
            time=_nan_to_none(payload.get("time", [])),
            chi2=_nan_to_none(payload.get("chi2", [])),
            n_angles_used=payload.get("n_angles_used", []),
            fit_model=payload.get("fit_model"),
            fit_degree=payload.get("fit_degree"),
        ))
    return AngularFitResponse(peaks=slices, total=len(slices))


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/export/csv
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/export/csv")
def export_csv(
    experiment_id: int,
    data_type: str = Query("processed", pattern="^(raw|processed)$"),
    db: Session = Depends(get_db),
):
    """Export per-peak processed slice data or raw chromatogram data as a CSV download."""
    experiment = _get_experiment_or_404(experiment_id, db)
    buf = io.StringIO()
    writer = csv.writer(buf)

    if data_type == "processed":
        writer.writerow(["peak_id", "time_min", "molar_mass_g_mol", "radius_nm", "concentration_g_mL"])
        rows = _load_slice_rows(db, experiment_id)
        for cd in rows:
            payload = _parse_slice_payload(cd)
            if payload is None:
                continue
            t = payload.get("time", [])
            m = payload.get("molar_mass", [])
            r = payload.get("radius", [])
            c = payload.get("concentration", [])
            n = min(len(t), len(m), len(r), len(c))
            for i in range(n):
                tv = t[i]
                mv = m[i]
                rv = r[i]
                cv = c[i]
                writer.writerow([cd.peak_id, _fmt_cell(tv), _fmt_cell(mv), _fmt_cell(rv), _fmt_cell(cv)])
    else:
        writer.writerow(["time_min", "MALS_avg", "RI", "UV_avg"])
        try:
            data = load_chromatograms(experiment.raw_data_path)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to read raw chromatogram data: {e}",
            )
        time = data.get("time") or []
        detectors = data.get("detectors", {})
        mals_rows = detectors.get("MALS", {}).get("data") if isinstance(detectors.get("MALS"), dict) else None
        ri_rows = detectors.get("RI", {}).get("data") if isinstance(detectors.get("RI"), dict) else None
        uv_rows = detectors.get("UV", {}).get("data") if isinstance(detectors.get("UV"), dict) else None
        mals_arr = np.asarray(mals_rows, dtype=float) if mals_rows is not None else None
        ri_arr = np.asarray(ri_rows, dtype=float) if ri_rows is not None else None
        uv_arr = np.asarray(uv_rows, dtype=float) if uv_rows is not None else None
        mals_avg = np.nanmean(mals_arr, axis=1) if (mals_arr is not None and mals_arr.ndim == 2) else (mals_arr if mals_arr is not None and mals_arr.ndim == 1 else None)
        uv_avg = np.nanmean(uv_arr, axis=1) if (uv_arr is not None and uv_arr.ndim == 2) else (uv_arr if uv_arr is not None and uv_arr.ndim == 1 else None)
        n = len(time)
        for i in range(n):
            writer.writerow([_fmt_cell(time[i] if i < len(time) else None), _row_value(mals_avg, i), _row_value(ri_arr, i), _row_value(uv_avg, i)])

    csv_bytes = buf.getvalue().encode("utf-8")
    filename = f"experiment_{experiment_id}_data.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Phase 4 advanced analysis routes
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results/conformation", response_model=ConformationResponse)
def get_results_conformation(
    experiment_id: int,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return the conformation plot (log Rg vs log M) for each peak.

    Reads ``zimm_slice`` computed-data rows (which store per-slice molar
    mass, radius and concentration) and calls
    :func:`compute_conformation` for each peak.
    """
    _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    slices: list[ConformationSliceResponse] = []
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        result = compute_conformation(
            payload.get("molar_mass", []),
            payload.get("radius", []),
            payload.get("concentration", []),
        )
        slices.append(ConformationSliceResponse(
            peak_id=cd.peak_id,
            log_m=_nan_to_none(result["log_m"]),
            log_rg=_nan_to_none(result["log_rg"]),
            slope=result["slope"] if np.isfinite(result["slope"]) else None,
            intercept=result["intercept"] if np.isfinite(result["intercept"]) else None,
            r_squared=result["r_squared"] if np.isfinite(result["r_squared"]) else None,
            n_points=result["n_points"],
            conformation_class=result["conformation_class"],
        ))
    return ConformationResponse(peaks=slices, total=len(slices))


@router.get("/api/experiments/{experiment_id}/results/conjugate", response_model=ConjugateResponse)
def get_results_conjugate(
    experiment_id: int,
    peak_id: int | None = Query(None),
    dn_dc_protein: float | None = Query(None),
    dn_dc_modifier: float | None = Query(None),
    uv_ext_protein: float | None = Query(None),
    uv_ext_modifier: float | None = Query(None),
    cell_length: float | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return protein conjugate / copolymer per-slice results.

    Requires MALS + UV + RI detectors.  Reads the raw chromatograms and the
    ``zimm_slice`` molar-mass rows; the protein and modifier dn/dc and UV
    extinction coefficients must be supplied as query parameters.
    """
    experiment = _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    try:
        chrom = load_chromatograms(experiment.raw_data_path)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read raw chromatogram data: {e}",
        )
    time_axis = chrom.get("time") or []
    detectors = chrom.get("detectors", {})
    ri_data = detectors.get("RI", {}).get("data") if isinstance(detectors.get("RI"), dict) else None
    uv_data = detectors.get("UV", {}).get("data") if isinstance(detectors.get("UV"), dict) else None
    ri_arr = np.asarray(ri_data, dtype=float) if ri_data is not None else None
    uv_arr = np.asarray(uv_data, dtype=float) if uv_data is not None else None
    if uv_arr is not None and uv_arr.ndim == 2:
        uv_arr = np.nanmean(uv_arr, axis=1)

    slices: list[ConjugateSliceResponse] = []
    t_full = np.asarray(time_axis, dtype=float) if time_axis else np.array([])
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        t_slice = np.asarray(payload.get("time", []), dtype=float)
        m_slice = np.asarray(payload.get("molar_mass", []), dtype=float)
        if t_slice.size == 0 or m_slice.size == 0:
            continue
        mals_signal = m_slice
        if ri_arr is not None and ri_arr.size > 0 and t_full.size > 0:
            n_use = min(t_full.size, ri_arr.size)
            ri_slice = np.interp(t_slice, t_full[:n_use], ri_arr[:n_use],
                                 left=np.nan, right=np.nan)
        else:
            ri_slice = np.full_like(t_slice, np.nan)
        if uv_arr is not None and uv_arr.size > 0 and t_full.size > 0:
            n_use = min(t_full.size, uv_arr.size)
            uv_slice = np.interp(t_slice, t_full[:n_use], uv_arr[:n_use],
                                 left=np.nan, right=np.nan)
        else:
            uv_slice = np.full_like(t_slice, np.nan)
        result = compute_conjugate(
            mals_signal, uv_slice, ri_slice, t_slice,
            dn_dc_protein, dn_dc_modifier,
            uv_ext_protein, uv_ext_modifier, cell_length,
        )
        slices.append(ConjugateSliceResponse(
            peak_id=cd.peak_id,
            time=_nan_to_none(result["time"]),
            total_molar_mass=_nan_to_none(result["total_molar_mass"]),
            protein_fraction=_nan_to_none(result["protein_fraction"]),
            modifier_fraction=_nan_to_none(result["modifier_fraction"]),
            protein_molar_mass=_nan_to_none(result["protein_molar_mass"]),
            modifier_molar_mass=_nan_to_none(result["modifier_molar_mass"]),
        ))
    return ConjugateResponse(peaks=slices, total=len(slices))


@router.get("/api/experiments/{experiment_id}/results/branching", response_model=BranchingResponse)
def get_results_branching(
    experiment_id: int,
    peak_id: int | None = Query(None),
    branching_type: str = Query("tri", pattern="^(tri|tetra|star|comb)$"),
    linear_reference_m: str | None = Query(None),
    linear_reference_rg: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return polymer branching per-slice results.

    The linear reference (M and Rg arrays) is supplied as a JSON-encoded
    list via the ``linear_reference_m`` and ``linear_reference_rg`` query
    parameters.  When omitted the branching metrics are NaN with a
    ``missing data`` message.
    """
    _get_experiment_or_404(experiment_id, db)
    ref_m = None
    ref_rg = None
    if linear_reference_m is not None:
        try:
            ref_m = json.loads(linear_reference_m)
        except (json.JSONDecodeError, TypeError):
            ref_m = None
    if linear_reference_rg is not None:
        try:
            ref_rg = json.loads(linear_reference_rg)
        except (json.JSONDecodeError, TypeError):
            ref_rg = None
    rows = _load_slice_rows(db, experiment_id, peak_id)
    slices: list[BranchingSliceResponse] = []
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        result = compute_branching(
            payload.get("molar_mass", []),
            payload.get("radius", []),
            payload.get("concentration", []),
            ref_m, ref_rg,
            branching_type=branching_type,
        )
        slices.append(BranchingSliceResponse(
            peak_id=cd.peak_id,
            molar_mass=_nan_to_none(result["molar_mass"]),
            branching_ratio_g=_nan_to_none(result["branching_ratio_g"]),
            branch_units_per_molecule=_nan_to_none(result["branch_units_per_molecule"]),
            long_chain_branch_freq=_nan_to_none(result["long_chain_branch_freq"]),
            branching_type=result["branching_type"],
        ))
    return BranchingResponse(peaks=slices, total=len(slices))


@router.get("/api/experiments/{experiment_id}/results/viscometry", response_model=ViscometryResponse)
def get_results_viscometry(
    experiment_id: int,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return viscometry per-slice results (MHS, hydrodynamic radius).

    Viscometer data is not stored in the ``zimm_slice`` rows; this route
    returns empty arrays with NaN MHS constants when no viscometer data is
    available (the viscometer is a stretch goal).
    """
    _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    slices: list[ViscometrySliceResponse] = []
    mhs_K = None
    mhs_a = None
    mhs_r2 = None
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        t_slice = payload.get("time", [])
        m_slice = payload.get("molar_mass", [])
        result = compute_viscometry(
            t_slice,
            molar_mass=m_slice,
        )
        if mhs_K is None and np.isfinite(result["mhs_K"]):
            mhs_K = result["mhs_K"]
        if mhs_a is None and np.isfinite(result["mhs_a"]):
            mhs_a = result["mhs_a"]
        if mhs_r2 is None and np.isfinite(result["mhs_r_squared"]):
            mhs_r2 = result["mhs_r_squared"]
        slices.append(ViscometrySliceResponse(
            peak_id=cd.peak_id,
            time=_nan_to_none(result["time"]),
            intrinsic_viscosity=_nan_to_none(result["intrinsic_viscosity"]),
            specific_viscosity=_nan_to_none(result["specific_viscosity"]),
            hydrodynamic_radius=_nan_to_none(result["hydrodynamic_radius"]),
            universal_molar_mass=_nan_to_none(result["universal_molar_mass"]),
        ))
    return ViscometryResponse(
        peaks=slices, total=len(slices),
        mhs_K=mhs_K, mhs_a=mhs_a, mhs_r_squared=mhs_r2,
    )


@router.get("/api/experiments/{experiment_id}/results/calibration", response_model=CalibrationResponse)
def get_results_calibration(
    experiment_id: int,
    peak_id: int | None = Query(None),
    degree: int = Query(3, ge=1, le=6),
    db: Session = Depends(get_db),
):
    """Return a column calibration curve fit to the per-peak elution data.

    Uses the peak elution time as the elution volume proxy and the
    per-slice molar mass as the calibration mass.
    """
    _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    all_v = []
    all_m = []
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        t_slice = np.asarray(payload.get("time", []), dtype=float)
        m_slice = np.asarray(payload.get("molar_mass", []), dtype=float)
        n = min(t_slice.size, m_slice.size)
        if n == 0:
            continue
        valid = np.isfinite(t_slice) & np.isfinite(m_slice) & (m_slice > 0)
        if valid.sum() < 1:
            continue
        all_v.extend(t_slice[valid].tolist())
        all_m.extend(m_slice[valid].tolist())
    result = fit_calibration_curve(all_v, all_m, degree=degree)
    return CalibrationResponse(
        elution_volume=_nan_to_none(result["elution_volume"]),
        log_m=_nan_to_none(result["log_m"]),
        fit_log_m=_nan_to_none(result["fit_log_m"]),
        coefficients=_nan_to_none(result["coefficients"]),
        r_squared=result["r_squared"] if np.isfinite(result["r_squared"]) else None,
        calibration_type=result["calibration_type"],
    )


@router.get("/api/experiments/{experiment_id}/results/particle", response_model=ParticleResponse)
def get_results_particle(
    experiment_id: int,
    peak_id: int | None = Query(None),
    sample_ri: float | None = Query(None),
    solvent_ri: float | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return particle number-density and number-fraction distribution.

    Reads ``zimm_slice`` rows for per-slice molar mass, radius and
    concentration and calls :func:`compute_particle_density`.
    """
    _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    slices: list[ParticleSliceResponse] = []
    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        result = compute_particle_density(
            payload.get("molar_mass", []),
            payload.get("radius", []),
            payload.get("concentration", []),
            sample_ri=sample_ri,
            solvent_ri=solvent_ri,
        )
        slices.append(ParticleSliceResponse(
            peak_id=cd.peak_id,
            molar_mass=_nan_to_none(result["molar_mass"]),
            geometric_radius=_nan_to_none(result["geometric_radius"]),
            number_density=_nan_to_none(result["number_density"]),
            number_fraction=_nan_to_none(result["number_fraction"]),
            total_count=result["total_count"] if np.isfinite(result["total_count"]) else None,
        ))
    return ParticleResponse(peaks=slices, total=len(slices))


@router.get("/api/experiments/{experiment_id}/results/peak-statistics", response_model=PeakStatisticsListResponse)
def get_results_peak_statistics(
    experiment_id: int,
    peak_id: int | None = Query(None),
    detector: str = Query("RI", pattern="^(RI|MALS|UV)$"),
    db: Session = Depends(get_db),
):
    """Return chromatographic peak statistics (plate count, asymmetry, tailing).

    Reads the raw chromatogram for the requested detector and computes
    statistics for each peak within its integration window.
    """
    experiment = _get_experiment_or_404(experiment_id, db)
    try:
        chrom = load_chromatograms(experiment.raw_data_path)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read raw chromatogram data: {e}",
        )
    time_axis = np.asarray(chrom.get("time") or [], dtype=float)
    detectors = chrom.get("detectors", {})
    det_info = detectors.get(detector) if isinstance(detectors, dict) else None
    if det_info is None or not isinstance(det_info, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Detector {detector} not found in this experiment",
        )
    raw = det_info.get("data")
    arr = np.asarray(raw, dtype=float) if raw is not None else None
    if arr is None or time_axis.size == 0:
        return PeakStatisticsListResponse(peaks=[], total=0)
    if arr.ndim == 2:
        arr = np.nanmean(arr, axis=1)
    n_use = min(time_axis.size, arr.size)
    time_axis = time_axis[:n_use]
    arr = arr[:n_use]
    peak_query = db.query(Peak).filter(Peak.experiment_id == experiment_id)
    if peak_id is not None:
        peak_query = peak_query.filter(Peak.id == peak_id)
    peaks = peak_query.order_by(Peak.range_number).all()
    out: list[PeakStatisticsResponse] = []
    for p in peaks:
        rs = p.range_start if p.range_start is not None else float(time_axis.min())
        re = p.range_end if p.range_end is not None else float(time_axis.max())
        stats = compute_peak_statistics(time_axis, arr, peak_start=rs, peak_end=re)
        out.append(PeakStatisticsResponse(
            peak_id=p.id,
            retention_time=stats["retention_time"] if np.isfinite(stats["retention_time"]) else None,
            peak_max=stats["peak_max"] if np.isfinite(stats["peak_max"]) else None,
            width_baseline=stats["width_baseline"] if np.isfinite(stats["width_baseline"]) else None,
            width_half_height=stats["width_half_height"] if np.isfinite(stats["width_half_height"]) else None,
            asymmetry_factor=stats["asymmetry_factor"] if np.isfinite(stats["asymmetry_factor"]) else None,
            tailing_factor=stats["tailing_factor"] if np.isfinite(stats["tailing_factor"]) else None,
            plate_count=stats["plate_count"] if np.isfinite(stats["plate_count"]) else None,
            resolution=stats["resolution"],
        ))
    return PeakStatisticsListResponse(peaks=out, total=len(out))


@router.get("/api/experiments/{experiment_id}/results/dn-dc", response_model=DnDcDeterminationResponse)
def get_results_dn_dc(
    experiment_id: int,
    method: str = Query("concentration", pattern="^(concentration|calibration)$"),
    ri_area: float | None = Query(None),
    flow_rate: float | None = Query(None),
    injected_mass: float | None = Query(None),
    ri_calibration_constant: float | None = Query(None),
    db: Session = Depends(get_db),
):
    """Determine dn/dc by the online (concentration) or calibration method."""
    _get_experiment_or_404(experiment_id, db)
    if method == "calibration":
        value = determine_dndc_from_calibration(ri_calibration_constant, ri_area, flow_rate)
        msg = None if np.isfinite(value) else "invalid inputs for calibration method"
        return DnDcDeterminationResponse(
            dn_dc_value=value if np.isfinite(value) else None,
            method=method,
            message=msg,
        )
    value = determine_dndc_from_concentration(ri_area, flow_rate, injected_mass)
    msg = None if np.isfinite(value) else "invalid inputs for concentration method"
    return DnDcDeterminationResponse(
        dn_dc_value=value if np.isfinite(value) else None,
        method=method,
        message=msg,
    )


@router.get("/api/experiments/{experiment_id}/results/error-analysis", response_model=list[ErrorAnalysisResponse])
def get_results_error_analysis(
    experiment_id: int,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return per-slice uncertainty propagation and fit-quality indicators.

    Reads ``zimm_slice`` rows (for molar mass and concentration) and
    ``angular_fit`` rows (for chi-squared and residuals).
    """
    _get_experiment_or_404(experiment_id, db)
    slice_rows = _load_slice_rows(db, experiment_id, peak_id)
    q = db.query(ComputedData).filter(
        ComputedData.experiment_id == experiment_id,
        ComputedData.data_type == "angular_fit",
    )
    if peak_id is not None:
        q = q.filter(ComputedData.peak_id == peak_id)
    angular_rows = {cd.peak_id: cd for cd in q.all()}
    out: list[ErrorAnalysisResponse] = []
    for cd in slice_rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        m = payload.get("molar_mass", [])
        c = payload.get("concentration", [])
        unc = propagate_uncertainty(m, None, c, None)
        snr_val = float(np.nan)
        r2_val = float(np.nan)
        reduced_chi2_val = float(np.nan)
        angular_cd = angular_rows.get(cd.peak_id)
        if angular_cd is not None:
            ang_payload = _parse_slice_payload(angular_cd)
            if ang_payload is not None:
                chi2_arr = np.asarray(ang_payload.get("chi2", []), dtype=float)
                finite_chi2 = chi2_arr[np.isfinite(chi2_arr)]
                if finite_chi2.size > 0:
                    mean_chi2 = float(np.mean(finite_chi2))
                else:
                    mean_chi2 = float(np.nan)
                residuals_list = ang_payload.get("residuals", [])
                flat_res = []
                for r in residuals_list:
                    if isinstance(r, list):
                        flat_res.extend(r)
                    else:
                        flat_res.append(r)
                res_arr = np.asarray(flat_res, dtype=float)
                qind = fit_quality_indicators(mean_chi2, res_arr, n_params=2)
                r2_val = qind["r_squared"]
                reduced_chi2_val = qind["reduced_chi2"]
                n_used_arr = np.asarray(ang_payload.get("n_angles_used", []), dtype=float)
                peak_idx = int(np.argmax(np.asarray(c, dtype=float) if len(c) > 0 else [0]))
                t_arr = np.asarray(payload.get("time", []), dtype=float)
                if t_arr.size > 2 and peak_idx < t_arr.size:
                    half = max(1, t_arr.size // 10)
                    lo = max(0, peak_idx - half)
                    hi = min(t_arr.size, peak_idx + half)
                    signal_region = np.asarray(c, dtype=float)[lo:hi]
                    noise_lo = np.asarray(c, dtype=float)[:max(1, t_arr.size // 20)]
                    noise_hi = np.asarray(c, dtype=float)[-max(1, t_arr.size // 20):] if t_arr.size > 2 else np.array([])
                    noise_region = np.concatenate([noise_lo, noise_hi])
                    snr_val = assess_snr(signal_region, noise_region)
        out.append(ErrorAnalysisResponse(
            peak_id=cd.peak_id,
            molar_mass_uncertainty=_nan_to_none(unc["molar_mass_uncertainty"]),
            concentration_uncertainty=_nan_to_none(unc["concentration_uncertainty"]),
            snr=snr_val if np.isfinite(snr_val) else None,
            reduced_chi2=reduced_chi2_val if np.isfinite(reduced_chi2_val) else None,
            r_squared=r2_val if np.isfinite(r2_val) else None,
        ))
    return out


# ---------------------------------------------------------------------------
# Phase 8 — A2 / Zimm plot
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/results/a2", response_model=A2Response)
def get_results_a2(
    experiment_id: int,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return the second virial coefficient (A2) from online Zimm analysis.

    Reads ``zimm_slice`` computed data rows and performs a global 2-variable
    linear fit (K*c/R vs sin^2(theta/2) + c) to extract A2.
    """
    experiment = _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    if not rows:
        return A2Response(a2=None, method="online", n_points=0)

    import json as _json
    mals_config = _json.loads(experiment.mals_config) if experiment.mals_config else {}
    n0 = mals_config.get("solvent_ri", 1.401)
    wavelength_nm = mals_config.get("wavelength", 662.72)
    angles_deg = mals_config.get("angles", list(range(18)))

    first_peak = rows[0]
    payload = _parse_slice_payload(first_peak)
    if payload is None:
        return A2Response(a2=None, method="online", n_points=0)

    dn_dc = None
    peak_obj = db.query(Peak).filter(Peak.id == first_peak.peak_id).first()
    if peak_obj is not None and peak_obj.dn_dc is not None:
        dn_dc = float(peak_obj.dn_dc)
    if dn_dc is None:
        dn_dc = 0.185

    K = optical_constant(n0, dn_dc, wavelength_nm)
    if not np.isfinite(K) or K <= 0:
        return A2Response(a2=None, method="online", n_points=0)

    R_theta = np.asarray(payload.get("rayleigh_ratio", payload.get("R_theta", [])), dtype=float)
    c = np.asarray(payload.get("concentration", []), dtype=float)
    if R_theta.size == 0 or c.size == 0:
        return A2Response(a2=None, method="online", n_points=0)
    if R_theta.ndim == 1:
        R_theta = R_theta.reshape(1, -1)
    angles_arr = np.asarray(angles_deg, dtype=float)

    result = online_a2(R_theta, c, angles_arr, K, wavelength_nm, n0)
    return A2Response(
        a2=result["a2"] if np.isfinite(result["a2"]) else None,
        mw=result["mw"] if np.isfinite(result["mw"]) else None,
        rg=result["rg"] if np.isfinite(result["rg"]) else None,
        n_points=result["n_points"],
        r_squared=result["r_squared"] if np.isfinite(result["r_squared"]) else None,
        fit_quality=result["fit_quality"],
        method="online",
    )


@router.post("/api/experiments/{experiment_id}/results/a2/batch", response_model=BatchA2Response)
def post_batch_a2(
    experiment_id: int,
    request: BatchA2Request,
    db: Session = Depends(get_db),
):
    """Determine A2 from multiple concentrations (batch mode).

    Accepts arrays of concentrations and zero-angle Rayleigh ratios.
    """
    _get_experiment_or_404(experiment_id, db)
    result = batch_a2(
        np.asarray(request.concentrations, dtype=float),
        np.asarray(request.rayleigh_ratio_zero, dtype=float),
        float(request.optical_constant),
    )
    return BatchA2Response(
        a2=result["a2"] if np.isfinite(result["a2"]) else None,
        mw=result["mw"] if np.isfinite(result["mw"]) else None,
        slope=result["slope"] if np.isfinite(result["slope"]) else None,
        intercept=result["intercept"] if np.isfinite(result["intercept"]) else None,
        r_squared=result["r_squared"] if np.isfinite(result["r_squared"]) else None,
        n_points=result["n_points"],
    )


@router.get("/api/experiments/{experiment_id}/results/zimm-plot", response_model=ZimmPlotResponse)
def get_zimm_plot(
    experiment_id: int,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return Zimm plot data points and fit results.

    Generates the classic Zimm plot data: K*c/R vs sin^2(theta/2) + k*c.
    """
    experiment = _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    if not rows:
        return ZimmPlotResponse()

    import json as _json
    mals_config = _json.loads(experiment.mals_config) if experiment.mals_config else {}
    n0 = mals_config.get("solvent_ri", 1.401)
    wavelength_nm = mals_config.get("wavelength", 662.72)
    angles_deg = mals_config.get("angles", list(range(18)))

    first_peak = rows[0]
    payload = _parse_slice_payload(first_peak)
    if payload is None:
        return ZimmPlotResponse()

    dn_dc = None
    peak_obj = db.query(Peak).filter(Peak.id == first_peak.peak_id).first()
    if peak_obj is not None and peak_obj.dn_dc is not None:
        dn_dc = float(peak_obj.dn_dc)
    if dn_dc is None:
        dn_dc = 0.185

    K = optical_constant(n0, dn_dc, wavelength_nm)
    if not np.isfinite(K) or K <= 0:
        return ZimmPlotResponse()

    R_theta = np.asarray(payload.get("rayleigh_ratio", payload.get("R_theta", [])), dtype=float)
    c = np.asarray(payload.get("concentration", []), dtype=float)
    if R_theta.size == 0 or c.size == 0:
        return ZimmPlotResponse()
    if R_theta.ndim == 1:
        R_theta = R_theta.reshape(1, -1)
    angles_arr = np.asarray(angles_deg, dtype=float)

    result = zimm_plot_data(R_theta, c, angles_arr, K, wavelength_nm, n0)
    return ZimmPlotResponse(
        x=result["x"],
        y=result["y"],
        angles=result["angles"],
        concentrations=result["concentrations"],
        k_scale=result["k_scale"],
        a2=result["a2"] if np.isfinite(result.get("a2", np.nan)) else None,
        mw=result["mw"] if np.isfinite(result.get("mw", np.nan)) else None,
        rg=result["rg"] if np.isfinite(result.get("rg", np.nan)) else None,
    )


# ---------------------------------------------------------------------------
# Phase 8 — Absorption correction
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/results/absorption-correction", response_model=AbsorptionCorrectionResponse)
def post_absorption_correction(
    experiment_id: int,
    request: AbsorptionCorrectionRequest,
    peak_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Apply forward-monitor absorption correction to molar mass data.

    Reads the per-slice molar mass from ``zimm_slice`` computed data, computes
    transmittance from the forward monitor signal, and returns the corrected
    molar mass ( M_corrected = M_uncorrected * T ).
    """
    _get_experiment_or_404(experiment_id, db)
    rows = _load_slice_rows(db, experiment_id, peak_id)
    if not rows:
        return AbsorptionCorrectionResponse(message="No computed data found")

    fm = np.asarray(request.forward_monitor, dtype=float)
    t_axis = np.asarray(request.time_axis, dtype=float)

    all_corrected: list[float] = []
    all_T: list[float] = []
    absorption_detected = False
    correction_factors: list[float] = []

    for cd in rows:
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        m = np.asarray(payload.get("molar_mass", []), dtype=float)
        if m.size == 0:
            continue
        result = correct_molar_mass(
            m, fm, t_axis,
            peak_start=request.peak_start,
            peak_end=request.peak_end,
            baseline_pct=request.baseline_pct,
        )
        corrected = result["corrected_molar_mass"]
        T = result["transmittance"]
        all_corrected.extend(_nan_to_none(corrected))
        all_T.extend(_nan_to_none(T))
        if result["absorption_detected"]:
            absorption_detected = True
        cf = result["correction_factor_mean"]
        if np.isfinite(cf):
            correction_factors.append(cf)

    mean_cf = float(np.mean(correction_factors)) if correction_factors else np.nan

    return AbsorptionCorrectionResponse(
        corrected_molar_mass=all_corrected,
        transmittance=all_T,
        correction_factor_mean=mean_cf if np.isfinite(mean_cf) else None,
        absorption_detected=absorption_detected,
        message="Absorption detected and corrected" if absorption_detected else "No significant absorption detected",
    )
