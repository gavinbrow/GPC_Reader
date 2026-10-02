"""Reports routes — report template CRUD, report generation, and download.

Endpoints:
  GET    /api/reports/templates                — list templates
  POST   /api/reports/templates                 — create template
  GET    /api/reports/templates/{id}            — get single template
  PUT    /api/reports/templates/{id}            — update template
  DELETE /api/reports/templates/{id}            — delete template
  POST   /api/experiments/{id}/reports/generate — queue report (202 + job_id)
  GET    /api/experiments/{id}/reports/{job_id}/status — poll status
  GET    /api/experiments/{id}/reports/{job_id}/download — download file
"""

from __future__ import annotations

import logging
import os
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import SessionLocal, get_db
from app.models import ComputedData, Experiment, Peak, ReportTemplate
from app.schemas import (
    ReportGenerateRequest,
    ReportJobResponse,
    ReportJobStatus,
    ReportTemplateCreate,
    ReportTemplateListResponse,
    ReportTemplateResponse,
    ReportTemplateUpdate,
)
from app.services.report_engine import (
    collect_report_data,
    generate_csv_report,
    generate_excel_report,
    generate_pdf_report,
    render_html_report,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reports"])


_REPORT_DIR = os.path.join(settings.UPLOAD_DIR, "reports")
_report_jobs: dict[str, dict] = {}


def _get_experiment_or_404(experiment_id: int, db: Session) -> Experiment:
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )
    return experiment


# ---------------------------------------------------------------------------
# Report template CRUD
# ---------------------------------------------------------------------------
@router.get("/api/reports/templates", response_model=ReportTemplateListResponse)
def list_templates(db: Session = Depends(get_db)):
    """List all report templates."""
    templates = db.query(ReportTemplate).order_by(ReportTemplate.id).all()
    return ReportTemplateListResponse(
        templates=[ReportTemplateResponse.model_validate(t) for t in templates],
        total=len(templates),
    )


