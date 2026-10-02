"""Test baseline management endpoints."""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestBaselines:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestBaselines._experiment_id is not None:
            return TestBaselines._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestBaselines._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestBaselines._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestBaselines._experiment_id

    def test_create_baseline(self):
        """PUT a constant baseline on the RI detector, assert it is stored."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.put(
                f"/api/experiments/{exp_id}/baselines/RI",
                json={
                    "detector_name": "RI",
                    "baseline_type": 0,
                    "x1": 5.0,
                    "x2": 15.0,
                    "is_auto": False,
                },
            )
            assert response.status_code in (200, 201), response.text
            data = response.json()
            assert data["detector_name"] == "RI"
            assert data["baseline_type"] == 0
            assert data["version"] >= 1

            list_resp = client.get(f"/api/experiments/{exp_id}/baselines")
            assert list_resp.status_code == 200
            listed = list_resp.json()
            names = [b["detector_name"] for b in listed["baselines"]]
            assert "RI" in names

    def test_get_baselines(self):
        """GET list returns baselines for the experiment."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            client.put(
                f"/api/experiments/{exp_id}/baselines/RI",
                json={"detector_name": "RI", "baseline_type": 0},
            )
            response = client.get(f"/api/experiments/{exp_id}/baselines")
            assert response.status_code == 200
            data = response.json()
            assert "baselines" in data
            assert "total" in data
            assert data["total"] >= 1

    def test_update_baseline_version_conflict(self):
        """PUT a baseline then PUT again with a wrong X-Resource-Version -> 409."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            put1 = client.put(
                f"/api/experiments/{exp_id}/baselines/UV",
                json={"detector_name": "UV", "baseline_type": 0},
            )
            assert put1.status_code in (200, 201), put1.text
            stored_version = put1.json()["version"]

            put2 = client.put(
                f"/api/experiments/{exp_id}/baselines/UV",
                json={"detector_name": "UV", "baseline_type": 1, "x1": 1.0, "x2": 2.0},
                headers={"X-Resource-Version": str(stored_version + 999)},
            )
            assert put2.status_code == 409, put2.text

    def test_delete_baseline(self):
        """DELETE the baseline, assert message, GET confirms it is gone."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            client.put(
                f"/api/experiments/{exp_id}/baselines/MALS",
                json={"detector_name": "MALS", "baseline_type": 0},
            )
            del_resp = client.delete(f"/api/experiments/{exp_id}/baselines/MALS")
            assert del_resp.status_code == 200, del_resp.text
            assert "deleted" in del_resp.json()["message"].lower()

            list_resp = client.get(f"/api/experiments/{exp_id}/baselines")
            names = [b["detector_name"] for b in list_resp.json()["baselines"]]
            assert "MALS" not in names

    def test_auto_baseline(self):
        """POST /auto with default params creates baselines for available detectors."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.post(
                f"/api/experiments/{exp_id}/baselines/auto",
                json={},
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert "baselines" in data
            assert len(data["baselines"]) >= 1
            for b in data["baselines"]:
                assert b["is_auto"] is True
            at_least_one_nontrivial = any(
                b.get("std_dev") not in (None, 0.0, 0)
                or b.get("slope") not in (None, 0.0, 0)
                or b.get("intercept") not in (None, 0.0, 0)
                for b in data["baselines"]
            )
            assert at_least_one_nontrivial, (
                "auto-baseline produced all-zero baselines — window math regressed: "
                f"{[(b['detector_name'], b.get('std_dev'), b.get('slope')) for b in data['baselines']]}"
            )

    def test_baseline_subtracted_chromatogram(self):
        """GET chromatograms with ?baseline_subtracted=true returns 200 and flag set."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            client.put(
                f"/api/experiments/{exp_id}/baselines/RI",
                json={"detector_name": "RI", "baseline_type": 0},
            )
            response = client.get(
                f"/api/experiments/{exp_id}/chromatograms?baseline_subtracted=true"
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert data.get("baseline_subtracted") is True

    def test_blank_subtract(self):
        """POST blank-subtract with the same experiment as source and blank."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.post(
                f"/api/experiments/{exp_id}/baselines/blank-subtract",
                json={"blank_experiment_id": exp_id},
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert "message" in data
            assert data["blank_experiment_id"] == exp_id
