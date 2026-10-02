"""Peak management and dn/dc library routes."""

import json
import logging

import numpy as np
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import AuditLog, Experiment, Peak
from app.schemas import (
    AutoPeakRequest,
    AutoPeakResponse,
    DnDcLibraryEntry,
    DnDcLibraryResponse,
    PeakCreate,
    PeakListResponse,
    PeakResponse,
    PeakUpdate,
)
from app.services.chromatogram_service import list_detectors, load_single_detector
from app.services.dn_dc_library import get_all as dndc_get_all
from app.services.dn_dc_library import search_library as dndc_search
from app.services.dn_dc_library import validate_dndc
from app.services.peak_engine import auto_detect_peaks

logger = logging.getLogger(__name__)

router = APIRouter(tags=["peaks"])


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


def _to_response(p: Peak, warnings: list[str] | None = None) -> PeakResponse:
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
        warnings=warnings if warnings is not None else [],
    )


def _audit(db: Session, experiment_id: int, action: str, entity_id: int | None, changes: dict):
    log = AuditLog(
        experiment_id=experiment_id,
        user_id=None,
        action=action,
        entity_type="peak",
        entity_id=entity_id,
        changes=json.dumps(changes, default=str),
    )
    db.add(log)


def _detector_signal(raw_data_path: str, detector: str):
    """Return (time_list, signal_list) for a detector, or (None, None) on failure."""
    try:
        data = load_single_detector(raw_data_path, detector)
    except Exception:
        return None, None
    if data.get("error") or data.get("time") is None:
        return None, None
    time = data["time"]
    det_data = data.get("data")
    if det_data is None:
        return None, None
    if isinstance(det_data, dict):
        rows = det_data.get("data")
    else:
        rows = det_data
    if rows is None:
        return None, None
    arr = np.asarray(rows, dtype=float)
    if arr.ndim == 2:
        signal = np.nanmean(arr, axis=1) if arr.shape[1] > 0 else arr[:, 0]
    else:
        signal = arr
    return np.asarray(time, dtype=float), signal


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/peaks
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/peaks", response_model=PeakListResponse)
def get_peaks(experiment_id: int, db: Session = Depends(get_db)):
    """Get all peaks for an experiment."""
    _get_experiment_or_404(experiment_id, db)
    rows = db.query(Peak).filter(Peak.experiment_id == experiment_id).order_by(Peak.range_number).all()
    return PeakListResponse(
        peaks=[_to_response(p) for p in rows],
        total=len(rows),
    )


# ---------------------------------------------------------------------------
# POST /api/experiments/{id}/peaks
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/peaks", response_model=PeakResponse)
def create_peak(experiment_id: int, body: PeakCreate, db: Session = Depends(get_db)):
    """Create a new peak for an experiment."""
    _get_experiment_or_404(experiment_id, db)

    range_number = body.range_number
    if range_number is None:
        existing = db.query(Peak).filter(Peak.experiment_id == experiment_id).all()
        max_num = max((p.range_number or 0) for p in existing) if existing else 0
        range_number = max_num + 1

    peak = Peak(
        experiment_id=experiment_id,
        range_number=range_number,
        range_name=body.range_name,
        range_start=body.range_start,
        range_end=body.range_end,
        dn_dc=body.dn_dc,
        uv_extinction=body.uv_extinction,
        concentration=body.concentration,
        injected_mass=body.injected_mass,
        real_ri=body.real_ri,
        ls_model=body.ls_model,
        ls_fit_degree=body.ls_fit_degree,
        radius_type=body.radius_type,
        a2=body.a2,
        is_auto=body.is_auto,
        version=1,
    )
    db.add(peak)
    db.flush()
    _audit(db, experiment_id, "CREATE", peak.id, {
        "range_number": range_number,
        "range_start": body.range_start,
        "range_end": body.range_end,
    })
    db.commit()
    db.refresh(peak)

    warnings = validate_dndc(body.dn_dc) if body.dn_dc is not None else []
    return _to_response(peak, warnings=warnings)


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/peaks/{peak_id}
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/peaks/{peak_id}", response_model=PeakResponse)
def get_single_peak(experiment_id: int, peak_id: int, db: Session = Depends(get_db)):
    """Get a single peak by ID."""
    _get_experiment_or_404(experiment_id, db)
    peak = db.query(Peak).filter(
        Peak.id == peak_id,
        Peak.experiment_id == experiment_id,
    ).first()
    if peak is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peak {peak_id} not found for experiment {experiment_id}",
        )
    return _to_response(peak)


# ---------------------------------------------------------------------------
# PUT /api/experiments/{id}/peaks/{peak_id}
# ---------------------------------------------------------------------------
@router.put("/api/experiments/{experiment_id}/peaks/{peak_id}", response_model=PeakResponse)
def update_peak(
    experiment_id: int,
    peak_id: int,
    body: PeakUpdate,
    x_resource_version: int | None = Header(None, alias="X-Resource-Version"),
    db: Session = Depends(get_db),
):
    """Apply a partial update to a peak. Increments version; checks X-Resource-Version."""
    _get_experiment_or_404(experiment_id, db)
    peak = db.query(Peak).filter(
        Peak.id == peak_id,
        Peak.experiment_id == experiment_id,
    ).first()
    if peak is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peak {peak_id} not found for experiment {experiment_id}",
        )

    if x_resource_version is not None and x_resource_version != peak.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Resource version mismatch: header {x_resource_version} != stored {peak.version}",
        )

    changes: dict = {}
    for field in (
        "range_start", "range_end", "range_number", "range_name",
        "dn_dc", "uv_extinction", "concentration", "injected_mass",
        "real_ri", "ls_model", "ls_fit_degree", "radius_type", "a2", "is_auto",
    ):
        v = getattr(body, field)
        if v is None:
            continue
        setattr(peak, field, v)
        changes[field] = v

    peak.version = peak.version + 1
    changes["version"] = peak.version
    db.flush()
    _audit(db, experiment_id, "UPDATE", peak.id, changes)
    db.commit()
    db.refresh(peak)

    warnings = validate_dndc(peak.dn_dc) if peak.dn_dc is not None else []
    return _to_response(peak, warnings=warnings)


