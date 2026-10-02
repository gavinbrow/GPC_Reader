"""Database backup and integrity routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status

from app.db.session import engine
from app.services.backup import (
    check_integrity,
    cleanup_old_backups,
    create_backup,
    list_backups,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health/db")
def db_integrity_check():
    """Run PRAGMA integrity_check on the database."""
    ok, msg = check_integrity(engine)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database integrity check failed: {msg}",
        )
    return {"status": "ok", "message": msg}


@router.post("/backup")
def trigger_backup():
    """Trigger a VACUUM INTO backup of the database."""
    result = create_backup(engine)
    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result["error"],
        )
    cleanup_old_backups()
    return result


@router.get("/backups")
def get_backups():
    """List all available database backup files."""
    backups = list_backups()
    return {"backups": backups, "total": len(backups)}


@router.delete("/backups/cleanup")
def cleanup_backups(retention_days: int = 30):
    """Delete backup files older than the retention period."""
    if retention_days < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="retention_days must be >= 1",
        )
    deleted = cleanup_old_backups(retention_days)
    return {"deleted_count": deleted}
