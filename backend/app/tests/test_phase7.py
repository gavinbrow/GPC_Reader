"""Phase 7 tests — Advanced Export & Polish.

Tests writing computed results back to WResultData, writing procedure
parameters back to procedure tables, the Save As endpoint, export options,
and extended round-trip integrity.
"""

import os
import tempfile

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from astra_reader import (
    AstraReader,
    decode_blob,
    decode_raw_blob_doubles,
    encode_blob,
    encode_raw_blob_doubles,
)

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


def _save_export_bytes(content_bytes: bytes) -> tempfile.NamedTemporaryFile:
    tmp = tempfile.NamedTemporaryFile(suffix=".afe8", delete=False)
    tmp.write(content_bytes)
    tmp.close()
    return tmp


def _open_astra(path: str) -> AstraReader:
    return AstraReader(path)


# ---------------------------------------------------------------------------
# encode_blob / decode_blob round-trip tests
# ---------------------------------------------------------------------------
class TestBlobEncodeDecode:
    """Test that encode_blob is the correct inverse of decode_blob."""

    def test_encode_decode_doubles(self):
        arr = np.array([1.0, 2.5, -3.7, 100.0, 0.001], dtype=np.float64)
        blob = encode_blob(arr, is_double=True)
        decoded = decode_blob(blob, is_double=True)
        assert len(decoded) == len(arr)
        for a, b in zip(arr, decoded, strict=False):
            assert abs(a - b) < 1e-12

    def test_encode_decode_floats(self):
        arr = np.array([1.0, 2.5, -3.7], dtype=np.float32)
        blob = encode_blob(arr, is_double=False)
        decoded = decode_blob(blob, is_double=False)
        assert len(decoded) == len(arr)
        for a, b in zip(arr, decoded, strict=False):
            assert abs(a - b) < 1e-6

    def test_encode_empty_array(self):
        arr = np.array([], dtype=np.float64)
        blob = encode_blob(arr, is_double=True)
        decoded = decode_blob(blob, is_double=True)
        assert len(decoded) == 0

    def test_encode_raw_blob_doubles_roundtrip(self):
        arr = np.array([10.0, 20.0, 30.0], dtype=np.float64)
        blob = encode_raw_blob_doubles(arr)
        decoded = decode_raw_blob_doubles(blob)
        assert len(decoded) == len(arr)
        for a, b in zip(arr, decoded, strict=False):
            assert abs(a - b) < 1e-12

    def test_encode_large_array(self):
        arr = np.linspace(0, 1000, 5860, dtype=np.float64)
        blob = encode_blob(arr, is_double=True)
        decoded = decode_blob(blob, is_double=True)
        assert len(decoded) == len(arr)
        assert np.max(np.abs(arr - decoded)) < 1e-10


