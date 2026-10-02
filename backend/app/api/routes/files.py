"""File upload and experiment management routes."""

import json
import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import get_db
from app.models import AuditLog, Baseline, BatchJob, Experiment, Peak, ProcedureState
from app.schemas import (
    ExperimentListResponse,
    ExperimentMetadata,
    ExperimentResponse,
    ExportOptions,
    PeakResponse,
    SaveAsRequest,
    UploadResponse,
)
from app.services.file_export import export_afe8
from app.services.file_import import ImportService

router = APIRouter(tags=["files"])


# ---------------------------------------------------------------------------
# In-memory rate limiter for uploads (10 uploads per minute per IP)
# ---------------------------------------------------------------------------
class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._requests: dict[str, list[float]] = {}

    def check(self, key: str) -> bool:
        """Return True if the request is allowed, False if rate-limited."""
        import time
        now = time.time()
        if key not in self._requests:
            self._requests[key] = []
        # Prune old entries
        self._requests[key] = [t for t in self._requests[key] if now - t < self.window]
        if len(self._requests[key]) >= self.max_requests:
            return False
        self._requests[key].append(now)
        return True


_rate_limiter = RateLimiter(
    max_requests=settings.RATE_LIMIT_UPLOADS_PER_MINUTE,
    window_seconds=60,
)


# ---------------------------------------------------------------------------
# POST /api/files/upload
# ---------------------------------------------------------------------------
async def _process_single_upload(
    upload_file_obj: UploadFile,
    db: Session,
    client_ip: str,
) -> dict:
    """Process a single uploaded file. Returns a result dict."""
    try:
        file_size = 0
        upload_id = str(uuid.uuid4())
        dest_path = os.path.join(settings.UPLOAD_DIR, f"{upload_id}.afe8")

        # Read the file in chunks to respect the size limit
        with open(dest_path, "wb") as f:
            while True:
                chunk = await upload_file_obj.read(65536)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > settings.MAX_UPLOAD_SIZE_BYTES:
                    f.close()
                    os.unlink(dest_path)
                    return {"error": f"File '{upload_file_obj.filename}' exceeds maximum size of {settings.MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB"}
                f.write(chunk)

        # Validate gzip magic bytes
        if not ImportService.validate_gzip_magic(dest_path):
            os.unlink(dest_path)
            return {"error": f"File '{upload_file_obj.filename}' is not a gzip-compressed .afe8 file (magic bytes mismatch)"}

        # Health check: validate SQLite + required tables
        if not ImportService.health_check(dest_path):
            os.unlink(dest_path)
            return {"error": f"File '{upload_file_obj.filename}' is not a valid .afe8 file (missing WExperiment table)"}

        # Compute file hash
        file_hash = ImportService.compute_file_hash(dest_path)

        # Check for duplicates
        existing = db.query(Experiment).filter(Experiment.file_hash == file_hash).first()
        if existing:
            os.unlink(dest_path)
            return {"error": f"File '{upload_file_obj.filename}' already uploaded (experiment ID {existing.id})", "duplicate": True, "experiment_id": existing.id}

        # Parse the file
        try:
            experiment_dict = ImportService.import_file(dest_path, upload_file_obj.filename)
        except Exception as e:
            os.unlink(dest_path)
            return {"error": f"Failed to parse '{upload_file_obj.filename}': {str(e)}"}

        # Persist to database
        experiment = ImportService.save_experiment(
            db=db,
            experiment_dict=experiment_dict,
            raw_data_path=dest_path,
            file_hash=file_hash,
            file_size=file_size,
        )

        return UploadResponse(
            experiment_id=experiment.id,
            file_name=experiment.file_name,
            file_size=file_size,
            file_hash=file_hash,
            sample_name=experiment.sample_name,
            message="File uploaded and parsed successfully",
        ).model_dump()
    except Exception as e:
        return {"error": f"Unexpected error processing '{upload_file_obj.filename}': {str(e)}"}