@router.post("/api/reports/templates", response_model=ReportTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template(body: ReportTemplateCreate, db: Session = Depends(get_db)):
    """Create a new report template."""
    template = ReportTemplate(
        name=body.name,
        template_config=body.template_config,
        is_default=body.is_default,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return ReportTemplateResponse.model_validate(template)


@router.get("/api/reports/templates/{template_id}", response_model=ReportTemplateResponse)
def get_template(template_id: int, db: Session = Depends(get_db)):
    """Get a single report template."""
    template = db.query(ReportTemplate).filter(ReportTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Template {template_id} not found")
    return ReportTemplateResponse.model_validate(template)


@router.put("/api/reports/templates/{template_id}", response_model=ReportTemplateResponse)
def update_template(template_id: int, body: ReportTemplateUpdate, db: Session = Depends(get_db)):
    """Update an existing report template."""
    template = db.query(ReportTemplate).filter(ReportTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Template {template_id} not found")
    if body.name is not None:
        template.name = body.name
    if body.template_config is not None:
        template.template_config = body.template_config
    if body.is_default is not None:
        template.is_default = body.is_default
    db.commit()
    db.refresh(template)
    return ReportTemplateResponse.model_validate(template)


@router.delete("/api/reports/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    """Delete a report template."""
    template = db.query(ReportTemplate).filter(ReportTemplate.id == template_id).first()
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Template {template_id} not found")
    db.delete(template)
    db.commit()


# ---------------------------------------------------------------------------
# Report generation (async with polling)
# ---------------------------------------------------------------------------
@router.post(
    "/api/experiments/{experiment_id}/reports/generate",
    response_model=ReportJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_report(
    experiment_id: int,
    body: ReportGenerateRequest,
    db: Session = Depends(get_db),
):
    """Queue a report for generation. Returns 202 with a job_id.

    The client polls ``GET /api/experiments/{id}/reports/{job_id}/status``
    until ``status`` is ``completed`` or ``failed``, then downloads via
    ``GET /api/experiments/{id}/reports/{job_id}/download``.
    """
    _get_experiment_or_404(experiment_id, db)
    job_id = str(uuid.uuid4())
    _report_jobs[job_id] = {
        "experiment_id": experiment_id,
        "status": "pending",
        "format": body.format,
        "progress": 0,
        "message": "Queued",
        "error": None,
        "file_path": None,
        "file_size": None,
    }
    thread = threading.Thread(
        target=_run_report_job,
        args=(job_id, experiment_id, body.format, body.title, body.notes, body.include_slice_data),
        daemon=True,
    )
    thread.start()
    return ReportJobResponse(job_id=job_id, status="started", experiment_id=experiment_id)


@router.get(
    "/api/experiments/{experiment_id}/reports/{job_id}/status",
    response_model=ReportJobStatus,
)
def get_report_status(experiment_id: int, job_id: str, db: Session = Depends(get_db)):
    """Poll the status of a report generation job."""
    _get_experiment_or_404(experiment_id, db)
    job = _report_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Report job {job_id} not found")
    if job["experiment_id"] != experiment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Report job {job_id} not found")
    return ReportJobStatus(
        job_id=job_id,
        experiment_id=experiment_id,
        status=job["status"],
        format=job.get("format"),
        progress=job.get("progress", 0),
        message=job.get("message"),
        error=job.get("error"),
        file_path=job.get("file_path"),
        file_size=job.get("file_size"),
    )


@router.get("/api/experiments/{experiment_id}/reports/{job_id}/download")
def download_report(experiment_id: int, job_id: str, db: Session = Depends(get_db)):
    """Download a completed report file."""
    _get_experiment_or_404(experiment_id, db)
    job = _report_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Report job {job_id} not found")
    if job["experiment_id"] != experiment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Report job {job_id} not found")
    if job["status"] != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Report not ready (status: {job['status']})",
        )
    file_path = job.get("file_path")
    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report file not found on disk")

    fmt = job.get("format", "pdf")
    ext_map = {"pdf": "pdf", "html": "html", "csv": "csv", "xlsx": "xlsx"}
    ext = ext_map.get(fmt, "bin")
    media_map = {
        "pdf": "application/pdf",
        "html": "text/html",
        "csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    media = media_map.get(fmt, "application/octet-stream")
    filename = f"experiment_{experiment_id}_report.{ext}"
    return FileResponse(path=file_path, media_type=media, filename=filename)


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------
def _run_report_job(
    job_id: str,
    experiment_id: int,
    fmt: str,
    title: str | None,
    notes: str | None,
    include_slice_data: bool,
) -> None:
    """Run report generation in a background thread."""
    job = _report_jobs.get(job_id)
    if job is None:
        return
    db = SessionLocal()
    try:
        job["status"] = "running"
        job["progress"] = 10
        job["message"] = "Collecting data"

        experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
        if experiment is None:
            job["status"] = "failed"
            job["error"] = f"Experiment {experiment_id} not found"
            return

        peaks = db.query(Peak).filter(
            Peak.experiment_id == experiment_id
        ).order_by(Peak.range_number).all()

        computed_data = db.query(ComputedData).filter(
            ComputedData.experiment_id == experiment_id
        ).all()

        job["progress"] = 30
        job["message"] = "Building report data"

        data = collect_report_data(experiment, peaks, computed_data)

        job["progress"] = 60
        job["message"] = f"Generating {fmt.upper()}"

        os.makedirs(_REPORT_DIR, exist_ok=True)

        if fmt == "html":
            html_str = render_html_report(data, title=title, notes=notes, include_slice_data=include_slice_data)
            file_path = os.path.join(_REPORT_DIR, f"{job_id}.html")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(html_str)
        elif fmt == "pdf":
            pdf_bytes = generate_pdf_report(data, title=title, notes=notes, include_slice_data=include_slice_data)
            file_path = os.path.join(_REPORT_DIR, f"{job_id}.pdf")
            with open(file_path, "wb") as f:
                f.write(pdf_bytes)
        elif fmt == "csv":
            csv_bytes = generate_csv_report(data, include_slice_data=include_slice_data)
            file_path = os.path.join(_REPORT_DIR, f"{job_id}.csv")
            with open(file_path, "wb") as f:
                f.write(csv_bytes)
        elif fmt == "xlsx":
            xlsx_bytes = generate_excel_report(data, include_slice_data=include_slice_data)
            file_path = os.path.join(_REPORT_DIR, f"{job_id}.xlsx")
            with open(file_path, "wb") as f:
                f.write(xlsx_bytes)
        else:
            job["status"] = "failed"
            job["error"] = f"Unknown format: {fmt}"
            return

        job["status"] = "completed"
        job["progress"] = 100
        job["message"] = "Complete"
        job["file_path"] = file_path
        job["file_size"] = os.path.getsize(file_path)
    except Exception as e:
        logger.exception("Report generation failed for job %s", job_id)
        job["status"] = "failed"
        job["error"] = str(e)
    finally:
        db.close()
