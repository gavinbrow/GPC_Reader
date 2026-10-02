"""Batch processor — one-to-many settings propagation.

Copies analysis settings (baselines, peaks, procedure parameters, peak
parameters) from a source experiment to one or more target experiments,
then optionally runs analysis on each target.

See ``architecture.md`` §2.5.1 (One-to-Many Processing) and §5.9 (Batch
Processing endpoints).

Supported ``settings_to_propagate`` values:
  - ``baselines``      — copy all baseline rows from source to targets
  - ``peaks``           — copy peak ranges (start/end, range_number, range_name)
  - ``peak_params``     — copy per-peak parameters (dn/dc, ls_model, etc.)
  - ``procedures``      — copy procedure_states rows (enabled flags + params)
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Optional

from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    Baseline,
    Experiment,
    Peak,
    ProcedureState,
)

logger = logging.getLogger(__name__)

VALID_SETTINGS = {"baselines", "peaks", "peak_params", "procedures"}


def _audit(db: Session, experiment_id: int, action: str, entity_id: int | None, changes: dict):
    log = AuditLog(
        experiment_id=experiment_id,
        user_id=None,
        action=action,
        entity_type="batch",
        entity_id=entity_id,
        changes=json.dumps(changes, default=str),
    )
    db.add(log)


def _propagate_baselines(
    db: Session,
    source_experiment_id: int,
    target_experiment_id: int,
) -> int:
    """Copy all baselines from source to target, replacing existing ones.

    Returns the number of baselines copied.
    """
    source_baselines = db.query(Baseline).filter(
        Baseline.experiment_id == source_experiment_id,
    ).all()

    db.query(Baseline).filter(
        Baseline.experiment_id == target_experiment_id,
    ).delete()
    db.flush()

    count = 0
    for sb in source_baselines:
        nb = Baseline(
            experiment_id=target_experiment_id,
            detector_name=sb.detector_name,
            detector_class=sb.detector_class,
            baseline_type=sb.baseline_type,
            x1=sb.x1,
            x2=sb.x2,
            y1=sb.y1,
            y2=sb.y2,
            slope=sb.slope,
            intercept=sb.intercept,
            std_dev=sb.std_dev,
            is_auto=sb.is_auto,
            version=1,
        )
        db.add(nb)
        count += 1

    _audit(db, target_experiment_id, "BATCH_COPY", None, {
        "action": "propagate_baselines",
        "source_experiment_id": source_experiment_id,
        "count": count,
    })
    return count


def _propagate_peaks(
    db: Session,
    source_experiment_id: int,
    target_experiment_id: int,
) -> int:
    """Copy peak ranges (start/end, range_number, range_name) from source to target.

    Replaces all existing peaks on the target.  Returns the number copied.
    """
    source_peaks = db.query(Peak).filter(
        Peak.experiment_id == source_experiment_id,
    ).order_by(Peak.range_number).all()

    db.query(Peak).filter(
        Peak.experiment_id == target_experiment_id,
    ).delete()
    db.flush()

    count = 0
    for sp in source_peaks:
        np_ = Peak(
            experiment_id=target_experiment_id,
            range_number=sp.range_number,
            range_name=sp.range_name,
            range_start=sp.range_start,
            range_end=sp.range_end,
            range_type=sp.range_type,
            is_auto=sp.is_auto,
            version=1,
        )
        db.add(np_)
        count += 1

    _audit(db, target_experiment_id, "BATCH_COPY", None, {
        "action": "propagate_peaks",
        "source_experiment_id": source_experiment_id,
        "count": count,
    })
    return count


def _propagate_peak_params(
    db: Session,
    source_experiment_id: int,
    target_experiment_id: int,
) -> int:
    """Copy per-peak parameters (dn/dc, ls_model, etc.) from source peaks to target peaks.

    Matches peaks by ``range_number``.  Does NOT replace peak ranges — only
    updates the parameter fields.  Returns the number of peaks updated.
    """
    source_peaks = {
        p.range_number: p for p in db.query(Peak).filter(
            Peak.experiment_id == source_experiment_id,
        ).all()
    }
    target_peaks = db.query(Peak).filter(
        Peak.experiment_id == target_experiment_id,
    ).all()

    count = 0
    for tp in target_peaks:
        sp = source_peaks.get(tp.range_number)
        if sp is None:
            continue
        tp.dn_dc = sp.dn_dc
        tp.uv_extinction = sp.uv_extinction
        tp.concentration = sp.concentration
        tp.injected_mass = sp.injected_mass
        tp.real_ri = sp.real_ri
        tp.ls_model = sp.ls_model
        tp.ls_fit_degree = sp.ls_fit_degree
        tp.radius_type = sp.radius_type
        tp.a2 = sp.a2
        tp.version = tp.version + 1
        count += 1

    _audit(db, target_experiment_id, "BATCH_COPY", None, {
        "action": "propagate_peak_params",
        "source_experiment_id": source_experiment_id,
        "count": count,
    })
    return count


def _propagate_procedures(
    db: Session,
    source_experiment_id: int,
    target_experiment_id: int,
) -> int:
    """Copy procedure_states (enabled flags + params) from source to target.

    Returns the number of procedure states updated.
    """
    source_states = {
        ps.procedure_name: ps for ps in db.query(ProcedureState).filter(
            ProcedureState.experiment_id == source_experiment_id,
        ).all()
    }
    target_states = db.query(ProcedureState).filter(
        ProcedureState.experiment_id == target_experiment_id,
    ).all()

    count = 0
    for ts in target_states:
        ss = source_states.get(ts.procedure_name)
        if ss is None:
            continue
        ts.is_enabled = ss.is_enabled
        ts.parameters = ss.parameters
        ts.version = ts.version + 1
        count += 1

    for name, ss in source_states.items():
        existing = db.query(ProcedureState).filter(
            ProcedureState.experiment_id == target_experiment_id,
            ProcedureState.procedure_name == name,
        ).first()
        if existing is None:
            ns = ProcedureState(
                experiment_id=target_experiment_id,
                procedure_name=name,
                procedure_order=ss.procedure_order,
                is_enabled=ss.is_enabled,
                has_been_run=False,
                parameters=ss.parameters,
                version=1,
            )
            db.add(ns)
            count += 1

    _audit(db, target_experiment_id, "BATCH_COPY", None, {
        "action": "propagate_procedures",
        "source_experiment_id": source_experiment_id,
        "count": count,
    })
    return count


def apply_settings_to_target(
    db: Session,
    source_experiment_id: int,
    target_experiment_id: int,
    settings_to_propagate: list[str],
) -> dict:
    """Apply a set of settings from source experiment to target experiment.

    Returns a summary dict with counts per setting type.
    """
    invalid = [s for s in settings_to_propagate if s not in VALID_SETTINGS]
    if invalid:
        raise ValueError(f"Unknown settings: {invalid}. Valid: {VALID_SETTINGS}")

    target = db.query(Experiment).filter(Experiment.id == target_experiment_id).first()
    if target is None:
        raise ValueError(f"Target experiment {target_experiment_id} not found")

    summary: dict[str, int] = {}
    for setting in settings_to_propagate:
        if setting == "baselines":
            summary["baselines"] = _propagate_baselines(db, source_experiment_id, target_experiment_id)
        elif setting == "peaks":
            summary["peaks"] = _propagate_peaks(db, source_experiment_id, target_experiment_id)
        elif setting == "peak_params":
            summary["peak_params"] = _propagate_peak_params(db, source_experiment_id, target_experiment_id)
        elif setting == "procedures":
            summary["procedures"] = _propagate_procedures(db, source_experiment_id, target_experiment_id)

    db.commit()
    return summary


def run_batch(
    db: Session,
    source_experiment_id: int,
    target_experiment_ids: list[int],
    settings_to_propagate: list[str],
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
) -> list[dict]:
    """Run the full batch propagation across all targets.

    Parameters
    ----------
    db : Session
        Database session.
    source_experiment_id : int
        Source experiment to copy settings from.
    target_experiment_ids : list[int]
        Target experiments to apply settings to.
    settings_to_propagate : list[str]
        Which settings to copy (subset of VALID_SETTINGS).
    progress_callback : callable, optional
        Called as ``progress_callback(current, total, message)``.

    Returns
    -------
    list[dict]
        Per-target result: ``{"experiment_id": int, "status": str, "summary": dict}``
    """
    total = len(target_experiment_ids)
    results: list[dict] = []
    for i, target_id in enumerate(target_experiment_ids):
        try:
            if progress_callback:
                progress_callback(i, total, f"Applying settings to experiment {target_id}")
            summary = apply_settings_to_target(
                db, source_experiment_id, target_id, settings_to_propagate,
            )
            results.append({
                "experiment_id": target_id,
                "status": "completed",
                "summary": summary,
            })
        except Exception as e:
            logger.exception("Batch apply failed for experiment %s", target_id)
            results.append({
                "experiment_id": target_id,
                "status": "failed",
                "error": str(e),
            })

    if progress_callback:
        progress_callback(total, total, "Batch complete")
    return results
