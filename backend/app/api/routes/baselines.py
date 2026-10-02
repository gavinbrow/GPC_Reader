"""Baseline management routes."""

import json
import logging
import os

import numpy as np
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import AuditLog, Baseline, Experiment
from app.schemas import (
    AutoBaselineRequest,
    AutoBaselineResponse,
    BaselineCreate,
    BaselineListResponse,
    BaselineResponse,
    BlankSubtractRequest,
    BlankSubtractResponse,
)
from app.services.baseline_engine import auto_baseline, compute_baseline
from app.services.chromatogram_service import list_detectors, load_single_detector

logger = logging.getLogger(__name__)

router = APIRouter(tags=["baselines"])


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
    if not os.path.exists(experiment.raw_data_path):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "The raw data file for this experiment is missing from the "
                "server (it may have been removed or the upload is incomplete). "
                "Please re-upload the file."
            ),
        )
    return experiment


def _to_response(b: Baseline) -> BaselineResponse:
    return BaselineResponse(
        id=b.id,
        experiment_id=b.experiment_id,
        detector_name=b.detector_name,
        detector_class=b.detector_class,
        baseline_type=b.baseline_type,
        x1=b.x1,
        x2=b.x2,
        y1=b.y1,
        y2=b.y2,
        slope=b.slope,
        intercept=b.intercept,
        std_dev=b.std_dev,
        is_auto=b.is_auto,
        version=b.version,
        created_at=b.created_at,
    )


def _audit(db: Session, experiment_id: int, action: str, entity_id: int | None, changes: dict):
    log = AuditLog(
        experiment_id=experiment_id,
        user_id=None,
        action=action,
        entity_type="baseline",
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
# GET /api/experiments/{id}/baselines
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/baselines", response_model=BaselineListResponse)
def get_baselines(experiment_id: int, db: Session = Depends(get_db)):
    """Get all baselines for an experiment."""
    _get_experiment_or_404(experiment_id, db)
    rows = db.query(Baseline).filter(Baseline.experiment_id == experiment_id).all()
    return BaselineListResponse(
        baselines=[_to_response(b) for b in rows],
        total=len(rows),
    )


# ---------------------------------------------------------------------------
# PUT /api/experiments/{id}/baselines/{detector}
# ---------------------------------------------------------------------------
@router.put("/api/experiments/{experiment_id}/baselines/{detector}", response_model=BaselineResponse)
def upsert_baseline(
    experiment_id: int,
    detector: str,
    body: BaselineCreate,
    x_resource_version: int | None = Header(None, alias="X-Resource-Version"),
    db: Session = Depends(get_db),
):
    """Set or update a baseline for a detector (upsert by experiment+detector)."""
    experiment = _get_experiment_or_404(experiment_id, db)

    if body.detector_name != detector:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Path detector '{detector}' does not match body detector_name '{body.detector_name}'",
        )

    existing = db.query(Baseline).filter(
        Baseline.experiment_id == experiment_id,
        Baseline.detector_name == detector,
    ).first()

    time, signal = _detector_signal(experiment.raw_data_path, detector)

    if time is not None and signal is not None and len(time) == len(signal):
        baseline_arr, slope, intercept, std_dev = compute_baseline(
            time, signal, body.baseline_type, body.x1, body.x2, body.y1, body.y2,
        )
    else:
        slope, intercept, std_dev = None, None, None

    if existing is not None:
        if x_resource_version is not None and x_resource_version != existing.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Resource version mismatch: header {x_resource_version} != stored {existing.version}",
            )
        existing.baseline_type = body.baseline_type
        existing.x1 = body.x1
        existing.x2 = body.x2
        existing.y1 = body.y1
        existing.y2 = body.y2
        existing.detector_class = body.detector_class or existing.detector_class
        existing.is_auto = body.is_auto
        existing.slope = slope
        existing.intercept = intercept
        existing.std_dev = std_dev
        existing.version = existing.version + 1
        db.flush()
        _audit(db, experiment_id, "UPDATE", existing.id, {
            "detector": detector,
            "baseline_type": body.baseline_type,
            "version": existing.version,
        })
        db.commit()
        db.refresh(existing)
        return _to_response(existing)

    baseline = Baseline(
        experiment_id=experiment_id,
        detector_name=detector,
        detector_class=body.detector_class,
        baseline_type=body.baseline_type,
        x1=body.x1,
        x2=body.x2,
        y1=body.y1,
        y2=body.y2,
        slope=slope,
        intercept=intercept,
        std_dev=std_dev,
        is_auto=body.is_auto,
        version=1,
    )
    db.add(baseline)
    db.flush()
    _audit(db, experiment_id, "CREATE", baseline.id, {
        "detector": detector,
        "baseline_type": body.baseline_type,
    })
    db.commit()
    db.refresh(baseline)
    return _to_response(baseline)


