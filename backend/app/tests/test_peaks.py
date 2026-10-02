"""Test peak management and dn/dc library endpoints."""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestPeaks:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestPeaks._experiment_id is not None:
            return TestPeaks._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestPeaks._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestPeaks._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestPeaks._experiment_id

    def test_create_peak(self):
        """POST a peak with range_start=8.0, range_end=12.0, dn_dc=0.185; assert 200/201, fields match, version>=1, no warnings."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.post(
                f"/api/experiments/{exp_id}/peaks",
                json={
                    "range_start": 8.0,
                    "range_end": 12.0,
                    "dn_dc": 0.185,
                },
            )
            assert response.status_code in (200, 201), response.text
            data = response.json()
            assert data["range_start"] == 8.0
            assert data["range_end"] == 12.0
            assert data["dn_dc"] == 0.185
            assert data["version"] >= 1
            assert "warnings" in data
            assert data["warnings"] == [], f"expected no warnings for dn/dc=0.185, got {data['warnings']}"

    def test_create_peak_dndc_warning(self):
        """POST a peak with dn_dc=0.01 (outside range); assert warnings list non-empty and mentions 'outside the typical range'."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.post(
                f"/api/experiments/{exp_id}/peaks",
                json={
                    "range_start": 14.0,
                    "range_end": 16.0,
                    "dn_dc": 0.01,
                },
            )
            assert response.status_code in (200, 201), response.text
            data = response.json()
            assert "warnings" in data
            assert len(data["warnings"]) >= 1, f"expected at least one warning for dn/dc=0.01, got {data.get('warnings')}"
            assert any("outside the typical range" in w for w in data["warnings"]), \
                f"warning should mention 'outside the typical range': {data['warnings']}"

    def test_get_peaks(self):
        """GET list returns peaks for the experiment; total >= 1."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            client.post(
                f"/api/experiments/{exp_id}/peaks",
                json={"range_start": 1.0, "range_end": 2.0},
            )
            response = client.get(f"/api/experiments/{exp_id}/peaks")
            assert response.status_code == 200, response.text
            data = response.json()
            assert "peaks" in data
            assert "total" in data
            assert data["total"] >= 1

    def test_get_single_peak(self):
        """GET a specific peak by id; 404 for a nonexistent id."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            create = client.post(
                f"/api/experiments/{exp_id}/peaks",
                json={"range_start": 20.0, "range_end": 22.0},
            )
            assert create.status_code in (200, 201), create.text
            peak_id = create.json()["id"]

            ok = client.get(f"/api/experiments/{exp_id}/peaks/{peak_id}")
            assert ok.status_code == 200, ok.text
            assert ok.json()["id"] == peak_id

            missing = client.get(f"/api/experiments/{exp_id}/peaks/9999999")
            assert missing.status_code == 404, missing.text

    def test_update_peak(self):
        """PUT a peak changing dn/dc; assert version increments; assert 409 on wrong X-Resource-Version."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            create = client.post(
                f"/api/experiments/{exp_id}/peaks",
                json={"range_start": 30.0, "range_end": 32.0, "dn_dc": 0.185},
            )
            assert create.status_code in (200, 201), create.text
            peak_id = create.json()["id"]
            stored_version = create.json()["version"]

            upd = client.put(
                f"/api/experiments/{exp_id}/peaks/{peak_id}",
                json={"dn_dc": 0.190},
                headers={"X-Resource-Version": str(stored_version)},
            )
            assert upd.status_code in (200, 201), upd.text
            udata = upd.json()
            assert udata["dn_dc"] == 0.190
            assert udata["version"] == stored_version + 1

            conflict = client.put(
                f"/api/experiments/{exp_id}/peaks/{peak_id}",
                json={"dn_dc": 0.200},
                headers={"X-Resource-Version": str(stored_version + 999)},
            )
            assert conflict.status_code == 409, conflict.text

    def test_delete_peak(self):
        """DELETE a peak; assert message; GET confirms gone (404)."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            create = client.post(
                f"/api/experiments/{exp_id}/peaks",
                json={"range_start": 40.0, "range_end": 42.0},
            )
            assert create.status_code in (200, 201), create.text
            peak_id = create.json()["id"]
            stored_version = create.json()["version"]

            del_resp = client.delete(
                f"/api/experiments/{exp_id}/peaks/{peak_id}",
                headers={"X-Resource-Version": str(stored_version)},
            )
            assert del_resp.status_code == 200, del_resp.text
            assert "deleted" in del_resp.json()["message"].lower()

            gone = client.get(f"/api/experiments/{exp_id}/peaks/{peak_id}")
            assert gone.status_code == 404, gone.text

    def test_auto_peaks(self):
        """POST /peaks/auto with default params; assert 200, >=1 peak, all is_auto True, range_start < range_end, and peaks are non-trivial."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.post(
                f"/api/experiments/{exp_id}/peaks/auto",
                json={},
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert "peaks" in data
            assert len(data["peaks"]) >= 1, f"expected at least one auto-detected peak, got {data}"
            for p in data["peaks"]:
                assert p["is_auto"] is True, f"peak {p.get('id')} is_auto should be True"
                rs = p["range_start"]
                re_ = p["range_end"]
                assert rs is not None and re_ is not None, "range bounds must be set"
                assert rs < re_, f"range_start {rs} must be < range_end {re_}"
            at_least_one_nontrivial = any(
                (p["range_end"] - p["range_start"]) >= 0.1
                for p in data["peaks"]
            )
            assert at_least_one_nontrivial, (
                "auto-peak detection produced only degenerate (<0.1 min) peaks — "
                "detection math regressed: "
                f"{[(p['range_number'], p['range_start'], p['range_end']) for p in data['peaks']]}"
            )

    def test_dndc_library(self):
        """GET /api/dndc/library; total>=5; ?polymer=polystyrene returns PS/THF entry; ?solvent=thf returns >=2 entries."""
        with TestClient(app) as client:
            r = client.get("/api/dndc/library")
            assert r.status_code == 200, r.text
            data = r.json()
            assert "entries" in data
            assert "total" in data
            assert data["total"] >= 5, f"library should have >=5 entries, got {data['total']}"

            ps = client.get("/api/dndc/library?polymer=polystyrene")
            assert ps.status_code == 200, ps.text
            psd = ps.json()
            assert psd["total"] >= 1, f"polystyrene query should return >=1, got {psd['total']}"
            found_ps_thf = any(
                e["polymer"].lower() == "polystyrene" and e["solvent"].upper() == "THF"
                for e in psd["entries"]
            )
            assert found_ps_thf, "PS/THF entry missing from polystyrene query"

            thf = client.get("/api/dndc/library?solvent=thf")
            assert thf.status_code == 200, thf.text
            thfd = thf.json()
            assert thfd["total"] >= 2, f"solvent=thf should return >=2 entries, got {thfd['total']}"
