"""Test file upload endpoint.

These tests require a test .afe8 file.  Set the environment variable
``ASTRA_TEST_FILE`` to the path of a valid .afe8 file before running.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestUpload:
    def test_upload_file(self):
        """POST /api/files/upload should accept a valid .afe8 file."""
        with TestClient(app) as client:
            with open(TEST_FILE, "rb") as f:
                response = client.post(
                    "/api/files/upload",
                    files={"file": ("test.afe8", f, "application/gzip")},
                )
            # 201 on first upload, 400 on duplicate (dedup by file hash)
            assert response.status_code in (201, 400)
            data = response.json()
            if response.status_code == 201:
                assert "experiment_id" in data
                assert "file_hash" in data
                assert data["message"] == "File uploaded and parsed successfully"
            else:
                # duplicate — detail should mention already uploaded
                assert "already uploaded" in data.get("detail", "")

    def test_upload_invalid_file(self):
        """POST /api/files/upload should reject non-gzip files."""
        with TestClient(app) as client:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.txt", b"not a gzip file", "text/plain")},
            )
            assert response.status_code == 400

    def test_list_experiments(self):
        """GET /api/files should return a paginated list."""
        with TestClient(app) as client:
            response = client.get("/api/files?page=1&limit=10")
            assert response.status_code == 200
            data = response.json()
            assert "experiments" in data
            assert "total" in data
            assert "page" in data
            assert data["page"] == 1
