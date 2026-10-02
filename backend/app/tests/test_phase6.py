"""Phase 6 tests: batch processor, method templates, EASI tables.

Unit tests (no ASTRA file needed) exercise the batch processor service with
synthetic data and the template CRUD routes with a test database.  Integration
tests (class ``TestPhase6Integration``) require ``ASTRA_TEST_FILE`` and verify
end-to-end batch propagation for the PS 30kDa sample.
"""

import json
import os
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.batch_processor import VALID_SETTINGS, apply_settings_to_target

# ---------------------------------------------------------------------------
# Batch processor unit tests
# ---------------------------------------------------------------------------

class TestBatchProcessor:
    def test_valid_settings(self):
        assert "baselines" in VALID_SETTINGS
        assert "peaks" in VALID_SETTINGS
        assert "peak_params" in VALID_SETTINGS
        assert "procedures" in VALID_SETTINGS

    def test_invalid_setting_raises(self):
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            with pytest.raises(ValueError, match="Unknown settings"):
                apply_settings_to_target(db, 1, 2, ["invalid_setting"])
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Method template CRUD tests
# ---------------------------------------------------------------------------

class TestMethodTemplateCrud:
    def test_create_method(self):
        with TestClient(app) as client:
            resp = client.post(
                "/api/methods",
                json={"name": "Test Method", "description": "A test method", "template": "{}"},
            )
            assert resp.status_code == 201, resp.text
            data = resp.json()
            assert data["name"] == "Test Method"
            method_id = data["id"]
            client.delete(f"/api/methods/{method_id}")

    def test_list_methods(self):
        with TestClient(app) as client:
            create_resp = client.post("/api/methods", json={"name": "List Test"})
            assert create_resp.status_code == 201
            method_id = create_resp.json()["id"]

            list_resp = client.get("/api/methods")
            assert list_resp.status_code == 200
            assert list_resp.json()["total"] >= 1
            assert any(m["id"] == method_id for m in list_resp.json()["methods"])

            client.delete(f"/api/methods/{method_id}")

    def test_get_method(self):
        with TestClient(app) as client:
            create_resp = client.post("/api/methods", json={"name": "Get Test"})
            method_id = create_resp.json()["id"]

            get_resp = client.get(f"/api/methods/{method_id}")
            assert get_resp.status_code == 200
            assert get_resp.json()["name"] == "Get Test"

            client.delete(f"/api/methods/{method_id}")

    def test_get_method_not_found(self):
        with TestClient(app) as client:
            resp = client.get("/api/methods/99999")
            assert resp.status_code == 404

    def test_update_method(self):
        with TestClient(app) as client:
            create_resp = client.post("/api/methods", json={"name": "Update Me"})
            method_id = create_resp.json()["id"]

            update_resp = client.put(
                f"/api/methods/{method_id}",
                json={"name": "Updated Name", "is_public": True},
            )
            assert update_resp.status_code == 200
            assert update_resp.json()["name"] == "Updated Name"
            assert update_resp.json()["is_public"] is True

            client.delete(f"/api/methods/{method_id}")

    def test_delete_method(self):
        with TestClient(app) as client:
            create_resp = client.post("/api/methods", json={"name": "Delete Me"})
            method_id = create_resp.json()["id"]

            del_resp = client.delete(f"/api/methods/{method_id}")
            assert del_resp.status_code == 204

            get_resp = client.get(f"/api/methods/{method_id}")
            assert get_resp.status_code == 404

    def test_delete_method_not_found(self):
        with TestClient(app) as client:
            resp = client.delete("/api/methods/99999")
            assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Batch API tests
# ---------------------------------------------------------------------------

class TestBatchRoutes:
    def test_batch_apply_not_found_source(self):
        with TestClient(app) as client:
            resp = client.post(
                "/api/batch/apply",
                json={
                    "source_experiment_id": 99999,
                    "target_experiment_ids": [1],
                    "settings_to_propagate": ["baselines"],
                },
            )
            assert resp.status_code == 404

    def test_batch_apply_not_found_target(self):
        with TestClient(app) as client:
            resp = client.post(
                "/api/batch/apply",
                json={
                    "source_experiment_id": 1,
                    "target_experiment_ids": [99999],
                    "settings_to_propagate": ["baselines"],
                },
            )
            assert resp.status_code == 404

    def test_batch_status_not_found(self):
        with TestClient(app) as client:
            resp = client.get("/api/batch/nonexistent-job-id/status")
            assert resp.status_code == 404

    def test_batch_list_empty(self):
        with TestClient(app) as client:
            resp = client.get("/api/batch")
            assert resp.status_code == 200
            assert resp.json()["total"] >= 0

    def test_batch_cancel_not_found(self):
        with TestClient(app) as client:
            resp = client.delete("/api/batch/nonexistent-job-id")
            assert resp.status_code == 404


# ---------------------------------------------------------------------------
# EASI table CRUD tests
# ---------------------------------------------------------------------------