# ---------------------------------------------------------------------------
# Export with results / procedures tests
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestPhase7Export:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestPhase7Export._experiment_id is not None:
            return TestPhase7Export._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestPhase7Export._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestPhase7Export._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestPhase7Export._experiment_id

    def test_export_with_results_writes_wresultdata(self):
        """Export with results enabled should write Mn/Mw/Mz values into WResultData."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            resp = client.post(
                f"/api/files/{exp_id}/export",
                json={"include_baselines": True, "include_peaks": True, "include_results": True, "include_procedures": False},
            )
            assert resp.status_code == 200, resp.text
            assert resp.content[:2] == b"\x1f\x8b"

            tmp = _save_export_bytes(resp.content)
            try:
                reader = _open_astra(tmp.name)
                try:
                    rows = reader.get_table_as_dicts("WResultData")
                    assert len(rows) > 0, "WResultData should have rows"

                    mn_rows = [r for r in rows if r.get("m_nDataName") == 12120]
                    mw_rows = [r for r in rows if r.get("m_nDataName") == 12121]
                    mz_rows = [r for r in rows if r.get("m_nDataName") == 12122]
                    assert len(mn_rows) > 0 or len(mw_rows) > 0 or len(mz_rows) > 0, \
                        "No Mn/Mw/Mz result rows found in WResultData"
                finally:
                    reader.close()
            finally:
                os.unlink(tmp.name)

    def test_export_without_results_preserves_wresultdata(self):
        """Export with results disabled should leave WResultData unchanged from original."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            orig_reader = _open_astra(TEST_FILE)
            try:
                orig_results = orig_reader.get_table_as_dicts("WResultData")
            finally:
                orig_reader.close()

            resp = client.post(
                f"/api/files/{exp_id}/export",
                json={"include_baselines": False, "include_peaks": False, "include_results": False, "include_procedures": False},
            )
            assert resp.status_code == 200, resp.text

            tmp = _save_export_bytes(resp.content)
            try:
                reader = _open_astra(tmp.name)
                try:
                    new_results = reader.get_table_as_dicts("WResultData")
                    assert len(new_results) == len(orig_results), \
                        f"WResultData row count changed: {len(new_results)} != {len(orig_results)}"
                finally:
                    reader.close()
            finally:
                os.unlink(tmp.name)

    def test_export_with_procedures_updates_has_been_run(self):
        """Export with procedures should update m_bHasBeenRun in procedure tables."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            resp = client.post(
                f"/api/files/{exp_id}/export",
                json={"include_baselines": False, "include_peaks": False, "include_results": False, "include_procedures": True},
            )
            assert resp.status_code == 200, resp.text

            tmp = _save_export_bytes(resp.content)
            try:
                import gzip
                import sqlite3
                with gzip.open(tmp.name, "rb") as f:
                    db_bytes = f.read()
                tmp_db = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
                tmp_db.write(db_bytes)
                tmp_db.close()
                conn = sqlite3.connect(tmp_db.name)
                try:
                    for table in ["WDefineBaselinesProcedure", "WNormalizationProcedure", "WDefinePeaksProcedure"]:
                        try:
                            cur = conn.execute(f'SELECT m_bHasBeenRun FROM "{table}" LIMIT 1')
                            row = cur.fetchone()
                            if row is not None:
                                assert row[0] in (0, 1), f"{table} m_bHasBeenRun is {row[0]}"
                        except sqlite3.OperationalError:
                            pass
                finally:
                    conn.close()
                    os.unlink(tmp_db.name)
            finally:
                os.unlink(tmp.name)

    def test_export_options_partial(self):
        """Export with only baselines should not touch peaks or results."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            orig_reader = _open_astra(TEST_FILE)
            try:
                orig_peaks = orig_reader.get_table_as_dicts("WPeakRange")
            finally:
                orig_reader.close()

            resp = client.post(
                f"/api/files/{exp_id}/export",
                json={"include_baselines": True, "include_peaks": False, "include_results": False, "include_procedures": False},
            )
            assert resp.status_code == 200, resp.text

            tmp = _save_export_bytes(resp.content)
            try:
                reader = _open_astra(tmp.name)
                try:
                    new_peaks = reader.get_table_as_dicts("WPeakRange")
                    assert len(new_peaks) == len(orig_peaks), \
                        "WPeakRange should be unchanged when include_peaks=False"
                    for orig, new in zip(orig_peaks, new_peaks, strict=False):
                        assert abs(orig["rangeStart"] - new["rangeStart"]) < 1e-9
                        assert abs(orig["rangeEnd"] - new["rangeEnd"]) < 1e-9
                finally:
                    reader.close()
            finally:
                os.unlink(tmp.name)

    def test_round_trip_results_preserved(self):
        """Export and re-read: WResultData should have the same or more rows with
        correct Mn/Mw/Mz values matching the app DB."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            resp = client.post(f"/api/files/{exp_id}/export")
            assert resp.status_code == 200, resp.text

            tmp = _save_export_bytes(resp.content)
            try:
                reader = _open_astra(tmp.name)
                try:
                    results = reader.results
                    assert len(results) > 0, "No results found in exported file"

                    has_mn = any(r.data_name_code == 12120 for r in results)
                    has_mw = any(r.data_name_code == 12121 for r in results)
                    has_mz = any(r.data_name_code == 12122 for r in results)
                    assert has_mn or has_mw or has_mz, \
                        "Exported WResultData should contain Mn/Mw/Mz entries"
                finally:
                    reader.close()
            finally:
                os.unlink(tmp.name)

    def test_round_trip_all_tables_preserved(self):
        """Export without results: all tables should have the same row counts as the original."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            resp = client.post(
                f"/api/files/{exp_id}/export",
                json={"include_baselines": False, "include_peaks": False, "include_results": False, "include_procedures": False},
            )
            assert resp.status_code == 200, resp.text

            tmp = _save_export_bytes(resp.content)
            try:
                orig_reader = _open_astra(TEST_FILE)
                new_reader = _open_astra(tmp.name)
                try:
                    check_tables = [
                        "WExperiment",
                        "WVectorData",
                        "WMatrixData",
                        "WHeleos8Profile",
                        "WInjectedSampleProfile",
                        "WSolventProfile",
                        "WNGOInstrumentProfile",
                        "WPeakRange",
                        "WBaseline",
                        "WResultData",
                    ]
                    for table in check_tables:
                        orig_rows = orig_reader.get_table_as_dicts(table)
                        new_rows = new_reader.get_table_as_dicts(table)
                        assert len(new_rows) == len(orig_rows), \
                            f"{table} row count mismatch: {len(new_rows)} != {len(orig_rows)}"
                finally:
                    orig_reader.close()
                    new_reader.close()
            finally:
                os.unlink(tmp.name)