# ---------------------------------------------------------------------------
# DELETE /api/experiments/{id}/peaks/{peak_id}
# ---------------------------------------------------------------------------
@router.delete("/api/experiments/{experiment_id}/peaks/{peak_id}")
def delete_peak(
    experiment_id: int,
    peak_id: int,
    x_resource_version: int | None = Header(None, alias="X-Resource-Version"),
    db: Session = Depends(get_db),
):
    """Delete a peak."""
    _get_experiment_or_404(experiment_id, db)
    peak = db.query(Peak).filter(
        Peak.id == peak_id,
        Peak.experiment_id == experiment_id,
    ).first()
    if peak is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peak {peak_id} not found for experiment {experiment_id}",
        )
    if x_resource_version is not None and x_resource_version != peak.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Resource version mismatch: header {x_resource_version} != stored {peak.version}",
        )
    pid = peak.id
    pver = peak.version
    rnum = peak.range_number
    db.delete(peak)
    _audit(db, experiment_id, "DELETE", pid, {"range_number": rnum, "version": pver})
    db.commit()
    return {"message": f"Peak {peak_id} deleted"}


# ---------------------------------------------------------------------------
# POST /api/experiments/{id}/peaks/auto
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/peaks/auto", response_model=AutoPeakResponse)
def auto_detect_peaks_endpoint(
    experiment_id: int,
    body: AutoPeakRequest | None = None,
    db: Session = Depends(get_db),
):
    """Auto-detect peaks for an experiment using a chosen detector."""
    experiment = _get_experiment_or_404(experiment_id, db)
    params = body or AutoPeakRequest()

    try:
        detectors = list_detectors(experiment.raw_data_path)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list detectors: {str(e)}",
        )

    available = {d.get("code"): d for d in detectors if d.get("code")}
    chosen: str | None = None
    if params.detector:
        chosen = params.detector.upper()
        if chosen not in available:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Detector {params.detector} not found in experiment",
            )
    else:
        if "RI" in available:
            chosen = "RI"
        elif "MALS" in available:
            chosen = "MALS"
        else:
            chosen = next(iter(available), None)

    if chosen is None:
        return AutoPeakResponse(peaks=[], message="No detectors available")

    time, signal = _detector_signal(experiment.raw_data_path, chosen)
    if time is None or signal is None or len(time) == 0 or len(signal) == 0:
        return AutoPeakResponse(peaks=[], message=f"No signal available for detector {chosen}")

    try:
        detected = auto_detect_peaks(
            time, signal,
            baseline_percent=params.baseline_percent,
            min_peak_width=params.min_peak_width,
            threshold=params.threshold,
        )
    except Exception as e:
        logger.warning("auto_detect_peaks failed for %s: %s", chosen, e)
        return AutoPeakResponse(peaks=[], message=f"Auto-detection failed: {e}")

    responses: list[PeakResponse] = []
    for det in detected:
        range_number = det["range_number"]
        existing = db.query(Peak).filter(
            Peak.experiment_id == experiment_id,
            Peak.range_number == range_number,
        ).first()
        if existing is not None:
            existing.range_start = det["range_start"]
            existing.range_end = det["range_end"]
            existing.is_auto = True
            existing.version = existing.version + 1
            db.flush()
            _audit(db, experiment_id, "UPDATE", existing.id, {
                "auto": True,
                "range_number": range_number,
                "range_start": det["range_start"],
                "range_end": det["range_end"],
                "version": existing.version,
            })
            db.refresh(existing)
            responses.append(_to_response(existing))
        else:
            peak = Peak(
                experiment_id=experiment_id,
                range_number=range_number,
                range_start=det["range_start"],
                range_end=det["range_end"],
                is_auto=True,
                version=1,
            )
            db.add(peak)
            db.flush()
            _audit(db, experiment_id, "CREATE", peak.id, {
                "auto": True,
                "range_number": range_number,
                "range_start": det["range_start"],
                "range_end": det["range_end"],
            })
            db.refresh(peak)
            responses.append(_to_response(peak))

    db.commit()
    return AutoPeakResponse(
        peaks=responses,
        message=f"Auto-peak detection complete for {chosen} ({len(responses)} peak(s))",
    )


# ---------------------------------------------------------------------------
# GET /api/dndc/library
# ---------------------------------------------------------------------------
@router.get("/api/dndc/library", response_model=DnDcLibraryResponse)
def get_dndc_library(
    polymer: str | None = Query(None),
    solvent: str | None = Query(None),
):
    """List/search the dn/dc library with optional case-insensitive substring filters."""
    if polymer is None and solvent is None:
        entries = dndc_get_all()
    else:
        entries = dndc_search(polymer=polymer, solvent=solvent)
    return DnDcLibraryResponse(
        entries=[DnDcLibraryEntry(**e) for e in entries],
        total=len(entries),
    )
