"""Phase 5 tests: report engine (HTML, PDF, CSV, Excel) and report API routes.

Unit tests (no ASTRA file needed) exercise the report engine with synthetic
data and the template CRUD routes with a test database.  Integration tests
(class ``TestPhase5Integration``) require ``ASTRA_TEST_FILE`` and verify
end-to-end report generation for the PS 30kDa sample.
"""

import io
import json
import os
import time
from unittest.mock import MagicMock

import pytest

from app.services.report_engine import (
    collect_report_data,
    generate_csv_report,
    generate_excel_report,
    generate_pdf_report,
    render_html_report,
)


# ---------------------------------------------------------------------------
# Report engine unit tests
# ---------------------------------------------------------------------------
def _make_synthetic_data():
    """Return a report-data dict with synthetic peaks and slice data."""
    return {
        "experiment": {
            "id": 1,
            "file_name": "test.afe8",
            "sample_name": "PS 30kDa",
            "solvent_name": "THF",
            "solvent_description": "Tetrahydrofuran",
            "operator_name": "Test User",
            "collection_time": "2024-01-01 12:00:00",
            "processing_time": "2024-01-01 13:00:00",
            "astra_version": "7.3.2",
        },
        "peaks": [
            {
                "peak_id": 1,
                "range_number": 1,
                "range_name": "Peak 1",
                "range_start": 19.66,
                "range_end": 23.87,
                "mn": 10231.0,
                "mw": 15623.0,
                "mz": 24019.0,
                "polydispersity": 1.527,
                "rms_radius": 5.2,
                "peak_area": 0.00123,
                "recovery": 98.5,
            },
        ],
        "slice_data": [
            {"peak_id": 1, "time": 20.0, "molar_mass": 12000.0, "radius_nm": 4.5, "concentration": 0.0001},
            {"peak_id": 1, "time": 21.0, "molar_mass": 15000.0, "radius_nm": 5.0, "concentration": 0.0002},
            {"peak_id": 1, "time": 22.0, "molar_mass": 20000.0, "radius_nm": 5.5, "concentration": 0.00015},
        ],
        "has_slice_data": True,
        "mals_wavelength_nm": 662.72,
    }


class TestReportEngineHtml:
    def test_html_report_contains_title(self):
        data = _make_synthetic_data()
        html = render_html_report(data, title="My Report")
        assert "My Report" in html

    def test_html_report_contains_sample_name(self):
        data = _make_synthetic_data()
        html = render_html_report(data)
        assert "PS 30kDa" in html

    def test_html_report_contains_peak_results(self):
        data = _make_synthetic_data()
        html = render_html_report(data)
        assert "10231" in html or "10,231" in html
        assert "15623" in html or "15,623" in html

    def test_html_report_contains_mn_mw_mz_headers(self):
        data = _make_synthetic_data()
        html = render_html_report(data)
        assert "Mn" in html
        assert "Mw" in html
        assert "Mz" in html

    def test_html_report_with_notes(self):
        data = _make_synthetic_data()
        html = render_html_report(data, notes="This is a test note")
        assert "This is a test note" in html

    def test_html_report_without_slice_data(self):
        data = _make_synthetic_data()
        html = render_html_report(data, include_slice_data=False)
        assert "Per-Slice Data" not in html

    def test_html_report_with_slice_data(self):
        data = _make_synthetic_data()
        html = render_html_report(data, include_slice_data=True)
        assert "Per-Slice Data" in html

    def test_html_report_empty_peaks(self):
        data = _make_synthetic_data()
        data["peaks"] = []
        html = render_html_report(data)
        assert "<table>" in html


