"""Test the .afe8 export / round-trip write functionality."""

import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from app.main import app
from astra_reader import AstraReader

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


def _save_export_bytes(content_bytes: bytes) -> tempfile.NamedTemporaryFile:
    tmp = tempfile.NamedTemporaryFile(suffix=".afe8", delete=False)
    tmp.write(content_bytes)
    tmp.close()
    return tmp


def _open_astra(path: str) -> AstraReader:
    return AstraReader(path)


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestExport:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestExport._experiment_id is not None:
            return TestExport._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestExport._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestExport._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestExport._experiment_id

    def test_export_returns_file(self):
        """POST /api/files/{id}/export returns 200, a gzip file with magic bytes 1f 8b, and a valid SQLite DB inside."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            response = client.post(f"/api/files/{exp_id}/export")
            assert response.status_code == 200, response.text
            assert "gzip" in response.headers.get("content-type", "").lower(), \
                f"expected gzip content-type, got {response.headers.get('content-type')}"
            body = response.content
            assert len(body) > 0, "response body is empty"
            assert body[:2] == b"\x1f\x8b", f"expected gzip magic bytes 1f 8b, got {body[:2].hex()}"

            tmp = _save_export_bytes(body)
            try:
                reader = _open_astra(tmp.name)
                tables = reader.list_tables()
                assert "WExperiment" in tables, "exported file is not a valid .afe8 (no WExperiment table)"
                assert "WBaseline" in tables
                assert "WPeakRange" in tables
                reader.close()
            finally:
                os.unlink(tmp.name)

    def test_round_trip_baselines_preserved(self):
        """PUT a baseline on a detector whose name matches an existing WBaseline.m_sSeriesName, export, re-read, and assert the WBaseline row was updated and WPeakRange is unchanged vs. a pre-update export."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            original_reader = _open_astra(TEST_FILE)
            try:
                orig_baselines = original_reader.get_table_as_dicts("WBaseline")
                series_name = orig_baselines[0]["m_sSeriesName"]
            finally:
                original_reader.close()

            before_export = client.post(f"/api/files/{exp_id}/export")
            assert before_export.status_code == 200, before_export.text
            before_tmp = _save_export_bytes(before_export.content)
            try:
                before_reader = _open_astra(before_tmp.name)
                try:
                    before_peaks = before_reader.get_table_as_dicts("WPeakRange")
                finally:
                    before_reader.close()

                put_resp = client.put(
                    f"/api/experiments/{exp_id}/baselines/{series_name}",
                    json={
                        "detector_name": series_name,
                        "baseline_type": 1,
                        "x1": 5.0,
                        "x2": 15.0,
                        "y1": 0.001,
                        "y2": 0.002,
                        "is_auto": False,
                    },
                )
                assert put_resp.status_code in (200, 201), put_resp.text

                export_resp = client.post(f"/api/files/{exp_id}/export")
                assert export_resp.status_code == 200, export_resp.text
                tmp = _save_export_bytes(export_resp.content)
                try:
                    reader = _open_astra(tmp.name)
                    try:
                        rows = reader.get_table_as_dicts("WBaseline")
                        target = next(
                            (r for r in rows if r["m_sSeriesName"] == series_name), None,
                        )
                        assert target is not None, f"WBaseline row for '{series_name}' not found in export"
                        assert target["m_nBaselineType"] == 1, \
                            f"m_nBaselineType mismatch: {target['m_nBaselineType']} != 1"
                        assert abs(target["m_dX1"] - 5.0) < 1e-9, \
                            f"m_dX1 mismatch: {target['m_dX1']} != 5.0"
                        assert abs(target["m_dX2"] - 15.0) < 1e-9, \
                            f"m_dX2 mismatch: {target['m_dX2']} != 15.0"
                        assert abs(target["m_dY1"] - 0.001) < 1e-9, \
                            f"m_dY1 mismatch: {target['m_dY1']} != 0.001"
                        assert abs(target["m_dY2"] - 0.002) < 1e-9, \
                            f"m_dY2 mismatch: {target['m_dY2']} != 0.002"

                        new_peaks = reader.get_table_as_dicts("WPeakRange")
                        assert len(new_peaks) == len(before_peaks), \
                            f"WPeakRange row count changed: {len(new_peaks)} != {len(before_peaks)}"
                        before_by_num = {r["rangeNumber"]: r for r in before_peaks}
                        new_by_num = {r["rangeNumber"]: r for r in new_peaks}
                        for rn, before_row in before_by_num.items():
                            new_row = new_by_num.get(rn)
                            assert new_row is not None, f"WPeakRange rangeNumber {rn} missing in export"
                            assert abs(new_row["rangeStart"] - before_row["rangeStart"]) < 1e-9, \
                                f"rangeStart changed for rangeNumber {rn}"
                            assert abs(new_row["rangeEnd"] - before_row["rangeEnd"]) < 1e-9, \
                                f"rangeEnd changed for rangeNumber {rn}"
                            assert abs(new_row["m_dDNDC"] - before_row["m_dDNDC"]) < 1e-9, \
                                f"m_dDNDC changed for rangeNumber {rn}"
                    finally:
                        reader.close()
                finally:
                    os.unlink(tmp.name)
            finally:
                os.unlink(before_tmp.name)

    def test_round_trip_peaks_preserved(self):
        """PUT a peak with range_number=1, export, re-read, and assert the WPeakRange row was updated and WBaseline is unchanged vs. a pre-update export."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            before_export = client.post(f"/api/files/{exp_id}/export")
            assert before_export.status_code == 200, before_export.text
            before_tmp = _save_export_bytes(before_export.content)
            try:
                before_reader = _open_astra(before_tmp.name)
                try:
                    before_baselines = before_reader.get_table_as_dicts("WBaseline")
                finally:
                    before_reader.close()

                list_resp = client.get(f"/api/experiments/{exp_id}/peaks")
                assert list_resp.status_code == 200, list_resp.text
                peaks = list_resp.json()["peaks"]
                target_peak = next((p for p in peaks if p.get("range_number") == 1), None)
                assert target_peak is not None, "No peak with range_number=1 found in DB; import may have failed"

                upd_resp = client.put(
                    f"/api/experiments/{exp_id}/peaks/{target_peak['id']}",
                    json={
                        "range_start": 7.5,
                        "range_end": 9.5,
                        "dn_dc": 0.190,
                    },
                )
                assert upd_resp.status_code in (200, 201), upd_resp.text

                export_resp = client.post(f"/api/files/{exp_id}/export")
                assert export_resp.status_code == 200, export_resp.text
                tmp = _save_export_bytes(export_resp.content)
                try:
                    reader = _open_astra(tmp.name)
                    try:
                        rows = reader.get_table_as_dicts("WPeakRange")
                        target = next(
                            (r for r in rows if r["rangeNumber"] == 1), None,
                        )
                        assert target is not None, "WPeakRange row with rangeNumber=1 not found in export"
                        assert abs(target["rangeStart"] - 7.5) < 1e-9, \
                            f"rangeStart mismatch: {target['rangeStart']} != 7.5"
                        assert abs(target["rangeEnd"] - 9.5) < 1e-9, \
                            f"rangeEnd mismatch: {target['rangeEnd']} != 9.5"
                        assert abs(target["m_dDNDC"] - 0.190) < 1e-9, \
                            f"m_dDNDC mismatch: {target['m_dDNDC']} != 0.190"

                        new_baselines = reader.get_table_as_dicts("WBaseline")
                        assert len(new_baselines) == len(before_baselines), \
                            f"WBaseline row count changed: {len(new_baselines)} != {len(before_baselines)}"
                        before_by_name = {r["m_sSeriesName"]: r for r in before_baselines}
                        new_by_name = {r["m_sSeriesName"]: r for r in new_baselines}
                        for name, before_row in before_by_name.items():
                            new_row = new_by_name.get(name)
                            assert new_row is not None, f"WBaseline '{name}' missing in export"
                            assert abs(new_row["m_dX1"] - before_row["m_dX1"]) < 1e-9, \
                                f"m_dX1 changed for '{name}'"
                            assert abs(new_row["m_dX2"] - before_row["m_dX2"]) < 1e-9, \
                                f"m_dX2 changed for '{name}'"
                    finally:
                        reader.close()
                finally:
                    os.unlink(tmp.name)
            finally:
                os.unlink(before_tmp.name)

    def test_round_trip_other_tables_byte_identical(self):
        """Export without modifications and assert untouched tables have matching row counts and key values."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            export_resp = client.post(f"/api/files/{exp_id}/export")
            assert export_resp.status_code == 200, export_resp.text
            tmp = _save_export_bytes(export_resp.content)
            try:
                orig_reader = _open_astra(TEST_FILE)
                new_reader = _open_astra(tmp.name)
                try:
                    check_tables = [
                        "WExperiment",
                        "WVectorData",
                        "WHeleos8Profile",
                        "WInjectedSampleProfile",
                    ]
                    for table in check_tables:
                        orig_rows = orig_reader.get_table_as_dicts(table)
                        new_rows = new_reader.get_table_as_dicts(table)
                        assert len(new_rows) == len(orig_rows), \
                            f"{table} row count mismatch: {len(new_rows)} != {len(orig_rows)}"
                        if table == "WExperiment":
                            assert len(orig_rows) >= 1
                            orig = orig_rows[0]
                            new = new_rows[0]
                            assert orig.get("path") == new.get("path"), \
                                f"WExperiment.path mismatch: {new.get('path')} != {orig.get('path')}"
                            assert orig.get("m_sSampleSetFileName") == new.get("m_sSampleSetFileName"), \
                                "WExperiment.m_sSampleSetFileName mismatch"
                        if table == "WHeleos8Profile":
                            assert len(orig_rows) >= 1
                            orig = orig_rows[0]
                            new = new_rows[0]
                            assert orig.get("m_sName") == new.get("m_sName"), \
                                "WHeleos8Profile.m_sName mismatch"
                            assert abs((new.get("m_dWavelength") or 0) - (orig.get("m_dWavelength") or 0)) < 1e-9, \
                                "WHeleos8Profile.m_dWavelength mismatch"
                        if table == "WInjectedSampleProfile":
                            assert len(orig_rows) >= 1
                            orig = orig_rows[0]
                            new = new_rows[0]
                            assert orig.get("m_sName") == new.get("m_sName"), \
                                "WInjectedSampleProfile.m_sName mismatch"
                            assert abs((new.get("m_dDNDC") or 0) - (orig.get("m_dDNDC") or 0)) < 1e-9, \
                                "WInjectedSampleProfile.m_dDNDC mismatch"
                finally:
                    orig_reader.close()
                    new_reader.close()
            finally:
                os.unlink(tmp.name)

    def test_export_missing_experiment_404(self):
        """POST /api/files/999999/export returns 404."""
        with TestClient(app) as client:
            response = client.post("/api/files/999999/export")
            assert response.status_code == 404, response.text
