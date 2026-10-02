"""Tests for WebSocket progress endpoint."""

import os
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestProgressRoutes:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestProgressRoutes._experiment_id is not None:
            return TestProgressRoutes._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestProgressRoutes._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestProgressRoutes._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestProgressRoutes._experiment_id

    def test_websocket_connect(self):
        """WebSocket /progress accepts and stays open, then disconnects cleanly."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            with client.websocket_connect(f"/api/experiments/{exp_id}/progress") as websocket:
                pass

    def test_run_async_returns_202(self):
        """POST /procedures/run-async returns 202 with a job_id."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.post(f"/api/experiments/{exp_id}/procedures/run-async")
            assert response.status_code == 202, response.text
            data = response.json()
            assert data["status"] == "started"
            assert "job_id" in data
            assert data["experiment_id"] == exp_id

    def test_websocket_receives_progress(self):
        """Connect WebSocket, POST run-async, receive progress then complete."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            for b in client.get(f"/api/experiments/{exp_id}/baselines").json()["baselines"]:
                client.delete(f"/api/experiments/{exp_id}/baselines/{b['detector_name']}")
            for p in client.get(f"/api/experiments/{exp_id}/peaks").json()["peaks"]:
                client.delete(f"/api/experiments/{exp_id}/peaks/{p['id']}")
            create_resp = client.post(
                f"/api/experiments/{exp_id}/peaks",
                json={"range_start": 19.66, "range_end": 23.87, "dn_dc": 0.185},
            )
            assert create_resp.status_code in (200, 201), create_resp.text
            with client.websocket_connect(f"/api/experiments/{exp_id}/progress") as websocket:
                start_resp = client.post(f"/api/experiments/{exp_id}/procedures/run-async")
                assert start_resp.status_code == 202, start_resp.text
                messages = []
                deadline = time.time() + 60.0
                while time.time() < deadline:
                    try:
                        msg = websocket.receive_json()
                    except Exception:
                        break
                    messages.append(msg)
                    if msg.get("type") in ("complete", "error"):
                        break
                assert len(messages) > 0, "No messages received over WebSocket"
                types = [m.get("type") for m in messages]
                assert "progress" in types, f"Expected at least one progress message, got types={types}"
                terminal = [m for m in messages if m.get("type") in ("complete", "error")]
                assert len(terminal) >= 1, f"Expected a terminal message, got types={types}"
                assert terminal[-1]["type"] != "error", f"Analysis ended in error: {terminal[-1]}"
                if terminal[-1]["type"] == "complete":
                    assert "results_url" in terminal[-1]