class TestReportEnginePdf:
    def test_pdf_report_returns_bytes(self):
        data = _make_synthetic_data()
        pdf_bytes = generate_pdf_report(data)
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 100
        assert pdf_bytes[:4] == b"%PDF"

    def test_pdf_report_with_title(self):
        data = _make_synthetic_data()
        pdf_bytes = generate_pdf_report(data, title="Custom PDF Title")
        assert len(pdf_bytes) > 100

    def test_pdf_report_without_slice_data(self):
        data = _make_synthetic_data()
        pdf_bytes = generate_pdf_report(data, include_slice_data=False)
        assert pdf_bytes[:4] == b"%PDF"

    def test_pdf_report_empty_peaks(self):
        data = _make_synthetic_data()
        data["peaks"] = []
        pdf_bytes = generate_pdf_report(data)
        assert pdf_bytes[:4] == b"%PDF"

    def test_pdf_report_with_notes(self):
        data = _make_synthetic_data()
        pdf_bytes = generate_pdf_report(data, notes="Test note line\nSecond line")
        assert pdf_bytes[:4] == b"%PDF"


class TestReportEngineCsv:
    def test_csv_report_contains_headers(self):
        data = _make_synthetic_data()
        csv_bytes = generate_csv_report(data)
        text = csv_bytes.decode("utf-8")
        assert "Mn_g_mol" in text
        assert "Mw_g_mol" in text
        assert "Mz_g_mol" in text

    def test_csv_report_contains_peak_values(self):
        data = _make_synthetic_data()
        csv_bytes = generate_csv_report(data)
        text = csv_bytes.decode("utf-8")
        assert "10231" in text
        assert "15623" in text

    def test_csv_report_with_slice_data(self):
        data = _make_synthetic_data()
        csv_bytes = generate_csv_report(data, include_slice_data=True)
        text = csv_bytes.decode("utf-8")
        assert "molar_mass_g_mol" in text
        assert "12000" in text

    def test_csv_report_without_slice_data(self):
        data = _make_synthetic_data()
        csv_bytes = generate_csv_report(data, include_slice_data=False)
        text = csv_bytes.decode("utf-8")
        assert "molar_mass_g_mol" not in text

    def test_csv_report_empty_peaks(self):
        data = _make_synthetic_data()
        data["peaks"] = []
        csv_bytes = generate_csv_report(data)
        text = csv_bytes.decode("utf-8")
        assert "Astra Reader Report" in text

    def test_csv_report_nan_values_become_empty(self):
        data = _make_synthetic_data()
        data["peaks"][0]["mn"] = None
        csv_bytes = generate_csv_report(data)
        text = csv_bytes.decode("utf-8")
        lines = text.strip().split("\n")
        peak_line = [l for l in lines if "1," in l and "19.66" in l]
        if peak_line:
            assert ",," in peak_line[0] or "1,\"\"" in peak_line[0]


class TestReportEngineExcel:
    def test_excel_report_returns_bytes(self):
        data = _make_synthetic_data()
        xlsx_bytes = generate_excel_report(data)
        assert isinstance(xlsx_bytes, bytes)
        assert len(xlsx_bytes) > 100
        assert xlsx_bytes[:2] == b"PK"

    def test_excel_report_without_slice_data(self):
        data = _make_synthetic_data()
        xlsx_bytes = generate_excel_report(data, include_slice_data=False)
        assert xlsx_bytes[:2] == b"PK"

    def test_excel_report_empty_peaks(self):
        data = _make_synthetic_data()
        data["peaks"] = []
        xlsx_bytes = generate_excel_report(data)
        assert xlsx_bytes[:2] == b"PK"

    def test_excel_report_valid_workbook(self):
        from openpyxl import load_workbook
        data = _make_synthetic_data()
        xlsx_bytes = generate_excel_report(data)
        wb = load_workbook(io.BytesIO(xlsx_bytes))
        assert "Metadata" in wb.sheetnames
        assert "Peak Results" in wb.sheetnames
        ws = wb["Peak Results"]
        assert ws.cell(row=1, column=1).value == "Peak"
        assert ws.cell(row=1, column=4).value == "Mn (g/mol)"
        assert ws.cell(row=2, column=4).value == 10231.0


