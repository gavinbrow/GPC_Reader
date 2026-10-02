"""EASI table routes — multi-run comparison table.

Endpoints:
  POST   /api/easi-table          — create an EASI table from multiple experiments
  GET    /api/easi-table/{id}      — get EASI table data
  GET    /api/easi-table          — list all EASI tables
  GET    /api/easi-table/{id}/export — export EASI table as CSV
  DELETE /api/easi-table/{id}      — delete an EASI table
"""

from __future__ import annotations

import csv
import io
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import EasiTable, Experiment, Peak
from app.schemas import (
    EasiTableCreateRequest,
    EasiTableListResponse,
    EasiTableResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["easi"])

_DEFAULT_COLUMNS = [
    "sample_name",
    "Mn",
    "Mw",
    "Mz",
    "Pd",
    "Rg_nm",
    "peak_area",
]


def _build_table_data(
    db: Session,
    experiment_ids: list[int],
    column_config: list[str] | None = None,
) -> tuple[list[str], list[dict]]:
    """Build the EASI table rows from experiment + peak results data.

    Returns (columns, rows) where each row is a dict keyed by column name.
    """
    columns = column_config or _DEFAULT_COLUMNS
    rows: list[dict] = []

    for exp_id in experiment_ids:
        exp = db.query(Experiment).filter(Experiment.id == exp_id).first()
        if exp is None:
            rows.append({"experiment_id": exp_id, "sample_name": "—", "error": "not found"})
            continue

        peaks = db.query(Peak).filter(
            Peak.experiment_id == exp_id,
        ).order_by(Peak.range_number).all()

        if not peaks:
            row = {"experiment_id": exp_id, "sample_name": exp.sample_name or "—"}
            for col in columns:
                if col not in ("sample_name", "experiment_id"):
                    row[col] = None
            rows.append(row)
            continue

        for peak in peaks:
            row: dict = {
                "experiment_id": exp_id,
                "sample_name": exp.sample_name or "—",
                "peak_number": peak.range_number,
                "Mn": peak.mn,
                "Mw": peak.mw,
                "Mz": peak.mz,
                "Pd": peak.polydispersity,
                "Rg_nm": peak.rms_radius,
                "peak_area": peak.peak_area,
                "recovery": peak.recovery,
            }
            rows.append(row)

    return columns, rows


def _to_response(et: EasiTable, db: Session) -> EasiTableResponse:
    exp_ids: list[int] = []
    if et.experiment_ids:
        try:
            exp_ids = json.loads(et.experiment_ids)
        except (json.JSONDecodeError, TypeError):
            pass

    col_config: list[str] | None = None
    if et.column_config:
        try:
            parsed = json.loads(et.column_config)
            if isinstance(parsed, list):
                col_config = parsed
        except (json.JSONDecodeError, TypeError):
            pass

    columns, rows = _build_table_data(db, exp_ids, col_config)

    return EasiTableResponse(
        id=et.id,
        name=et.name or "",
        experiment_ids=exp_ids,
        columns=columns,
        rows=rows,
        created_at=et.created_at,
    )


@router.post("/api/easi-table", response_model=EasiTableResponse, status_code=status.HTTP_201_CREATED)
def create_easi_table(body: EasiTableCreateRequest, db: Session = Depends(get_db)):
    """Create an EASI table from multiple experiments."""
    for exp_id in body.experiment_ids:
        exp = db.query(Experiment).filter(Experiment.id == exp_id).first()
        if exp is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Experiment {exp_id} not found",
            )

    col_config_json = json.dumps(body.column_config) if body.column_config else None
    et = EasiTable(
        name=body.name,
        experiment_ids=json.dumps(body.experiment_ids),
        column_config=col_config_json,
    )
    db.add(et)
    db.commit()
    db.refresh(et)
    return _to_response(et, db)


@router.get("/api/easi-table/{easi_id}", response_model=EasiTableResponse)
def get_easi_table(easi_id: int, db: Session = Depends(get_db)):
    """Get an EASI table by ID."""
    et = db.query(EasiTable).filter(EasiTable.id == easi_id).first()
    if et is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"EASI table {easi_id} not found")
    return _to_response(et, db)


@router.get("/api/easi-table", response_model=EasiTableListResponse)
def list_easi_tables(db: Session = Depends(get_db)):
    """List all EASI tables."""
    tables = db.query(EasiTable).order_by(EasiTable.id).all()
    return EasiTableListResponse(
        tables=[_to_response(t, db) for t in tables],
        total=len(tables),
    )


@router.get("/api/easi-table/{easi_id}/export")
def export_easi_table(easi_id: int, db: Session = Depends(get_db)):
    """Export an EASI table as CSV (streaming download)."""
    et = db.query(EasiTable).filter(EasiTable.id == easi_id).first()
    if et is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"EASI table {easi_id} not found")

    resp = _to_response(et, db)

    buf = io.StringIO()
    writer = csv.writer(buf)
    all_keys: list[str] = []
    for row in resp.rows:
        for k in row:
            if k not in all_keys:
                all_keys.append(k)
    writer.writerow(all_keys)
    for row in resp.rows:
        writer.writerow([row.get(k, "") for k in all_keys])

    csv_bytes = buf.getvalue().encode("utf-8")
    buf.close()

    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=easi_table_{easi_id}.csv"},
    )


@router.delete("/api/easi-table/{easi_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_easi_table(easi_id: int, db: Session = Depends(get_db)):
    """Delete an EASI table."""
    et = db.query(EasiTable).filter(EasiTable.id == easi_id).first()
    if et is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"EASI table {easi_id} not found")
    db.delete(et)
    db.commit()