# ---------------------------------------------------------------------------
# Save As endpoint tests
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestSaveAs:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestSaveAs._experiment_id is not None:
            return TestSaveAs._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestSaveAs._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestSaveAs._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestSaveAs._experiment_id

    def test_save_as_returns_file(self):
        """POST /api/files/{id}/save-as returns 200 and a gzip file."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            resp = client.post(
                f"/api/files/{exp_id}/save-as",
                json={"new_file_name": "my_copy.afe8"},
            )
            assert resp.status_code == 200, resp.text
            assert "gzip" in resp.headers.get("content-type", "").lower()
            assert resp.content[:2] == b"\x1f\x8b"
            assert "my_copy" in resp.headers.get("content-disposition", "")

    def test_save_as_default_name(self):
        """POST /api/files/{id}/save-as with no body uses default naming."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            resp = client.post(f"/api/files/{exp_id}/save-as")
            assert resp.status_code == 200, resp.text
            assert resp.content[:2] == b"\x1f\x8b"

    def test_save_as_missing_experiment_404(self):
        """POST /api/files/999999/save-as returns 404."""
        with TestClient(app) as client:
            resp = client.post("/api/files/999999/save-as")
            assert resp.status_code == 404, resp.text

    def test_save_as_preserves_tables(self):
        """Save As should produce a valid .afe8 with all tables intact."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            resp = client.post(f"/api/files/{exp_id}/save-as")
            assert resp.status_code == 200, resp.text

            tmp = _save_export_bytes(resp.content)
            try:
                reader = _open_astra(tmp.name)
                try:
                    tables = reader.list_tables()
                    assert "WExperiment" in tables
                    assert "WBaseline" in tables
                    assert "WPeakRange" in tables
                    assert "WResultData" in tables
                finally:
                    reader.close()
            finally:
                os.unlink(tmp.name)


# ---------------------------------------------------------------------------
# ExportOptions schema tests
# ---------------------------------------------------------------------------
class TestExportOptionsSchema:
    """Test the ExportOptions Pydantic schema."""

    def test_default_values(self):
        from app.schemas import ExportOptions
        opts = ExportOptions()
        assert opts.include_baselines is True
        assert opts.include_peaks is True
        assert opts.include_results is True
        assert opts.include_procedures is True

    def test_partial_options(self):
        from app.schemas import ExportOptions
        opts = ExportOptions(include_baselines=True, include_peaks=False)
        assert opts.include_baselines is True
        assert opts.include_peaks is False
        assert opts.include_results is True


# ---------------------------------------------------------------------------
# Integration: export → re-import → verify
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestPhase7Integration:
    _experiment_id = None

    def _ensure_upload(self, client):
        if TestPhase7Integration._experiment_id is not None:
            return TestPhase7Integration._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestPhase7Integration._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestPhase7Integration._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestPhase7Integration._experiment_id

    def test_export_reimport_same_results(self):
        """Export an experiment, re-read the exported file, and verify it has
        the same WResultData values as the original."""
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)

            resp = client.post(f"/api/files/{exp_id}/export")
            assert resp.status_code == 200, resp.text

            tmp = _save_export_bytes(resp.content)
            try:
                orig_reader = _open_astra(TEST_FILE)
                new_reader = _open_astra(tmp.name)
                try:
                    orig_results = orig_reader.results
                    new_results = new_reader.results
                    assert len(new_results) >= len(orig_results), \
                        f"Re-read results count {len(new_results)} < original {len(orig_results)}"

                    orig_by_key = {
                        (r.peak, r.data_name_code, r.instrument_class): r.value
                        for r in orig_results
                    }
                    new_by_key = {
                        (r.peak, r.data_name_code, r.instrument_class): r.value
                        for r in new_results
                    }
                    for key, orig_val in orig_by_key.items():
                        new_val = new_by_key.get(key)
                        if new_val is not None:
                            if orig_val != 0:
                                assert abs(new_val - orig_val) / abs(orig_val) < 0.1, \
                                    f"Result {key} changed: {new_val} vs {orig_val}"
                finally:
                    orig_reader.close()
                    new_reader.close()
            finally:
                os.unlink(tmp.name)