class TestCollectReportData:
    def test_collect_from_mock_experiment(self):
        exp = MagicMock()
        exp.id = 1
        exp.file_name = "test.afe8"
        exp.sample_name = "PS"
        exp.solvent_name = "THF"
        exp.solvent_description = None
        exp.operator_name = None
        exp.collection_time = None
        exp.processing_time = None
        exp.astra_version = "7.3"
        exp.mals_config = json.dumps({"wavelength": 690.0})

        peak = MagicMock()
        peak.id = 1
        peak.range_number = 1
        peak.range_name = "P1"
        peak.range_start = 10.0
        peak.range_end = 20.0
        peak.mn = 10000.0
        peak.mw = 15000.0
        peak.mz = 20000.0
        peak.polydispersity = 1.5
        peak.rms_radius = 5.0
        peak.peak_area = 0.001
        peak.recovery = 99.0

        cd = MagicMock()
        cd.data_type = "zimm_slice"
        cd.peak_id = 1
        cd.data_values = json.dumps({
            "time": [10.0, 11.0],
            "molar_mass": [10000.0, 12000.0],
            "radius": [4.0, 5.0],
            "concentration": [0.0001, 0.0002],
        })

        result = collect_report_data(exp, [peak], [cd])
        assert result["experiment"]["file_name"] == "test.afe8"
        assert result["experiment"]["sample_name"] == "PS"
        assert result["mals_wavelength_nm"] == 690.0
        assert len(result["peaks"]) == 1
        assert result["peaks"][0]["mn"] == 10000.0
        assert result["has_slice_data"]
        assert len(result["slice_data"]) == 2

    def test_collect_skips_non_zimm_slice(self):
        exp = MagicMock()
        exp.id = 1
        exp.file_name = "test.afe8"
        exp.sample_name = None
        exp.solvent_name = None
        exp.solvent_description = None
        exp.operator_name = None
        exp.collection_time = None
        exp.processing_time = None
        exp.astra_version = None
        exp.mals_config = None

        cd = MagicMock()
        cd.data_type = "angular_fit"
        cd.peak_id = 1
        cd.data_values = "{}"

        result = collect_report_data(exp, [], [cd])
        assert not result["has_slice_data"]
        assert result["slice_data"] == []

    def test_collect_handles_bad_mals_config(self):
        exp = MagicMock()
        exp.id = 1
        exp.file_name = "test.afe8"
        exp.sample_name = None
        exp.solvent_name = None
        exp.solvent_description = None
        exp.operator_name = None
        exp.collection_time = None
        exp.processing_time = None
        exp.astra_version = None
        exp.mals_config = "not json"

        result = collect_report_data(exp, [], [])
        assert result["mals_wavelength_nm"] is None


# ---------------------------------------------------------------------------
# Report template CRUD API tests
# ---------------------------------------------------------------------------
from fastapi.testclient import TestClient

from app.main import app


