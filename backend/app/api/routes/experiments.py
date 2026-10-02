"""Experiment metadata routes — instrument config, solvent, sample, fluid path."""

import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Experiment

router = APIRouter(tags=["experiments"])


class SampleUpdate(BaseModel):
    """Editable sample parameters (all optional; only provided keys change)."""
    dn_dc: float | None = None
    concentration: float | None = None
    a2: float | None = None
    real_ri: float | None = None
    # Per-detector display processing: inter-detector alignment (time shift, in
    # minutes) and band-broadening (Gaussian sigma, in minutes).  Shape:
    #   {"RI": {"shift": 0.0, "broaden": 0.0}, "UV": {...}, "MALS": {...}}
    processing: dict | None = None


def _get_experiment_or_404(experiment_id: int, db: Session) -> Experiment:
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )
    return experiment


def _safe_json(s: str | None):
    """Parse a JSON string, returning None on failure."""
    if s is None:
        return None
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return s


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/instruments
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/instruments")
def get_instruments(experiment_id: int, db: Session = Depends(get_db)):
    """Return instrument configuration (MALS, RI, UV, viscometer) as JSON."""
    experiment = _get_experiment_or_404(experiment_id, db)
    return {
        "mals": _safe_json(experiment.mals_config),
        "ri": _safe_json(experiment.ri_config),
        "uv": _safe_json(experiment.uv_config),
        "viscometer": _safe_json(experiment.viscometer_config),
    }


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/solvent
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/solvent")
def get_solvent(experiment_id: int, db: Session = Depends(get_db)):
    """Return solvent info."""
    experiment = _get_experiment_or_404(experiment_id, db)
    return {
        "name": experiment.solvent_name,
        "description": experiment.solvent_description,
    }


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/sample
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/sample")
def get_sample(experiment_id: int, db: Session = Depends(get_db)):
    """Return sample info (dn/dc, concentration, etc.)."""
    experiment = _get_experiment_or_404(experiment_id, db)
    return {
        "sample_name": experiment.sample_name,
        "sample_config": _safe_json(experiment.sample_config),
    }


# ---------------------------------------------------------------------------
# PATCH /api/experiments/{id}/sample
# ---------------------------------------------------------------------------
@router.patch("/api/experiments/{experiment_id}/sample")
def update_sample(
    experiment_id: int,
    body: SampleUpdate,
    db: Session = Depends(get_db),
):
    """Update editable sample parameters (dn/dc, concentration, A2, real RI).

    Merges the provided keys into the experiment's ``sample_config`` JSON;
    unspecified keys are left unchanged.
    """
    experiment = _get_experiment_or_404(experiment_id, db)
    config = _safe_json(experiment.sample_config)
    if not isinstance(config, dict):
        config = {}

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided to update",
        )
    config.update(updates)

    experiment.sample_config = json.dumps(config)
    db.commit()
    db.refresh(experiment)
    return {
        "sample_name": experiment.sample_name,
        "sample_config": _safe_json(experiment.sample_config),
    }


# ---------------------------------------------------------------------------
# GET /api/experiments/{id}/fluid-path
# ---------------------------------------------------------------------------
@router.get("/api/experiments/{experiment_id}/fluid-path")
def get_fluid_path(experiment_id: int, db: Session = Depends(get_db)):
    """Return fluid connection chain (instrument flow path)."""
    experiment = _get_experiment_or_404(experiment_id, db)
    return {
        "fluid_path": _safe_json(experiment.fluid_path) or [],
    }
