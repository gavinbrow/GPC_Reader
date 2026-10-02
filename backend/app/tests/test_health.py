"""Test the /api/health endpoint."""

from fastapi.testclient import TestClient

from app.main import app


class TestHealth:
    def test_health_check(self):
        """GET /api/health should return 200 with status ok."""
        with TestClient(app) as client:
            response = client.get("/api/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert "version" in data
            assert data["database"] == "connected"