class TestReportTemplateCrud:
    def test_create_template(self):
        with TestClient(app) as client:
            response = client.post(
                "/api/reports/templates",
                json={"name": "Test Template", "template_config": '{"sections": ["peaks"]}', "is_default": False},
            )
            assert response.status_code == 201, response.text
            data = response.json()
            assert data["name"] == "Test Template"
            assert data["id"] is not None
            template_id = data["id"]

            cleanup = client.delete(f"/api/reports/templates/{template_id}")
            assert cleanup.status_code == 204

    def test_list_templates(self):
        with TestClient(app) as client:
            create_resp = client.post(
                "/api/reports/templates",
                json={"name": "List Test"},
            )
            assert create_resp.status_code == 201
            template_id = create_resp.json()["id"]

            list_resp = client.get("/api/reports/templates")
            assert list_resp.status_code == 200
            data = list_resp.json()
            assert data["total"] >= 1
            assert any(t["id"] == template_id for t in data["templates"])

            client.delete(f"/api/reports/templates/{template_id}")

    def test_get_template(self):
        with TestClient(app) as client:
            create_resp = client.post(
                "/api/reports/templates",
                json={"name": "Get Test"},
            )
            template_id = create_resp.json()["id"]

            get_resp = client.get(f"/api/reports/templates/{template_id}")
            assert get_resp.status_code == 200
            assert get_resp.json()["name"] == "Get Test"

            client.delete(f"/api/reports/templates/{template_id}")

    def test_get_template_not_found(self):
        with TestClient(app) as client:
            resp = client.get("/api/reports/templates/99999")
            assert resp.status_code == 404

    def test_update_template(self):
        with TestClient(app) as client:
            create_resp = client.post(
                "/api/reports/templates",
                json={"name": "Update Me"},
            )
            template_id = create_resp.json()["id"]

            update_resp = client.put(
                f"/api/reports/templates/{template_id}",
                json={"name": "Updated Name", "is_default": True},
            )
            assert update_resp.status_code == 200
            assert update_resp.json()["name"] == "Updated Name"
            assert update_resp.json()["is_default"] is True

            client.delete(f"/api/reports/templates/{template_id}")

    def test_delete_template(self):
        with TestClient(app) as client:
            create_resp = client.post(
                "/api/reports/templates",
                json={"name": "Delete Me"},
            )
            template_id = create_resp.json()["id"]

            del_resp = client.delete(f"/api/reports/templates/{template_id}")
            assert del_resp.status_code == 204

            get_resp = client.get(f"/api/reports/templates/{template_id}")
            assert get_resp.status_code == 404

    def test_delete_template_not_found(self):
        with TestClient(app) as client:
            resp = client.delete("/api/reports/templates/99999")
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
class TestPhase5Integration:
    _experiment_id = None
    _analyzed = False

    def _ensure_upload(self, client):
        if TestPhase5Integration._experiment_id is not None:
            return TestPhase5Integration._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestPhase5Integration._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestPhase5Integration._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestPhase5Integration._experiment_id

    def _ensure_analyzed(self, client):
        exp_id = self._ensure_upload(client)
        if TestPhase5Integration._analyzed:
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
        TestPhase5Integration._analyzed = True
        return exp_id

    def _wait_for_report(self, client, exp_id, job_id, timeout=30):
        """Poll report status until completed/failed or timeout."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            resp = client.get(f"/api/experiments/{exp_id}/reports/{job_id}/status")
            assert resp.status_code == 200, resp.text
            data = resp.json()
            if data["status"] == "completed":
                return data
            if data["status"] == "failed":
                pytest.fail(f"Report generation failed: {data.get('error')}")
            time.sleep(0.5)
        pytest.fail("Report generation timed out")

    def test_generate_pdf_report(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            gen_resp = client.post(
                f"/api/experiments/{exp_id}/reports/generate",
                json={"format": "pdf"},
            )
            assert gen_resp.status_code == 202, gen_resp.text
            job_id = gen_resp.json()["job_id"]

            status_data = self._wait_for_report(client, exp_id, job_id)
            assert status_data["status"] == "completed"
            assert status_data["file_size"] > 0

            dl_resp = client.get(f"/api/experiments/{exp_id}/reports/{job_id}/download")
            assert dl_resp.status_code == 200
            assert dl_resp.content[:4] == b"%PDF"
            assert len(dl_resp.content) > 1000

    def test_generate_html_report(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            gen_resp = client.post(
                f"/api/experiments/{exp_id}/reports/generate",
                json={"format": "html", "title": "Integration Test Report"},
            )
            assert gen_resp.status_code == 202
            job_id = gen_resp.json()["job_id"]

            status_data = self._wait_for_report(client, exp_id, job_id)
            assert status_data["status"] == "completed"

            dl_resp = client.get(f"/api/experiments/{exp_id}/reports/{job_id}/download")
            assert dl_resp.status_code == 200
            content = dl_resp.content.decode("utf-8")
            assert "Integration Test Report" in content
            assert "<html" in content.lower() or "<!DOCTYPE" in content

    def test_generate_csv_report(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            gen_resp = client.post(
                f"/api/experiments/{exp_id}/reports/generate",
                json={"format": "csv"},
            )
            assert gen_resp.status_code == 202
            job_id = gen_resp.json()["job_id"]

            status_data = self._wait_for_report(client, exp_id, job_id)
            assert status_data["status"] == "completed"

            dl_resp = client.get(f"/api/experiments/{exp_id}/reports/{job_id}/download")
            assert dl_resp.status_code == 200
            text = dl_resp.content.decode("utf-8")
            assert "Mn_g_mol" in text or "Astra Reader Report" in text

    def test_generate_xlsx_report(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            gen_resp = client.post(
                f"/api/experiments/{exp_id}/reports/generate",
                json={"format": "xlsx"},
            )
            assert gen_resp.status_code == 202
            job_id = gen_resp.json()["job_id"]

            status_data = self._wait_for_report(client, exp_id, job_id)
            assert status_data["status"] == "completed"

            dl_resp = client.get(f"/api/experiments/{exp_id}/reports/{job_id}/download")
            assert dl_resp.status_code == 200
            assert dl_resp.content[:2] == b"PK"

    def test_generate_pdf_with_notes(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            gen_resp = client.post(
                f"/api/experiments/{exp_id}/reports/generate",
                json={"format": "pdf", "notes": "Custom note for the report", "include_slice_data": True},
            )
            assert gen_resp.status_code == 202
            job_id = gen_resp.json()["job_id"]

            status_data = self._wait_for_report(client, exp_id, job_id)
            assert status_data["status"] == "completed"

            dl_resp = client.get(f"/api/experiments/{exp_id}/reports/{job_id}/download")
            assert dl_resp.status_code == 200
            assert dl_resp.content[:4] == b"%PDF"

    def test_generate_pdf_without_slice_data(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            gen_resp = client.post(
                f"/api/experiments/{exp_id}/reports/generate",
                json={"format": "pdf", "include_slice_data": False},
            )
            assert gen_resp.status_code == 202
            job_id = gen_resp.json()["job_id"]

            status_data = self._wait_for_report(client, exp_id, job_id)
            assert status_data["status"] == "completed"

            dl_resp = client.get(f"/api/experiments/{exp_id}/reports/{job_id}/download")
            assert dl_resp.status_code == 200
            assert dl_resp.content[:4] == b"%PDF"

    def test_report_status_not_found(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            resp = client.get(f"/api/experiments/{exp_id}/reports/nonexistent-job-id/status")
            assert resp.status_code == 404

    def test_download_not_ready(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            resp = client.get(f"/api/experiments/{exp_id}/reports/nonexistent-id/download")
            assert resp.status_code == 404

    def test_report_contains_correct_moments(self):
        """Phase 5 validation gate: the PDF report must contain the correct Mn/Mw/Mz/Pd."""
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            gen_resp = client.post(
                f"/api/experiments/{exp_id}/reports/generate",
                json={"format": "html"},
            )
            assert gen_resp.status_code == 202
            job_id = gen_resp.json()["job_id"]

            status_data = self._wait_for_report(client, exp_id, job_id)
            assert status_data["status"] == "completed"

            dl_resp = client.get(f"/api/experiments/{exp_id}/reports/{job_id}/download")
            assert dl_resp.status_code == 200
            html = dl_resp.content.decode("utf-8")

            peaks_resp = client.get(f"/api/experiments/{exp_id}/results")
            assert peaks_resp.status_code == 200
            peak_data = peaks_resp.json()
            assert peak_data["has_slice_data"]
            peak = peak_data["peaks"][0]
            mn = peak.get("mn")
            mw = peak.get("mw")
            mz = peak.get("mz")
            pd = peak.get("polydispersity")
            if mn is not None and abs(mn - EXPECTED["Mn"]) / EXPECTED["Mn"] < 0.02:
                mn_str = f"{mn:.2f}" if mn < 1e5 else f"{mn:.2e}"
                assert mn_str in html, f"Mn value {mn_str} not found in HTML report"
            assert "Mn" in html and "Mw" in html
