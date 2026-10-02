"""Integration tests for the procedure orchestrator and auto-analyze endpoint.

The numerical validation test uploads the PS 30kDa calibration file, runs
auto-analyze, and asserts that the computed Mn/Mw/Mz/Pd match ASTRA's
published results within the hard validation gate:

    Mn = 10231  (±2%)
    Mw = 15623  (±2%)
    Mz = 24019  (±2%)
    Pd = 1.527  (±3%)

Skipped when ``ASTRA_TEST_FILE`` is not set.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")

EXPECTED = {
    "Mn": 10231.0,
    "Mw": 15623.0,
    "Mz": 24019.0,
    "Pd": 1.527,
}

TOL_MN_MW_MZ = 0.02
TOL_PD = 0.03


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestProcedureOrchestrator:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestProcedureOrchestrator._experiment_id is not None:
            return TestProcedureOrchestrator._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestProcedureOrchestrator._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestProcedureOrchestrator._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestProcedureOrchestrator._experiment_id

    def test_auto_analyze_validation_gate(self):
        """Auto-analyze the PS 30kDa file and assert Mn/Mw/Mz/Pd within tolerance."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            existing_baselines = client.get(f"/api/experiments/{exp_id}/baselines").json()["baselines"]
            for b in existing_baselines:
                client.delete(f"/api/experiments/{exp_id}/baselines/{b['detector_name']}")

            existing_peaks = client.get(f"/api/experiments/{exp_id}/peaks").json()["peaks"]
            for p in existing_peaks:
                client.delete(f"/api/experiments/{exp_id}/peaks/{p['id']}")

            create_resp = client.post(
                f"/api/experiments/{exp_id}/peaks",
                json={"range_start": 19.66, "range_end": 23.87, "dn_dc": 0.185},
            )
            assert create_resp.status_code in (200, 201), create_resp.text

            response = client.post(f"/api/experiments/{exp_id}/procedures/run")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["experiment_id"] == exp_id
            assert len(data["peaks"]) >= 1

            peaks_with_mn = [p for p in data["peaks"] if p.get("mn") is not None]
            if peaks_with_mn:
                peak1 = peaks_with_mn[0]
            else:
                peak1 = next((p for p in data["peaks"] if p.get("range_number") == 1), data["peaks"][0])
            mn = peak1.get("mn")
            mw = peak1.get("mw")
            mz = peak1.get("mz")
            pd = peak1.get("polydispersity")

            assert mn is not None, f"Mn is None; peaks={data['peaks']}"
            assert mw is not None, f"Mw is None; peaks={data['peaks']}"
            assert mz is not None, f"Mz is None; peaks={data['peaks']}"
            assert pd is not None, f"Pd is None; peaks={data['peaks']}"

            mn_err = abs(mn - EXPECTED["Mn"]) / EXPECTED["Mn"]
            mw_err = abs(mw - EXPECTED["Mw"]) / EXPECTED["Mw"]
            mz_err = abs(mz - EXPECTED["Mz"]) / EXPECTED["Mz"]
            pd_err = abs(pd - EXPECTED["Pd"]) / EXPECTED["Pd"]

            assert mn_err <= TOL_MN_MW_MZ, (
                f"Mn {mn:.1f} exceeds ±{TOL_MN_MW_MZ*100:.0f}% tolerance "
                f"(expected {EXPECTED['Mn']}, err {mn_err*100:.2f}%)"
            )
            assert mw_err <= TOL_MN_MW_MZ, (
                f"Mw {mw:.1f} exceeds ±{TOL_MN_MW_MZ*100:.0f}% tolerance "
                f"(expected {EXPECTED['Mw']}, err {mw_err*100:.2f}%)"
            )
            assert mz_err <= TOL_MN_MW_MZ, (
                f"Mz {mz:.1f} exceeds ±{TOL_MN_MW_MZ*100:.0f}% tolerance "
                f"(expected {EXPECTED['Mz']}, err {mz_err*100:.2f}%)"
            )
            assert pd_err <= TOL_PD, (
                f"Pd {pd:.4f} exceeds ±{TOL_PD*100:.0f}% tolerance "
                f"(expected {EXPECTED['Pd']}, err {pd_err*100:.2f}%)"
            )

    def test_get_procedures(self):
        """GET /api/experiments/{id}/procedures returns procedure states."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            client.post(f"/api/experiments/{exp_id}/auto-analyze")
            response = client.get(f"/api/experiments/{exp_id}/procedures")
            assert response.status_code == 200, response.text
            data = response.json()
            assert "procedures" in data
            assert data["total"] >= 1

    def test_update_procedure(self):
        """PUT a procedure state, assert it is stored."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            client.post(f"/api/experiments/{exp_id}/auto-analyze")
            procs = client.get(f"/api/experiments/{exp_id}/procedures").json()["procedures"]
            first = procs[0]
            response = client.put(
                f"/api/experiments/{exp_id}/procedures/{first['procedure_name']}",
                json={"is_enabled": False},
            )
            assert response.status_code == 200, response.text
            assert response.json()["is_enabled"] is False

    def test_run_procedures(self):
        """POST /api/experiments/{id}/procedures/run returns 200 with peaks."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.post(f"/api/experiments/{exp_id}/procedures/run")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["experiment_id"] == exp_id
