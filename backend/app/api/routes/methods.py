"""Method template routes — CRUD for reusable analysis method templates.

Endpoints:
  GET    /api/methods               — list method templates (public + owned)
  POST   /api/methods               — create a method template
  GET    /api/methods/{id}          — get a single method template
  PUT    /api/methods/{id}          — update a method template
  DELETE /api/methods/{id}         — delete a method template
  POST   /api/experiments/{id}/methods/{method_id}/apply — apply method to experiment
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import AuditLog, Experiment, MethodTemplate
from app.schemas import (
    MethodTemplateCreate,
    MethodTemplateListResponse,
    MethodTemplateResponse,
    MethodTemplateUpdate,
)
from app.services.batch_processor import apply_settings_to_target

logger = logging.getLogger(__name__)

router = APIRouter(tags=["methods"])


def _to_response(m: MethodTemplate) -> MethodTemplateResponse:
    return MethodTemplateResponse(
        id=m.id,
        name=m.name or "",
        description=m.description,
        template=m.template,
        is_public=m.is_public,
        shared_with=m.shared_with,
        created_by=m.created_by,
        created_at=m.created_at,
    )


@router.get("/api/methods", response_model=MethodTemplateListResponse)
def list_methods(db: Session = Depends(get_db)):
    """List all method templates (public + owned)."""
    methods = db.query(MethodTemplate).order_by(MethodTemplate.id).all()
    return MethodTemplateListResponse(
        methods=[_to_response(m) for m in methods],
        total=len(methods),
    )


@router.post("/api/methods", response_model=MethodTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_method(body: MethodTemplateCreate, db: Session = Depends(get_db)):
    """Create a new method template."""
    method = MethodTemplate(
        name=body.name,
        description=body.description,
        template=body.template,
        is_public=body.is_public,
    )
    db.add(method)
    db.commit()
    db.refresh(method)
    return _to_response(method)


@router.get("/api/methods/{method_id}", response_model=MethodTemplateResponse)
def get_method(method_id: int, db: Session = Depends(get_db)):
    """Get a single method template."""
    method = db.query(MethodTemplate).filter(MethodTemplate.id == method_id).first()
    if method is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Method {method_id} not found")
    return _to_response(method)


@router.put("/api/methods/{method_id}", response_model=MethodTemplateResponse)
def update_method(method_id: int, body: MethodTemplateUpdate, db: Session = Depends(get_db)):
    """Update an existing method template."""
    method = db.query(MethodTemplate).filter(MethodTemplate.id == method_id).first()
    if method is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Method {method_id} not found")
    if body.name is not None:
        method.name = body.name
    if body.description is not None:
        method.description = body.description
    if body.template is not None:
        method.template = body.template
    if body.is_public is not None:
        method.is_public = body.is_public
    db.commit()
    db.refresh(method)
    return _to_response(method)


@router.delete("/api/methods/{method_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_method(method_id: int, db: Session = Depends(get_db)):
    """Delete a method template."""
    method = db.query(MethodTemplate).filter(MethodTemplate.id == method_id).first()
    if method is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Method {method_id} not found")
    db.delete(method)
    db.commit()


@router.post("/api/experiments/{experiment_id}/methods/{method_id}/apply")
def apply_method(experiment_id: int, method_id: int, db: Session = Depends(get_db)):
    """Apply a method template to an experiment.

    The method template's ``template`` JSON should contain:
    ``{"source_experiment_id": int, "settings_to_propagate": [...]}``
    """
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Experiment {experiment_id} not found")

    method = db.query(MethodTemplate).filter(MethodTemplate.id == method_id).first()
    if method is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Method {method_id} not found")

    if not method.template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Method template has no template data")

    try:
        config = json.loads(method.template)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Method template JSON is invalid")

    source_id = config.get("source_experiment_id")
    settings = config.get("settings_to_propagate", [])
    if not source_id or not settings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Method template must contain source_experiment_id and settings_to_propagate",
        )

    source = db.query(Experiment).filter(Experiment.id == source_id).first()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Source experiment {source_id} not found")

    summary = apply_settings_to_target(db, source_id, experiment_id, settings)

    log = AuditLog(
        experiment_id=experiment_id,
        user_id=None,
        action="APPLY_METHOD",
        entity_type="method",
        entity_id=method_id,
        changes=json.dumps({"method_id": method_id, "source_experiment_id": source_id, "summary": summary}),
    )
    db.add(log)
    db.commit()

    return {
        "message": f"Method '{method.name}' applied to experiment {experiment_id}",
        "summary": summary,
    }
