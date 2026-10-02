"""WebSocket progress and asynchronous analysis runner routes."""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, get_db
from app.models import Experiment
from app.services.procedure_orchestrator import run_analysis

logger = logging.getLogger(__name__)

router = APIRouter(tags=["progress"])

_progress_queues: dict[int, asyncio.Queue] = {}


def _get_experiment_or_404(experiment_id: int, db: Session) -> Experiment:
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment {experiment_id} not found",
        )
    if not experiment.raw_data_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Raw data file path not found for this experiment",
        )
    return experiment


# ---------------------------------------------------------------------------
# WS /api/experiments/{id}/progress
# ---------------------------------------------------------------------------
@router.websocket("/api/experiments/{experiment_id}/progress")
async def progress_websocket(websocket: WebSocket, experiment_id: int):
    """Stream analysis progress messages to a connected WebSocket client.

    Message protocol (per architecture.md §5.12):
    - ``{"type": "progress", "procedure": str, "pct": float, "message": str}``
    - ``{"type": "error", "procedure": str, "message": str}``
    - ``{"type": "complete", "results_url": str}``
    """
    await websocket.accept()
    # Reuse the queue created by run-async if the analysis has already started;
    # otherwise create one so the runner (which resolves the live queue at emit
    # time) can find it.  Previously this always created a NEW queue and
    # overwrote the runner's queue, so progress/complete messages were pushed to
    # a queue nobody read — the client hung on "Analyzing…" forever.
    queue = _progress_queues.get(experiment_id)
    if queue is None:
        queue = asyncio.Queue()
        _progress_queues[experiment_id] = queue
    try:
        while True:
            msg = await queue.get()
            await websocket.send_json(msg)
            if msg.get("type") in ("complete", "error"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        _progress_queues.pop(experiment_id, None)


def _runner(experiment_id: int, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
    """Background-thread target: run analysis and push messages to the queue."""
    def emit(msg: dict) -> None:
        # Resolve the live queue at emit time: if a WebSocket connected after
        # the run started it may have registered its own queue.  Fall back to
        # the queue captured at thread start.
        q = _progress_queues.get(experiment_id, queue)
        loop.call_soon_threadsafe(q.put_nowait, msg)

    terminal = {"sent": False}

    def callback(procedure: str, pct: float, message: str) -> None:
        if procedure == "complete":
            terminal["sent"] = True
            msg = {"type": "complete", "results_url": f"/api/experiments/{experiment_id}/results"}
        else:
            msg = {"type": "progress", "procedure": procedure, "pct": pct, "message": message}
        emit(msg)

    db = SessionLocal()
    try:
        try:
            result = run_analysis(experiment_id, db, progress_callback=callback)
            # Some early-return paths (e.g. missing RI/MALS data) return without
            # ever emitting a terminal "complete"; surface that as an error so the
            # client's progress stream ends instead of hanging on "Analyzing…".
            if not terminal["sent"]:
                message = result.get("message") if isinstance(result, dict) else None
                emit({"type": "error", "procedure": "unknown",
                      "message": message or "Analysis produced no results"})
        except Exception as e:
            logger.exception("run-async analysis failed for experiment %s", experiment_id)
            emit({"type": "error", "procedure": "unknown", "message": str(e)})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/experiments/{id}/procedures/run-async
# ---------------------------------------------------------------------------
@router.post("/api/experiments/{experiment_id}/procedures/run-async", status_code=status.HTTP_202_ACCEPTED)
async def run_async(
    experiment_id: int,
    db: Session = Depends(get_db),
):
    """Start analysis in a background thread and stream progress to subscribers.

    Returns a 202 with a job_id; progress is delivered via the WebSocket
    endpoint at ``/api/experiments/{id}/progress``.
    """
    _get_experiment_or_404(experiment_id, db)
    queue = _progress_queues.get(experiment_id)
    if queue is None:
        queue = asyncio.Queue()
        _progress_queues[experiment_id] = queue
    loop = asyncio.get_running_loop()
    thread = threading.Thread(target=_runner, args=(experiment_id, loop, queue), daemon=True)
    thread.start()
    return {
        "job_id": str(uuid.uuid4()),
        "status": "started",
        "experiment_id": experiment_id,
    }