# ---------------------------------------------------------------------------
# DELETE /api/experiments/{id}/baselines/{detector}
# ---------------------------------------------------------------------------
@router.delete("/api/experiments/{experiment_id}/baselines/{detector}")
def delete_baseline(
    experiment_id: int,
    detector: str,
    x_resource_version: int | None = Header(None, alias="X-Resource-Version"),
    db: Session = Depends(get_db),
):
    """Delete a baseline for a detector."""
    _get_experiment_or_404(experiment_id, db)
    existing = db.query(Baseline).filter(
        Baseline.experiment_id == experiment_id,
        Baseline.detector_name == detector,
    ).first()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No baseline for detector '{detector}' on experiment {experiment_id}",
        )
    if x_resource_version is not None and x_resource_version != existing.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Resource version mismatch: header {x_resource_version} != stored {existing.version}",
        )
    bid = existing.id
    bver = existing.version
    db.delete(existing)
    _audit(db, experiment_id, "DELETE", bid, {"detector": detector, "version": bver})
    db.commit()
    return {"message": f"Baseline for {detector} deleted"}


# ---------------------------------------------------------------------------
# POST /api/experiments/{id}/baselines/auto
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/baselines/auto", response_model=AutoBaselineResponse)
def auto_detect_baselines(
    experiment_id: int,
    body: AutoBaselineRequest | None = None,
    db: Session = Depends(get_db),
):
    """Auto-detect baselines for all detectors present in the experiment."""
    experiment = _get_experiment_or_404(experiment_id, db)
    params = body or AutoBaselineRequest()

    try:
        detectors = list_detectors(experiment.raw_data_path)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list detectors: {str(e)}",
        )

    created: list[BaselineResponse] = []
    for det in detectors:
        code = det.get("code")
        if not code:
            continue
        time, signal = _detector_signal(experiment.raw_data_path, code)
        if time is None or signal is None or len(time) == 0 or len(signal) == 0:
            continue
        try:
            baseline_arr, slope, intercept, std_dev = auto_baseline(
                time, signal, params.width_std_dev, params.num_passes,
            )
        except Exception as e:
            logger.warning("auto_baseline failed for %s: %s", code, e)
            continue

        existing = db.query(Baseline).filter(
            Baseline.experiment_id == experiment_id,
            Baseline.detector_name == code,
        ).first()

        if existing is not None:
            existing.baseline_type = 1
            existing.slope = float(slope) if slope is not None else None
            existing.intercept = float(intercept) if intercept is not None else None
            existing.std_dev = float(std_dev) if std_dev is not None else None
            existing.is_auto = True
            existing.detector_class = det.get("instrument_class") or existing.detector_class
            existing.version = existing.version + 1
            db.flush()
            _audit(db, experiment_id, "UPDATE", existing.id, {
                "detector": code, "auto": True, "version": existing.version,
            })
            db.refresh(existing)
            created.append(_to_response(existing))
        else:
            b = Baseline(
                experiment_id=experiment_id,
                detector_name=code,
                detector_class=det.get("instrument_class"),
                baseline_type=1,
                slope=float(slope) if slope is not None else None,
                intercept=float(intercept) if intercept is not None else None,
                std_dev=float(std_dev) if std_dev is not None else None,
                is_auto=True,
                version=1,
            )
            db.add(b)
            db.flush()
            _audit(db, experiment_id, "CREATE", b.id, {"detector": code, "auto": True})
            db.refresh(b)
            created.append(_to_response(b))

    db.commit()
    return AutoBaselineResponse(
        baselines=created,
        message=f"Auto-baseline computed for {len(created)} detector(s)",
    )


# ---------------------------------------------------------------------------
# POST /api/experiments/{id}/baselines/blank-subtract
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/baselines/blank-subtract", response_model=BlankSubtractResponse)
def blank_subtract(
    experiment_id: int,
    body: BlankSubtractRequest,
    db: Session = Depends(get_db),
):
    """Subtract a blank-run experiment from the current experiment.

    Phase 2.1 MVP: stores a metadata flag noting the blank subtraction was
    applied (full signal-level subtraction is a later-phase task).
    """
    _get_experiment_or_404(experiment_id, db)
    blank = db.query(Experiment).filter(Experiment.id == body.blank_experiment_id).first()
    if blank is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Blank experiment {body.blank_experiment_id} not found",
        )

    _audit(db, experiment_id, "UPDATE", None, {
        "action": "blank-subtract",
        "blank_experiment_id": body.blank_experiment_id,
    })
    db.commit()
    return BlankSubtractResponse(
        message=f"Blank subtraction applied using experiment {body.blank_experiment_id}",
        blank_experiment_id=body.blank_experiment_id,
    )
