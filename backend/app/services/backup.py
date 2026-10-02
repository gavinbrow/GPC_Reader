"""Database backup and integrity management.

Provides:

- **Startup integrity check**: ``PRAGMA integrity_check`` on the SQLite database.
  If the check fails, the application should halt ( the caller is responsible
  for that decision ).

- **Nightly VACUUM INTO backup**: creates a consistent snapshot of the SQLite
  database using ``VACUUM INTO 'path'``.  Backups are stored in
  ``data/backups/`` with a date-stamped filename.  Retention is 30 days;
  older backups are automatically deleted.

- **Backup listing**: returns metadata about available backup files.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.config import settings

logger = logging.getLogger(__name__)

BACKUP_RETENTION_DAYS = 30
_backup_dir: Optional[Path] = None


def _get_backup_dir() -> Path:
    global _backup_dir
    if _backup_dir is not None:
        return _backup_dir
    data_path = Path(settings.DATABASE_PATH).parent
    backup_dir = data_path / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    _backup_dir = backup_dir
    return backup_dir


def check_integrity(engine: Engine) -> tuple[bool, str]:
    """Run PRAGMA integrity_check on the database.

    Returns
    -------
    (bool, str)
        (True, "ok") if the database is healthy, (False, error_message) otherwise.
    """
    try:
        with engine.connect() as conn:
            result = conn.execute(text("PRAGMA integrity_check"))
            row = result.fetchone()
            if row is not None:
                msg = str(row[0])
                return (msg == "ok", msg)
            return (False, "integrity_check returned no result")
    except Exception as e:
        return (False, f"integrity_check failed: {e}")


def create_backup(engine: Engine) -> dict:
    """Create a VACUUM INTO backup of the database.

    Returns
    -------
    dict
        ``{"path": str, "size_bytes": int, "created_at": str}`` on success,
        ``{"error": str}`` on failure.
    """
    backup_dir = _get_backup_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"astra_backup_{timestamp}.sqlite"

    try:
        if backup_path.exists():
            backup_path.unlink()
        safe_path = str(backup_path).replace("'", "''")
        with engine.connect() as conn:
            conn.execute(text(f"VACUUM INTO '{safe_path}'"))
            conn.commit()
        size = backup_path.stat().st_size if backup_path.exists() else 0
        logger.info("Database backup created: %s (%d bytes)", backup_path, size)
        return {"path": str(backup_path), "size_bytes": size,
                "created_at": timestamp}
    except Exception as e:
        logger.error("Database backup failed: %s", e)
        return {"error": str(e)}


def cleanup_old_backups(retention_days: int = BACKUP_RETENTION_DAYS) -> int:
    """Delete backup files older than the retention period.

    Returns the number of files deleted.
    """
    backup_dir = _get_backup_dir()
    cutoff = datetime.now() - timedelta(days=retention_days)
    count = 0
    for f in backup_dir.glob("astra_backup_*.sqlite"):
        try:
            file_time = datetime.fromtimestamp(f.stat().st_mtime)
            if file_time < cutoff:
                f.unlink()
                count += 1
                logger.info("Deleted old backup: %s", f.name)
        except Exception as e:
            logger.warning("Failed to delete old backup %s: %s", f, e)
    return count


def list_backups() -> list[dict]:
    """List all available backup files with metadata."""
    backup_dir = _get_backup_dir()
    backups: list[dict] = []
    for f in sorted(backup_dir.glob("astra_backup_*.sqlite"), reverse=True):
        try:
            stat = f.stat()
            backups.append({
                "filename": f.name,
                "path": str(f),
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        except Exception:
            pass
    return backups


def get_latest_backup() -> Optional[dict]:
    """Return metadata for the most recent backup, or None if no backups exist."""
    backups = list_backups()
    return backups[0] if backups else None
