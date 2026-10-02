"""Chromatogram data routes."""

import os

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Baseline, Experiment
from app.schemas import ChromatogramResponse, DetectorInfo, DetectorListResponse
from app.services.baseline_engine import compute_baseline, subtract_baseline
from app.services.chromatogram_service import (
    list_detectors,
    load_chromatograms,
    load_single_detector,
)

router = APIRouter(tags=["chromatograms"])


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
                "server. Please re-upload the file."
            ),
        )
    return experiment


def _apply_baselines(data: dict, experiment_id: int, db: Session) -> bool:
    """Apply stored baselines to the detector traces in-place.

    Returns True if at least one detector had a baseline applied.
    """
    rows = db.query(Baseline).filter(Baseline.experiment_id == experiment_id).all()
    if not rows:
        return False
    bl_by_name = {b.detector_name: b for b in rows if b.detector_name}
    shared_time = data.get("time")
    detectors = data.get("detectors", {})
    applied = False
    for name, det_data in detectors.items():
        bl = bl_by_name.get(name)
        if bl is None:
            continue
        rows_data = det_data.get("data") if isinstance(det_data, dict) else det_data
        if rows_data is None:
            continue
        # Prefer this detector's own time axis; fall back to the shared axis.
        det_time = det_data.get("time") if isinstance(det_data, dict) else None
        time = det_time if det_time is not None else shared_time
        if time is None:
            continue
        t = np.asarray(time, dtype=float)
        arr = np.asarray(rows_data, dtype=float)
        if arr.ndim == 2:
            sig = np.nanmean(arr, axis=1) if arr.shape[1] > 0 else arr[:, 0]
        else:
            sig = arr
        if len(sig) != len(t):
            continue
        baseline_arr, _, _, _ = compute_baseline(
            t, sig,
            baseline_type=int(bl.baseline_type or 0),
            x1=bl.x1, x2=bl.x2, y1=bl.y1, y2=bl.y2,
        )
        corrected = subtract_baseline(sig, baseline_arr)
        if arr.ndim == 2:
            new_rows = np.broadcast_to(
                corrected.reshape(-1, 1), arr.shape
            ).tolist()
        else:
            new_rows = corrected.tolist()
        if isinstance(det_data, dict):
            det_data["data"] = new_rows
        else:
            detectors[name] = new_rows
        applied = True
    return applied


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/chromatograms
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/chromatograms", response_model=ChromatogramResponse)
def get_all_chromatograms(
    experiment_id: int,
    baseline_subtracted: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Return ALL detector chromatogram data for an experiment."""
    experiment = _get_experiment_or_404(experiment_id, db)

    try:
        data = load_chromatograms(experiment.raw_data_path, file_hash=experiment.file_hash)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read chromatogram data: {str(e)}",
        )

    applied = False
    if baseline_subtracted:
        applied = _apply_baselines(data, experiment_id, db)

    return ChromatogramResponse(
        time=data.get("time"),
        detectors=data.get("detectors"),
        downsampled=data.get("downsampled", False),
        downsample_factor=data.get("downsample_factor"),
        point_count=len(data.get("time", [])) if data.get("time") else None,
        baseline_subtracted=applied,
    )


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/chromatograms/{detector}
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/chromatograms/{detector}")
def get_detector_chromatogram(
    experiment_id: int,
    detector: str,
    baseline_subtracted: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Return chromatogram data for a specific detector (MALS, RI, UV)."""
    experiment = _get_experiment_or_404(experiment_id, db)

    try:
        data = load_single_detector(experiment.raw_data_path, detector, file_hash=experiment.file_hash)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read chromatogram data: {str(e)}",
        )

    if data.get("error"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=data["error"],
        )

    if baseline_subtracted:
        rows = db.query(Baseline).filter(Baseline.experiment_id == experiment_id).all()
        bl_by_name = {b.detector_name: b for b in rows if b.detector_name}
        bl = bl_by_name.get(detector.upper())
        if bl is not None:
            t = np.asarray(data.get("time") or [], dtype=float)
            det_data = data.get("data")
            rows_data = det_data.get("data") if isinstance(det_data, dict) else det_data
            if rows_data is not None and len(t) > 0:
                arr = np.asarray(rows_data, dtype=float)
                if arr.ndim == 2:
                    sig = np.nanmean(arr, axis=1) if arr.shape[1] > 0 else arr[:, 0]
                else:
                    sig = arr
                if len(sig) == len(t):
                    baseline_arr, _, _, _ = compute_baseline(
                        t, sig,
                        baseline_type=int(bl.baseline_type or 0),
                        x1=bl.x1, x2=bl.x2, y1=bl.y1, y2=bl.y2,
                    )
                    corrected = subtract_baseline(sig, baseline_arr)
                    if arr.ndim == 2:
                        new_rows = np.broadcast_to(
                            corrected.reshape(-1, 1), arr.shape
                        ).tolist()
                    else:
                        new_rows = corrected.tolist()
                    if isinstance(det_data, dict):
                        det_data["data"] = new_rows
                    else:
                        data["data"] = new_rows
            data["baseline_subtracted"] = True

    return data


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/detectors
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/detectors", response_model=DetectorListResponse)
def list_experiment_detectors(experiment_id: int, db: Session = Depends(get_db)):
    """List all detectors with their codes, enabled flags, and metadata."""
    experiment = _get_experiment_or_404(experiment_id, db)

    try:
        detectors = list_detectors(experiment.raw_data_path)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list detectors: {str(e)}",
        )

    return DetectorListResponse(
        detectors=[DetectorInfo(**d) for d in detectors]
    )
