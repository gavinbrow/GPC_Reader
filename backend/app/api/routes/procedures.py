"""Procedure management and analysis routes."""

import json
import logging

import numpy as np
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import AuditLog, Experiment, Peak, ProcedureState
from app.schemas import (
    AutoAnalyzeResponse,
    PeakResponse,
    ProcedureListResponse,
    ProcedureRunRequest,
    ProcedureStateResponse,
    ProcedureUpdateRequest,
)
from app.services.chromatogram_service import list_detectors, load_single_detector
from app.services.peak_engine import auto_detect_peaks
from app.services.procedure_orchestrator import run_analysis

logger = logging.getLogger(__name__)

router = APIRouter(tags=["procedures"])


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


def _to_response(ps: ProcedureState) -> ProcedureStateResponse:
    params = None
    if ps.parameters:
        try:
            params = json.loads(ps.parameters)
        except (json.JSONDecodeError, TypeError):
            params = ps.parameters
    return ProcedureStateResponse(
        id=ps.id,
        experiment_id=ps.experiment_id,
        procedure_name=ps.procedure_name,
        procedure_order=ps.procedure_order,
        is_enabled=ps.is_enabled,
        has_been_run=ps.has_been_run,
        parameters=params,
        version=ps.version,
        created_at=ps.created_at,
        updated_at=ps.updated_at,
    )


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


def _peak_to_response(p: Peak) -> PeakResponse:
    return PeakResponse(
        id=p.id,
        range_number=p.range_number,
        range_name=p.range_name,
        range_start=p.range_start,
        range_end=p.range_end,
        dn_dc=p.dn_dc,
        uv_extinction=p.uv_extinction,
        concentration=p.concentration,
        injected_mass=p.injected_mass,
        real_ri=p.real_ri,
        ls_model=p.ls_model,
        ls_fit_degree=p.ls_fit_degree,
        radius_type=p.radius_type,
        a2=p.a2,
        mn=p.mn,
        mw=p.mw,
        mz=p.mz,
        polydispersity=p.polydispersity,
        rms_radius=p.rms_radius,
        peak_area=p.peak_area,
        recovery=p.recovery,
        is_auto=p.is_auto,
        version=p.version,
        created_at=p.created_at,
        warnings=[],
    )


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/procedures
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/procedures", response_model=ProcedureListResponse)
def get_procedures(experiment_id: int, db: Session = Depends(get_db)):
    """Get all procedure states for an experiment."""
    _get_experiment_or_404(experiment_id, db)
    rows = db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id
    ).order_by(ProcedureState.procedure_order).all()
    return ProcedureListResponse(
        procedures=[_to_response(ps) for ps in rows],
        total=len(rows),
    )


# ---------------------------------------------------------------------------
# PUT /api/experiments/{id}/procedures/{name}
# ---------------------------------------------------------------------------
@router.put("/api/experiments/{experiment_id}/procedures/{procedure_name}", response_model=ProcedureStateResponse)
def update_procedure(
    experiment_id: int,
    procedure_name: str,
    body: ProcedureUpdateRequest,
    x_resource_version: int | None = Header(None, alias="X-Resource-Version"),
    db: Session = Depends(get_db),
):
    """Update a procedure state (enable/disable, parameters)."""
    _get_experiment_or_404(experiment_id, db)
    ps = db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id,
        ProcedureState.procedure_name == procedure_name,
    ).first()

    if ps is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Procedure '{procedure_name}' not found for experiment {experiment_id}",
        )

    if x_resource_version is not None and x_resource_version != ps.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Resource version mismatch: header {x_resource_version} != stored {ps.version}",
        )

    changes: dict = {"procedure_name": procedure_name}
    if body.is_enabled is not None:
        ps.is_enabled = body.is_enabled
        changes["is_enabled"] = body.is_enabled
    if body.has_been_run is not None:
        ps.has_been_run = body.has_been_run
        changes["has_been_run"] = body.has_been_run
    if body.parameters is not None:
        ps.parameters = json.dumps(body.parameters)
        changes["parameters"] = body.parameters

    ps.version = ps.version + 1
    changes["version"] = ps.version
    db.flush()
    _audit(db, experiment_id, "UPDATE", ps.id, changes)
    db.commit()
    db.refresh(ps)
    return _to_response(ps)


# ---------------------------------------------------------------------------
# POST /api/experiments/{id}/procedures/run
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/procedures/run", response_model=AutoAnalyzeResponse)
def run_all_procedures(
    experiment_id: int,
    body: ProcedureRunRequest | None = None,
    db: Session = Depends(get_db),
):
    """Run all enabled procedures for an experiment."""
    _get_experiment_or_404(experiment_id, db)
    peak_id = body.peak_id if body else None
    result = run_analysis(experiment_id, db, peak_id=peak_id)
    peaks = db.query(Peak).filter(Peak.experiment_id == experiment_id).order_by(Peak.range_number).all()
    procs = db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id
    ).order_by(ProcedureState.procedure_order).all()
    return AutoAnalyzeResponse(
        experiment_id=experiment_id,
        peaks=[_peak_to_response(p) for p in peaks],
        procedure_states=[_to_response(ps) for ps in procs],
        message=result.get("message", "Analysis complete"),
    )


