"""Batch processing routes — one-to-many settings propagation.

Endpoints:
  POST   /api/batch/apply         — start a batch apply job (202 + job_id)
  GET    /api/batch/{job_id}/status — poll batch job status
  GET    /api/batch/{job_id}/results — get batch job results (completed jobs)
  GET    /api/batch                — list all batch jobs
  DELETE /api/batch/{job_id}       — cancel a running batch job
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, get_db
from app.models import BatchJob, Experiment
from app.schemas import (
    BatchApplyRequest,
    BatchJobListResponse,
    BatchJobResponse,
    BatchJobStatus,
)
from app.services.batch_processor import run_batch

logger = logging.getLogger(__name__)

router = APIRouter(tags=["batch"])

_batch_jobs: dict[str, dict] = {}


def _get_experiment_or_404(experiment_id: int, db: Session) -> Experiment:
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )
    return experiment


@router.post(
    "/api/batch/apply",
    response_model=BatchJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def batch_apply(body: BatchApplyRequest, db: Session = Depends(get_db)):
    """Start a batch apply job — propagate settings from source to targets.

    Returns 202 with a job_id.  Poll ``GET /api/batch/{job_id}/status``.
    """
    _get_experiment_or_404(body.source_experiment_id, db)
    for target_id in body.target_experiment_ids:
        _get_experiment_or_404(target_id, db)

    job_id = str(uuid.uuid4())
    _batch_jobs[job_id] = {
        "job_id": job_id,
        "source_experiment_id": body.source_experiment_id,
        "status": "pending",
        "progress": 0,
        "message": "Queued",
        "error": None,
        "target_results": None,
    }

    db_job = BatchJob(
        created_by=None,
        source_experiment_id=body.source_experiment_id,
        target_experiment_ids=json.dumps(body.target_experiment_ids),
        settings_to_propagate=json.dumps(body.settings_to_propagate),
        status="pending",
        progress_pct=0.0,
    )
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    db_job_id = db_job.id

    thread = threading.Thread(
        target=_run_batch_job,
        args=(job_id, db_job_id, body.source_experiment_id, body.target_experiment_ids, body.settings_to_propagate),
        daemon=True,
    )
    thread.start()

    return BatchJobResponse(
        job_id=job_id,
        status="started",
        source_experiment_id=body.source_experiment_id,
        target_count=len(body.target_experiment_ids),
    )


@router.get("/api/batch/{job_id}/status", response_model=BatchJobStatus)
def batch_status(job_id: str, db: Session = Depends(get_db)):
    """Poll the status of a batch job."""
    job = _batch_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Batch job {job_id} not found")
    return BatchJobStatus(
        job_id=job_id,
        source_experiment_id=job["source_experiment_id"],
        status=job["status"],
        progress=job.get("progress", 0),
        message=job.get("message"),
        error=job.get("error"),
        target_results=job.get("target_results"),
    )


@router.get("/api/batch/{job_id}/results", response_model=BatchJobStatus)
def batch_results(job_id: str, db: Session = Depends(get_db)):
    """Get the results of a completed batch job."""
    job = _batch_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Batch job {job_id} not found")
    if job["status"] != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Batch job not complete (status: {job['status']})",
        )
    return BatchJobStatus(
        job_id=job_id,
        source_experiment_id=job["source_experiment_id"],
        status=job["status"],
        progress=job.get("progress", 100),
        message=job.get("message"),
        error=job.get("error"),
        target_results=job.get("target_results"),
    )


@router.get("/api/batch", response_model=BatchJobListResponse)
def list_batch_jobs(db: Session = Depends(get_db)):
    """List all batch jobs (history)."""
    jobs = list(_batch_jobs.values())
    return BatchJobListResponse(
        jobs=[
            BatchJobStatus(
                job_id=j["job_id"],
                source_experiment_id=j["source_experiment_id"],
                status=j["status"],
                progress=j.get("progress", 0),
                message=j.get("message"),
                error=j.get("error"),
                target_results=j.get("target_results"),
            )
            for j in jobs
        ],
        total=len(jobs),
    )


@router.delete("/api/batch/{job_id}")
def cancel_batch(job_id: str, db: Session = Depends(get_db)):
    """Cancel a running batch job (best-effort — in-flight targets will complete)."""
    job = _batch_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Batch job {job_id} not found")
    if job["status"] in ("completed", "failed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel a {job['status']} job",
        )
    job["status"] = "cancelled"
    job["message"] = "Cancelled by user"
    return {"message": f"Batch job {job_id} cancelled"}


def _run_batch_job(
    job_id: str,
    db_job_id: int,
    source_experiment_id: int,
    target_experiment_ids: list[int],
    settings_to_propagate: list[str],
) -> None:
    """Run the batch propagation in a background thread."""
    job = _batch_jobs.get(job_id)
    if job is None:
        return
    db = SessionLocal()
    try:
        job["status"] = "running"
        job["message"] = f"Processing {len(target_experiment_ids)} target(s)"

        def _progress(current: int, total: int, message: str) -> None:
            pct = int((current / total) * 100) if total > 0 else 0
            job["progress"] = pct
            job["message"] = message

        results = run_batch(
            db,
            source_experiment_id,
            target_experiment_ids,
            settings_to_propagate,
            progress_callback=_progress,
        )

        job["status"] = "completed"
        job["progress"] = 100
        job["message"] = f"Batch complete ({len(results)} targets)"
        job["target_results"] = results

        db_job = db.query(BatchJob).filter(BatchJob.id == db_job_id).first()
        if db_job is not None:
            db_job.status = "completed"
            db_job.progress_pct = 100.0
            db_job.completed_at = datetime.now()
            db.commit()
    except Exception as e:
        logger.exception("Batch job %s failed", job_id)
        job["status"] = "failed"
        job["error"] = str(e)
        db_job = db.query(BatchJob).filter(BatchJob.id == db_job_id).first()
        if db_job is not None:
            db_job.status = "failed"
            db_job.error_message = str(e)
            db_job.completed_at = datetime.now()
            db.commit()
    finally:
        db.close()
