"""Test experiment metadata endpoints."""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestMetadata:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestMetadata._experiment_id is not None:
            return TestMetadata._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        # 201 on first upload, 400 on duplicate (dedup by file hash)
        if response.status_code == 201:
            TestMetadata._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestMetadata._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestMetadata._experiment_id

    def test_get_experiment(self):
        """GET /api/files/{id} should return full experiment metadata."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.get(f"/api/files/{exp_id}")
            assert response.status_code == 200
            data = response.json()
            assert data["id"] == exp_id
            assert "mals_config" in data

    def test_get_instruments(self):
        """GET /api/experiments/{id}/instruments should return instrument configs."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.get(f"/api/experiments/{exp_id}/instruments")
            assert response.status_code == 200
            data = response.json()
            assert "mals" in data
            assert "ri" in data
            assert "uv" in data

    def test_get_solvent(self):
        """GET /api/experiments/{id}/solvent should return solvent info."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.get(f"/api/experiments/{exp_id}/solvent")
            assert response.status_code == 200
            data = response.json()
            assert "name" in data

    def test_get_sample(self):
        """GET /api/experiments/{id}/sample should return sample info."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.get(f"/api/experiments/{exp_id}/sample")
            assert response.status_code == 200
            data = response.json()
            assert "sample_name" in data

    def test_get_fluid_path(self):
        """GET /api/experiments/{id}/fluid-path should return fluid connections."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.get(f"/api/experiments/{exp_id}/fluid-path")
            assert response.status_code == 200
            data = response.json()
            assert "fluid_path" in data