# ---------------------------------------------------------------------------
# POST /api/experiments/{id}/procedures/{name}/run
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/procedures/{procedure_name}/run", response_model=AutoAnalyzeResponse)
def run_single_procedure(
    experiment_id: int,
    procedure_name: str,
    body: ProcedureRunRequest | None = None,
    db: Session = Depends(get_db),
):
    """Run a single procedure (or the full chain if name is 'all')."""
    _get_experiment_or_404(experiment_id, db)
    if procedure_name.lower() in ("all", "run", "analysis"):
        peak_id = body.peak_id if body else None
        result = run_analysis(experiment_id, db, peak_id=peak_id)
    else:
        result = run_analysis(experiment_id, db, peak_id=body.peak_id if body else None)
    peaks = db.query(Peak).filter(Peak.experiment_id == experiment_id).order_by(Peak.range_number).all()
    procs = db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id
    ).order_by(ProcedureState.procedure_order).all()
    return AutoAnalyzeResponse(
        experiment_id=experiment_id,
        peaks=[_peak_to_response(p) for p in peaks],
        procedure_states=[_to_response(ps) for ps in procs],
        message=result.get("message", "Analysis complete"),
    )


# ---------------------------------------------------------------------------
# POST /api/experiments/{id}/auto-analyze
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/auto-analyze", response_model=AutoAnalyzeResponse)
def auto_analyze(
    experiment_id: int,
    db: Session = Depends(get_db),
):
    """Auto-analyze: ensure baselines, peaks, then run the full procedure chain."""
    experiment = _get_experiment_or_404(experiment_id, db)

    from app.models import Baseline
    from app.services.baseline_engine import auto_baseline

    stored = db.query(Baseline).filter(Baseline.experiment_id == experiment_id).all()
    if not stored:
        try:
            detectors = list_detectors(experiment.raw_data_path)
        except Exception as e:
            logger.warning("auto_analyze: list_detectors failed: %s", e)
            detectors = []
        for det in detectors:
            code = det.get("code")
            if not code:
                continue
            try:
                data = load_single_detector(experiment.raw_data_path, code)
            except Exception:
                continue
            if data.get("error") or data.get("time") is None:
                continue
            time = np.asarray(data["time"], dtype=float)
            dd = data.get("data")
            rows = dd.get("data") if isinstance(dd, dict) else dd
            if rows is None:
                continue
            arr = np.asarray(rows, dtype=float)
            sig = np.nanmean(arr, axis=1) if arr.ndim == 2 else arr
            bl, slope, intercept, std = auto_baseline(time, sig)
            b = Baseline(
                experiment_id=experiment_id,
                detector_name=code,
                detector_class=det.get("instrument_class"),
                baseline_type=1,
                slope=float(slope) if slope is not None else None,
                intercept=float(intercept) if intercept is not None else None,
                std_dev=float(std) if std is not None else None,
                is_auto=True,
                version=1,
            )
            db.add(b)
        db.commit()

    peaks = db.query(Peak).filter(Peak.experiment_id == experiment_id).all()
    if not peaks:
        try:
            detectors = list_detectors(experiment.raw_data_path)
        except Exception:
            detectors = []
        chosen = "RI" if any(d.get("code") == "RI" for d in detectors) else \
                 ("MALS" if any(d.get("code") == "MALS" for d in detectors) else None)
        if chosen:
            try:
                data = load_single_detector(experiment.raw_data_path, chosen)
                if data.get("time") is not None:
                    time = np.asarray(data["time"], dtype=float)
                    dd = data.get("data")
                    rows = dd.get("data") if isinstance(dd, dict) else dd
                    arr = np.asarray(rows, dtype=float) if rows is not None else np.array([])
                    sig = np.nanmean(arr, axis=1) if arr.ndim == 2 else arr
                    detected = auto_detect_peaks(time, sig)
                    for det in detected:
                        rn = det["range_number"]
                        existing = db.query(Peak).filter(
                            Peak.experiment_id == experiment_id,
                            Peak.range_number == rn,
                        ).first()
                        if existing is None:
                            peak = Peak(
                                experiment_id=experiment_id,
                                range_number=rn,
                                range_start=det["range_start"],
                                range_end=det["range_end"],
                                is_auto=True,
                                version=1,
                            )
                            db.add(peak)
                db.commit()
            except Exception as e:
                logger.warning("auto_analyze: peak detection failed: %s", e)

    result = run_analysis(experiment_id, db)
    peaks = db.query(Peak).filter(Peak.experiment_id == experiment_id).order_by(Peak.range_number).all()
    procs = db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id
    ).order_by(ProcedureState.procedure_order).all()
    return AutoAnalyzeResponse(
        experiment_id=experiment_id,
        peaks=[_peak_to_response(p) for p in peaks],
        procedure_states=[_to_response(ps) for ps in procs],
        message=result.get("message", "Auto-analysis complete"),
    )
