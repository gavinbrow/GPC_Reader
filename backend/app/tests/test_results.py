"""Integration tests for results routes and CSV export."""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestResultsRoutes:
    _experiment_id = None
    _analyzed = False

    def _ensure_upload(self, client):
        if TestResultsRoutes._experiment_id is not None:
            return TestResultsRoutes._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestResultsRoutes._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestResultsRoutes._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestResultsRoutes._experiment_id

    def _ensure_analyzed(self, client):
        exp_id = self._ensure_upload(client)
        if TestResultsRoutes._analyzed:
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
        TestResultsRoutes._analyzed = True
        return exp_id

    def test_get_results_empty(self):
        """GET /results before analysis returns 200 with no slice data."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            for b in client.get(f"/api/experiments/{exp_id}/baselines").json()["baselines"]:
                client.delete(f"/api/experiments/{exp_id}/baselines/{b['detector_name']}")
            for p in client.get(f"/api/experiments/{exp_id}/peaks").json()["peaks"]:
                client.delete(f"/api/experiments/{exp_id}/peaks/{p['id']}")
            response = client.get(f"/api/experiments/{exp_id}/results")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["experiment_id"] == exp_id
            assert data["has_slice_data"] is False

    def test_get_results_after_analysis(self):
        """GET /results after analysis returns 200 with slice data and peaks."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["experiment_id"] == exp_id
            assert data["has_slice_data"] is True
            assert len(data["peaks"]) >= 1
            peak = data["peaks"][0]
            assert peak["mn"] is not None
            assert peak["mw"] is not None
            assert peak["mz"] is not None

    def test_get_results_peaks(self):
        """GET /results/peaks returns a list of peak results."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/peaks")
            assert response.status_code == 200, response.text
            data = response.json()
            assert isinstance(data, list)
            assert len(data) >= 1
            assert "peak_id" in data[0]
            assert "mn" in data[0]

    def test_get_moments(self):
        """GET /results/moments returns moments for all peaks."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/moments")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1
            peak = data["peaks"][0]
            assert peak["mn"] is not None
            assert peak["mw"] is not None
            assert peak["mz"] is not None
            assert peak["polydispersity"] is not None

    def test_get_molar_mass(self):
        """GET /results/molar-mass returns slice data for all peaks."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/molar-mass")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1
            peak = data["peaks"][0]
            assert peak["peak_id"] is not None
            assert len(peak["time"]) > 0
            assert len(peak["molar_mass"]) > 0
            assert len(peak["concentration"]) > 0
            for v in peak["molar_mass"]:
                assert v is None or isinstance(v, (int, float))

    def test_get_molar_mass_with_peak_id(self):
        """GET /results/molar-mass?peak_id=X returns only one peak."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            all_resp = client.get(f"/api/experiments/{exp_id}/results/molar-mass")
            assert all_resp.status_code == 200, all_resp.text
            all_peaks = all_resp.json()["peaks"]
            assert len(all_peaks) >= 1
            target_id = all_peaks[0]["peak_id"]
            response = client.get(f"/api/experiments/{exp_id}/results/molar-mass?peak_id={target_id}")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] == 1
            assert data["peaks"][0]["peak_id"] == target_id

    def test_get_radius(self):
        """GET /results/radius returns slice radius data for all peaks."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/radius")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1
            peak = data["peaks"][0]
            assert peak["peak_id"] is not None
            assert len(peak["time"]) > 0
            assert len(peak["radius"]) > 0
            for v in peak["radius"]:
                assert v is None or isinstance(v, (int, float))

    def test_get_distributions(self):
        """GET /results/distributions returns binned distributions (diff)."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/distributions")
            assert response.status_code == 200, response.text
            data = response.json()
            assert isinstance(data, list)
            assert len(data) >= 1
            dist = data[0]
            assert dist["distribution_type"] == "diff"
            assert dist["n_bins"] == 50
            assert len(dist["bin_centers"]) > 0
            assert len(dist["weights"]) > 0

    def test_get_distributions_cum(self):
        """GET /results/distributions?type=cum returns cumulative sums."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/distributions?type=cum")
            assert response.status_code == 200, response.text
            data = response.json()
            assert isinstance(data, list)
            assert len(data) >= 1
            dist = data[0]
            assert dist["distribution_type"] == "cum"
            assert len(dist["cumulative"]) > 0
            if sum(dist["cumulative"]) > 0:
                assert dist["cumulative"][-1] == pytest.approx(1.0, abs=1e-6)

    def test_get_distributions_custom_bins(self):
        """GET /results/distributions?bins=20 returns 20-bin distributions."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/distributions?bins=20")
            assert response.status_code == 200, response.text
            data = response.json()
            assert isinstance(data, list)
            assert len(data) >= 1
            dist = data[0]
            assert dist["n_bins"] == 20

    def test_export_csv_processed(self):
        """GET /export/csv?data_type=processed returns CSV with the expected header."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/export/csv?data_type=processed")
            assert response.status_code == 200, response.text
            assert response.headers["content-type"].startswith("text/csv")
            assert "attachment" in response.headers["content-disposition"]
            body = response.text
            assert "peak_id,time_min,molar_mass_g_mol,radius_nm,concentration_g_mL" in body
            lines = body.strip().splitlines()
            assert len(lines) >= 2

    def test_export_csv_raw(self):
        """GET /export/csv?data_type=raw returns CSV with the expected header."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/export/csv?data_type=raw")
            assert response.status_code == 200, response.text
            assert response.headers["content-type"].startswith("text/csv")
            assert "attachment" in response.headers["content-disposition"]
            body = response.text
            assert "time_min,MALS_avg,RI,UV_avg" in body
            lines = body.strip().splitlines()
            assert len(lines) >= 2
