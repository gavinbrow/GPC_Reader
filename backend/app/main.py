"""FastAPI application entry point for Astra Reader backend."""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db.session import init_db
from app.schemas import ErrorResponse, HealthCheckResponse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Create the FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Backend API for the Astra Reader web application.",
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Custom exception handler for standard error responses
# ---------------------------------------------------------------------------
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Return a standard error response for unhandled exceptions."""
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            title="Internal Server Error",
            detail=str(exc),
            status=500,
            instance=str(request.url.path),
        ).model_dump(),
    )


# ---------------------------------------------------------------------------
# Startup — create database tables
# ---------------------------------------------------------------------------
@app.on_event("startup")
def on_startup():
    """Initialize the SQLite database on application startup."""
    logger.info("Initializing database at %s", settings.DATABASE_PATH)
    init_db()
    logger.info("Database initialized successfully")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health", response_model=HealthCheckResponse)
def health_check():
    """Health check endpoint."""
    return HealthCheckResponse(
        status="ok",
        version=settings.APP_VERSION,
        database="connected",
    )


# ---------------------------------------------------------------------------
# Include routers
# ---------------------------------------------------------------------------
from app.api.routes import (  # noqa: E402
    auth,
    baselines,
    batch,
    chromatograms,
    easi_table,
    experiments,
    files,
    methods,
    peaks,
    procedures,
    progress,
    reports,
    results,
    system,
)

app.include_router(auth.router)
app.include_router(files.router)
app.include_router(chromatograms.router)
app.include_router(experiments.router)
app.include_router(baselines.router)
app.include_router(peaks.router)
app.include_router(procedures.router)
app.include_router(results.router)
app.include_router(progress.router)
app.include_router(reports.router)
app.include_router(methods.router)
app.include_router(batch.router)
app.include_router(easi_table.router)
app.include_router(system.router)