@router.post("/api/files/upload", status_code=201)
async def upload_file(
    request: Request,
    files: Optional[list[UploadFile]] = File(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """Upload one or more .afe8 files, validate, parse, and store experiments.

    Accepts both 'files' and 'file' form field names for compatibility.
    Returns a list of results (one per file).
    """
    # Rate limiting
    client_ip = request.client.host if request.client else "unknown"
    if not _rate_limiter.check(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Upload rate limit exceeded. Please wait and try again.",
        )

    all_files: list[UploadFile] = []
    if files:
        all_files.extend(files)
    if file:
        all_files.append(file)
    if not all_files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No files provided. Use 'files' or 'file' form field.",
        )

    results = []
    for upload_file_obj in all_files:
        result = await _process_single_upload(upload_file_obj, db, client_ip)
        results.append(result)

    # If only one file was uploaded, return single result for backward compat
    if len(results) == 1:
        if "error" in results[0]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=results[0]["error"],
            )
        return results[0]

    return results


# ---------------------------------------------------------------------------
# GET /api/files — list experiments with pagination
# ---------------------------------------------------------------------------
@router.get("/api/files", response_model=ExperimentListResponse)
def list_experiments(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sample_name: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List all uploaded experiments with pagination and optional filtering."""
    query = db.query(Experiment)

    if sample_name:
        query = query.filter(Experiment.sample_name.ilike(f"%{sample_name}%"))

    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from)
            query = query.filter(Experiment.created_at >= dt_from)
        except ValueError:
            pass

    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to)
            query = query.filter(Experiment.created_at <= dt_to)
        except ValueError:
            pass

    total = query.count()
    pages = max(1, (total + limit - 1) // limit)
    offset = (page - 1) * limit
    experiments = query.order_by(desc(Experiment.created_at)).offset(offset).limit(limit).all()

    return ExperimentListResponse(
        experiments=[ExperimentMetadata.model_validate(e) for e in experiments],
        total=total,
        page=page,
        limit=limit,
        pages=pages,
    )


# ---------------------------------------------------------------------------
# GET /api/files/{id}
# ---------------------------------------------------------------------------
@router.get("/api/files/{experiment_id}", response_model=ExperimentResponse)
def get_experiment(experiment_id: int, db: Session = Depends(get_db)):
    """Get full experiment metadata including all JSON configs."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )

    # Parse JSON fields for the response
    def _parse_json(s: str | None) -> any:
        if s is None:
            return None
        try:
            return json.loads(s)
        except (json.JSONDecodeError, TypeError):
            return s

    # Fetch peaks for this experiment
    peaks = db.query(Peak).filter(Peak.experiment_id == experiment_id).all()

    resp = ExperimentResponse(
        id=experiment.id,
        file_name=experiment.file_name,
        original_path=experiment.original_path,
        file_size=experiment.file_size,
        file_hash=experiment.file_hash,
        sample_name=experiment.sample_name,
        solvent_name=experiment.solvent_name,
        solvent_description=experiment.solvent_description,
        operator_name=experiment.operator_name,
        collection_time=experiment.collection_time,
        processing_time=experiment.processing_time,
        astra_version=experiment.astra_version,
        mals_config=_parse_json(experiment.mals_config),
        ri_config=_parse_json(experiment.ri_config),
        uv_config=_parse_json(experiment.uv_config),
        viscometer_config=_parse_json(experiment.viscometer_config),
        sample_config=_parse_json(experiment.sample_config),
        fluid_path=_parse_json(experiment.fluid_path),
        peaks=[PeakResponse.model_validate(p) for p in peaks],
        raw_data_path=experiment.raw_data_path,
        created_by=experiment.created_by,
        created_at=experiment.created_at,
        updated_at=experiment.updated_at,
        version=experiment.version,
    )
    return resp


# ---------------------------------------------------------------------------
# DELETE /api/files/{id}
# ---------------------------------------------------------------------------
@router.delete("/api/files/{experiment_id}")
def delete_experiment(experiment_id: int, db: Session = Depends(get_db)):
    """Delete an experiment and its associated raw data file."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )

    # Delete raw data file
    if experiment.raw_data_path and os.path.exists(experiment.raw_data_path):
        os.unlink(experiment.raw_data_path)

    # BatchJob rows reference experiments via source_experiment_id but have no
    # ON DELETE CASCADE and are not covered by an ORM relationship cascade, so
    # a lingering batch job would raise a FOREIGN KEY constraint failure on the
    # DELETE below.  Detach any such references before deleting the experiment.
    batch_jobs = (
        db.query(BatchJob)
        .filter(BatchJob.source_experiment_id == experiment_id)
        .all()
    )
    for job in batch_jobs:
        job.source_experiment_id = None
    if batch_jobs:
        db.flush()

    db.delete(experiment)
    db.commit()

    return {"message": f"Experiment {experiment_id} deleted"}


# ---------------------------------------------------------------------------
# POST /api/files/{id}/export
# ---------------------------------------------------------------------------
def _build_results_dicts(db: Session, experiment_id: int) -> list[dict]:
    """Build per-peak results dicts from the Peak model's computed columns."""
    peaks = db.query(Peak).filter(Peak.experiment_id == experiment_id).all()
    results = []
    for p in peaks:
        if p.range_number is None:
            continue
        has_any = any(
            v is not None
            for v in [p.mn, p.mw, p.mz, p.polydispersity, p.rms_radius, p.peak_area, p.recovery]
        )
        if not has_any:
            continue
        results.append({
            "peak": p.range_number,
            "mn": p.mn,
            "mw": p.mw,
            "mz": p.mz,
            "polydispersity": p.polydispersity,
            "rms_radius": p.rms_radius,
            "peak_area": p.peak_area,
            "recovery": p.recovery,
        })
    return results


def _build_procedure_dicts(db: Session, experiment_id: int) -> list[dict]:
    """Build procedure dicts from ProcedureState rows."""
    procs = db.query(ProcedureState).filter(
        ProcedureState.experiment_id == experiment_id
    ).all()
    results = []
    for proc in procs:
        params = {}
        if proc.parameters:
            try:
                params = json.loads(proc.parameters)
            except (json.JSONDecodeError, TypeError):
                params = {}
        results.append({
            "procedure_name": proc.procedure_name,
            "has_been_run": proc.has_been_run,
            "is_enabled": proc.is_enabled,
            "parameters": params,
        })
    return results


@router.post("/api/files/{experiment_id}/export")
def export_experiment(
    experiment_id: int,
    options: ExportOptions | None = None,
    db: Session = Depends(get_db),
):
    """Export a modified .afe8 file with our DB-stored baselines, peaks,
    computed results, and procedure parameters written back."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )
    if not experiment.raw_data_path or not os.path.exists(experiment.raw_data_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Raw data file not found for this experiment",
        )

    opts = options or ExportOptions()

    baseline_rows = db.query(Baseline).filter(Baseline.experiment_id == experiment_id).all()
    peak_rows = db.query(Peak).filter(Peak.experiment_id == experiment_id).all()

    baselines_dicts = [
        {
            "detector_name": b.detector_name,
            "baseline_type": b.baseline_type,
            "x1": b.x1,
            "x2": b.x2,
            "y1": b.y1,
            "y2": b.y2,
            "slope": b.slope,
            "intercept": b.intercept,
            "std_dev": b.std_dev,
        }
        for b in baseline_rows
    ] if opts.include_baselines else []

    peaks_dicts = [
        {
            "range_number": p.range_number,
            "range_name": p.range_name,
            "range_start": p.range_start,
            "range_end": p.range_end,
            "dn_dc": p.dn_dc,
            "uv_extinction": p.uv_extinction,
            "concentration": p.concentration,
            "injected_mass": p.injected_mass,
            "real_ri": p.real_ri,
            "ls_model": p.ls_model,
            "ls_fit_degree": p.ls_fit_degree,
            "radius_type": p.radius_type,
            "a2": p.a2,
        }
        for p in peak_rows
    ] if opts.include_peaks else []

    results_dicts = _build_results_dicts(db, experiment_id) if opts.include_results else []
    procedure_dicts = _build_procedure_dicts(db, experiment_id) if opts.include_procedures else []

    exports_dir = os.path.join(settings.UPLOAD_DIR, "exports")
    os.makedirs(exports_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    output_filename = f"{experiment_id}_{timestamp}.afe8"
    output_path = os.path.join(exports_dir, output_filename)

    result = export_afe8(
        source_path=experiment.raw_data_path,
        dest_path=output_path,
        baselines=baselines_dicts,
        peaks=peaks_dicts,
        results=results_dicts,
        procedures=procedure_dicts,
    )

    audit_log = AuditLog(
        experiment_id=experiment_id,
        user_id=None,
        action="EXPORT",
        entity_type="experiment",
        entity_id=experiment_id,
        changes=json.dumps({
            "path": result["path"],
            "baselines_written": result["baselines_written"],
            "peaks_written": result["peaks_written"],
            "results_written": result.get("results_written", 0),
            "procedures_written": result.get("procedures_written", 0),
            "warnings": result["warnings"],
        }, default=str),
    )
    db.add(audit_log)
    db.commit()

    download_name = experiment.file_name or f"experiment_{experiment_id}.afe8"
    if not download_name.lower().endswith(".afe8"):
        download_name = download_name + ".afe8"

    return FileResponse(
        path=output_path,
        media_type="application/gzip",
        filename=download_name,
    )


# ---------------------------------------------------------------------------
# POST /api/files/{id}/save-as
# ---------------------------------------------------------------------------
@router.post("/api/files/{experiment_id}/save-as")
def save_as_experiment(
    experiment_id: int,
    body: SaveAsRequest | None = None,
    db: Session = Depends(get_db),
):
    """Save a copy of the experiment as a new .afe8 file with modifications.

    Returns the modified .afe8 as a downloadable file, just like the export
    endpoint, but allows specifying a custom file name and export options.
    """
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )
    if not experiment.raw_data_path or not os.path.exists(experiment.raw_data_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Raw data file not found for this experiment",
        )

    opts = (body.options if body and body.options else None) or ExportOptions()

    baseline_rows = db.query(Baseline).filter(Baseline.experiment_id == experiment_id).all()
    peak_rows = db.query(Peak).filter(Peak.experiment_id == experiment_id).all()

    baselines_dicts = [
        {
            "detector_name": b.detector_name,
            "baseline_type": b.baseline_type,
            "x1": b.x1,
            "x2": b.x2,
            "y1": b.y1,
            "y2": b.y2,
            "slope": b.slope,
            "intercept": b.intercept,
            "std_dev": b.std_dev,
        }
        for b in baseline_rows
    ] if opts.include_baselines else []

    peaks_dicts = [
        {
            "range_number": p.range_number,
            "range_name": p.range_name,
            "range_start": p.range_start,
            "range_end": p.range_end,
            "dn_dc": p.dn_dc,
            "uv_extinction": p.uv_extinction,
            "concentration": p.concentration,
            "injected_mass": p.injected_mass,
            "real_ri": p.real_ri,
            "ls_model": p.ls_model,
            "ls_fit_degree": p.ls_fit_degree,
            "radius_type": p.radius_type,
            "a2": p.a2,
        }
        for p in peak_rows
    ] if opts.include_peaks else []

    results_dicts = _build_results_dicts(db, experiment_id) if opts.include_results else []
    procedure_dicts = _build_procedure_dicts(db, experiment_id) if opts.include_procedures else []

    exports_dir = os.path.join(settings.UPLOAD_DIR, "exports")
    os.makedirs(exports_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    output_filename = f"{experiment_id}_saveas_{timestamp}.afe8"
    output_path = os.path.join(exports_dir, output_filename)

    result = export_afe8(
        source_path=experiment.raw_data_path,
        dest_path=output_path,
        baselines=baselines_dicts,
        peaks=peaks_dicts,
        results=results_dicts,
        procedures=procedure_dicts,
    )

    audit_log = AuditLog(
        experiment_id=experiment_id,
        user_id=None,
        action="SAVE_AS",
        entity_type="experiment",
        entity_id=experiment_id,
        changes=json.dumps({
            "path": result["path"],
            "baselines_written": result["baselines_written"],
            "peaks_written": result["peaks_written"],
            "results_written": result.get("results_written", 0),
            "procedures_written": result.get("procedures_written", 0),
            "warnings": result["warnings"],
        }, default=str),
    )
    db.add(audit_log)
    db.commit()

    if body and body.new_file_name:
        download_name = body.new_file_name
        if not download_name.lower().endswith(".afe8"):
            download_name = download_name + ".afe8"
    else:
        base = experiment.file_name or f"experiment_{experiment_id}"
        base = base.replace(".afe8", "").replace(".AFE8", "")
        download_name = f"{base}_copy.afe8"

    return FileResponse(
        path=output_path,
        media_type="application/gzip",
        filename=download_name,
    )
