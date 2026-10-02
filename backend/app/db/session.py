"""Database session management."""

import sqlite3
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

# Create engine with SQLite.  ``check_same_thread=False`` is needed for
# FastAPI's threadpool (each request can run in a different thread).
engine: Engine = create_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _set_sqlite_pragmas(dbapi_conn: sqlite3.Connection, _conn) -> None:
    """Enable WAL mode and foreign key enforcement on every raw connection."""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()


# Attach the pragma handler to the SQLAlchemy pool for every new connection.
event.listen(engine, "connect", _set_sqlite_pragmas)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency -- yields a database session and ensures cleanup."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables (called on application startup).

    Runs ``PRAGMA integrity_check`` after creating tables.  If the check
    fails, logs an error but does not halt — the caller ( main.py startup )
    decides whether to continue.
    """
    import app.models  # noqa: F401  (side-effect: registers models)
    from app.db.base import Base
    from app.services.backup import check_integrity

    Base.metadata.create_all(bind=engine)

    ok, msg = check_integrity(engine)
    if ok:
        import logging
        logging.getLogger(__name__).info("Database integrity check passed")
    else:
        import logging
        logging.getLogger(__name__).error("Database integrity check FAILED: %s", msg)