class TestEasiTableRoutes:
    def test_create_easi_not_found_experiment(self):
        with TestClient(app) as client:
            resp = client.post(
                "/api/easi-table",
                json={"name": "Test EASI", "experiment_ids": [99999]},
            )
            assert resp.status_code == 404

    def test_get_easi_not_found(self):
        with TestClient(app) as client:
            resp = client.get("/api/easi-table/99999")
            assert resp.status_code == 404

    def test_delete_easi_not_found(self):
        with TestClient(app) as client:
            resp = client.delete("/api/easi-table/99999")
            assert resp.status_code == 404

    def test_list_easi_tables(self):
        with TestClient(app) as client:
            resp = client.get("/api/easi-table")
            assert resp.status_code == 200
            assert resp.json()["total"] >= 0

    def test_export_easi_not_found(self):
        with TestClient(app) as client:
            resp = client.get("/api/easi-table/99999/export")
            assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Integration tests (require ASTRA test file)
# ---------------------------------------------------------------------------
TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")

EXPECTED = {
    "Mn": 10231.0,
    "Mw": 15623.0,
    "Mz": 24019.0,
    "Pd": 1.527,
}


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestPhase6Integration:
    _experiment_id = None
    _analyzed = False

    def _ensure_upload(self, client):
        if TestPhase6Integration._experiment_id is not None:
            return TestPhase6Integration._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestPhase6Integration._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestPhase6Integration._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestPhase6Integration._experiment_id

    def _ensure_analyzed(self, client):
        exp_id = self._ensure_upload(client)
        if TestPhase6Integration._analyzed:
            return exp_id
        for b in client.get(f"/api/experiments/{exp_id}/baselines").json()["baselines"]:
            client.delete(f"/api/experiments/{exp_id}/baselines/{b['detector_name']}")
        for p in client.get(f"/api/experiments/{exp_id}/peaks").json()["peaks"]:
            client.delete(f"/api/experiments/{exp_id}/peaks/{p['id']}")
        create_resp = client.post(
            f"/api/experiments/{exp_id}/peaks",
            json={"range_start": 19.66, "range_end": 23.87, "dn_dc": 0.185},
        )
        assert create_resp.status_code in (200, 201), create_resp.text
        run_resp = client.post(f"/api/experiments/{exp_id}/procedures/run")
        assert run_resp.status_code == 200, run_resp.text
        TestPhase6Integration._analyzed = True
        return exp_id

    def _wait_for_batch(self, client, job_id, timeout=30):
        """Poll batch status until completed/failed or timeout."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            resp = client.get(f"/api/batch/{job_id}/status")
            assert resp.status_code == 200, resp.text
            data = resp.json()
            if data["status"] == "completed":
                return data
            if data["status"] == "failed":
                pytest.fail(f"Batch job failed: {data.get('error')}")
            time.sleep(0.5)
        pytest.fail("Batch job timed out")

    def test_batch_apply_baselines_and_peaks(self):
        """Phase 6 validation: apply settings from source to target, verify peaks propagate."""
        with TestClient(app) as client:
            source_id = self._ensure_analyzed(client)

            target_resp = client.post(
                "/api/files/upload",
                files={"file": ("batch_target.afe8", open(TEST_FILE, "rb"), "application/gzip")},
            )
            if target_resp.status_code == 201:
                target_id = target_resp.json()["experiment_id"]
            elif target_resp.status_code == 400:
                detail = target_resp.json().get("detail", "")
                assert "already uploaded" in detail
                target_id = int(detail.split("experiment ID ")[1].rstrip(")"))
            else:
                assert False, f"Target upload failed: {target_resp.text}"

            batch_resp = client.post(
                "/api/batch/apply",
                json={
                    "source_experiment_id": source_id,
                    "target_experiment_ids": [target_id],
                    "settings_to_propagate": ["peaks", "procedures"],
                },
            )
            assert batch_resp.status_code == 202, batch_resp.text
            job_id = batch_resp.json()["job_id"]

            status_data = self._wait_for_batch(client, job_id)
            assert status_data["status"] == "completed"
            results = status_data["target_results"]
            assert len(results) == 1
            assert results[0]["status"] == "completed"

            target_peaks = client.get(f"/api/experiments/{target_id}/peaks").json()["peaks"]
            assert len(target_peaks) >= 1
            assert target_peaks[0]["range_start"] is not None
            assert abs(target_peaks[0]["range_start"] - 19.66) < 0.5

    def test_method_template_create_and_apply(self):
        """Create a method template and apply it to an experiment."""
        with TestClient(app) as client:
            source_id = self._ensure_analyzed(client)

            target_resp = client.post(
                "/api/files/upload",
                files={"file": ("method_target.afe8", open(TEST_FILE, "rb"), "application/gzip")},
            )
            if target_resp.status_code == 201:
                target_id = target_resp.json()["experiment_id"]
            elif target_resp.status_code == 400:
                detail = target_resp.json().get("detail", "")
                target_id = int(detail.split("experiment ID ")[1].rstrip(")"))
            else:
                assert False, f"Target upload failed: {target_resp.text}"

            template_json = json.dumps({
                "source_experiment_id": source_id,
                "settings_to_propagate": ["peaks"],
            })
            create_resp = client.post(
                "/api/methods",
                json={"name": "Integration Method", "template": template_json},
            )
            assert create_resp.status_code == 201
            method_id = create_resp.json()["id"]

            apply_resp = client.post(
                f"/api/experiments/{target_id}/methods/{method_id}/apply",
            )
            assert apply_resp.status_code == 200, apply_resp.text
            assert "summary" in apply_resp.json()

            target_peaks = client.get(f"/api/experiments/{target_id}/peaks").json()["peaks"]
            assert len(target_peaks) >= 1

            client.delete(f"/api/methods/{method_id}")

    def test_easi_table_create_and_export(self):
        """Create an EASI table from multiple experiments and export as CSV."""
        with TestClient(app) as client:
            source_id = self._ensure_analyzed(client)

            target_resp = client.post(
                "/api/files/upload",
                files={"file": ("easi_target.afe8", open(TEST_FILE, "rb"), "application/gzip")},
            )
            if target_resp.status_code == 201:
                target_id = target_resp.json()["experiment_id"]
            elif target_resp.status_code == 400:
                detail = target_resp.json().get("detail", "")
                target_id = int(detail.split("experiment ID ")[1].rstrip(")"))
            else:
                assert False, f"Target upload failed: {target_resp.text}"

            batch_resp = client.post(
                "/api/batch/apply",
                json={
                    "source_experiment_id": source_id,
                    "target_experiment_ids": [target_id],
                    "settings_to_propagate": ["peaks", "procedures"],
                },
            )
            assert batch_resp.status_code == 202
            job_id = batch_resp.json()["job_id"]
            self._wait_for_batch(client, job_id)

            client.post(
                f"/api/experiments/{target_id}/procedures/run",
            )

            create_resp = client.post(
                "/api/easi-table",
                json={"name": "Comparison Table", "experiment_ids": [source_id, target_id]},
            )
            assert create_resp.status_code == 201, create_resp.text
            easi_id = create_resp.json()["id"]

            get_resp = client.get(f"/api/easi-table/{easi_id}")
            assert get_resp.status_code == 200
            data = get_resp.json()
            assert len(data["experiment_ids"]) == 2
            assert len(data["rows"]) >= 2

            export_resp = client.get(f"/api/easi-table/{easi_id}/export")
            assert export_resp.status_code == 200
            assert "text/csv" in export_resp.headers.get("content-type", "")
            csv_text = export_resp.content.decode("utf-8")
            assert "sample_name" in csv_text or "experiment_id" in csv_text

            client.delete(f"/api/easi-table/{easi_id}")

    def test_batch_validation_gate(self):
        """Phase 6 validation gate: apply method to target, run analysis, verify results match."""
        with TestClient(app) as client:
            source_id = self._ensure_analyzed(client)

            source_results = client.get(f"/api/experiments/{source_id}/results").json()
            assert source_results["has_slice_data"]
            source_peak = source_results["peaks"][0]
            source_mn = source_peak.get("mn")
            source_mw = source_peak.get("mw")

            target_resp = client.post(
                "/api/files/upload",
                files={"file": ("validation_target.afe8", open(TEST_FILE, "rb"), "application/gzip")},
            )
            if target_resp.status_code == 201:
                target_id = target_resp.json()["experiment_id"]
            elif target_resp.status_code == 400:
                detail = target_resp.json().get("detail", "")
                target_id = int(detail.split("experiment ID ")[1].rstrip(")"))
            else:
                assert False, f"Target upload failed: {target_resp.text}"

            batch_resp = client.post(
                "/api/batch/apply",
                json={
                    "source_experiment_id": source_id,
                    "target_experiment_ids": [target_id],
                    "settings_to_propagate": ["peaks", "procedures"],
                },
            )
            assert batch_resp.status_code == 202
            job_id = batch_resp.json()["job_id"]
            self._wait_for_batch(client, job_id)

            run_resp = client.post(f"/api/experiments/{target_id}/procedures/run")
            assert run_resp.status_code == 200, run_resp.text

            target_results = client.get(f"/api/experiments/{target_id}/results").json()
            assert target_results["has_slice_data"]
            target_peak = target_results["peaks"][0]
            target_mn = target_peak.get("mn")
            target_mw = target_peak.get("mw")

            if source_mn is not None and target_mn is not None:
                rel_diff = abs(source_mn - target_mn) / source_mn
                assert rel_diff < 0.005, f"Mn difference {rel_diff:.4f} exceeds 0.5%"

            if source_mw is not None and target_mw is not None:
                rel_diff = abs(source_mw - target_mw) / source_mw
                assert rel_diff < 0.005, f"Mw difference {rel_diff:.4f} exceeds 0.5%"

            if target_mn is not None:
                rel_diff_mn = abs(target_mn - EXPECTED["Mn"]) / EXPECTED["Mn"]
                assert rel_diff_mn < 0.02, f"Target Mn {target_mn} differs from ASTRA {EXPECTED['Mn']} by {rel_diff_mn:.4f}"
