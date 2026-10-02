"""Test chromatogram data endpoints."""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestChromatogram:
    _experiment_id = None

    def _ensure_upload(self, client):
        """Upload the test file once and cache the experiment ID."""
        if TestChromatogram._experiment_id is not None:
            return TestChromatogram._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        # 201 on first upload, 400 on duplicate (dedup by file hash)
        if response.status_code == 201:
            TestChromatogram._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestChromatogram._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestChromatogram._experiment_id

    def test_get_all_chromatograms(self):
        """GET /api/experiments/{id}/chromatograms should return all detector data."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.get(f"/api/experiments/{exp_id}/chromatograms")
            assert response.status_code == 200
            data = response.json()
            assert "detectors" in data
            # At least one detector should be present
            assert len(data["detectors"]) > 0

    def test_get_detectors_list(self):
        """GET /api/experiments/{id}/detectors should list detectors."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.get(f"/api/experiments/{exp_id}/detectors")
            assert response.status_code == 200
            data = response.json()
            assert "detectors" in data
            assert len(data["detectors"]) > 0

    def test_get_single_detector(self):
        """GET /api/experiments/{id}/chromatograms/MALS should return MALS data."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.get(f"/api/experiments/{exp_id}/chromatograms/MALS")
            assert response.status_code == 200
            data = response.json()
            assert data["detector"] == "MALS"
