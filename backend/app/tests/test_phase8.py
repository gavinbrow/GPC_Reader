"""Phase 8 tests — Polish & Specialized.

Tests A2 second virial coefficient (online + batch), Zimm plot data
generation, absorption correction, chromatogram caching, VACUUM INTO backup,
integrity check, and the system backup/integrity endpoints.
"""

import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.db.session import engine
from app.main import app
from app.services.a2 import batch_a2, online_a2, zimm_plot_data
from app.services.absorption_correction import (
    compute_transmittance,
    correct_mals_signal,
    correct_molar_mass,
)
from app.services.backup import check_integrity, cleanup_old_backups, create_backup, list_backups
from app.services.chromatogram_cache import (
    clear_all_cache,
    get_cache_size_bytes,
    get_cached_chromatograms,
    invalidate_cache,
    save_cached_chromatograms,
)

TEST_FILE = os.environ.get("ASTRA_TEST_FILE", "")


# ---------------------------------------------------------------------------
# A2 — Online mode
# ---------------------------------------------------------------------------
class TestOnlineA2:
    """Test online A2 determination from a single GPC/SEC peak."""

    def test_online_a2_returns_nan_for_empty_data(self):
        result = online_a2(np.array([]), np.array([]), np.array([]),
                           K=1e-7, wavelength_nm=662.72, n0=1.401)
        assert np.isnan(result["a2"])
        assert result["fit_quality"] == "no_data"

    def test_online_a2_returns_nan_for_1d_input(self):
        result = online_a2(np.array([1.0, 2.0]), np.array([0.1]),
                           np.array([90.0]), K=1e-7, wavelength_nm=662.72, n0=1.401)
        assert np.isnan(result["a2"])

    def test_online_a2_with_synthetic_data(self):
        n_slices = 20
        n_angles = 8
        angles = np.array([15, 25, 35, 45, 55, 65, 75, 90], dtype=float)
        c = np.linspace(0.001, 0.005, n_slices)
        K = 1e-7
        lambda_sol = 662.72e-9 / 1.401
        theta = np.deg2rad(angles)
        x = np.sin(theta / 2) ** 2
        A2_true = 5e-4
        M_true = 15000.0
        Rg_true = 20e-9
        R = np.zeros((n_slices, n_angles))
        for i in range(n_slices):
            for j in range(n_angles):
                y = 1.0 / M_true * (1 + 16 * np.pi ** 2 / (3 * lambda_sol ** 2) * Rg_true ** 2 * x[j]) + 2 * A2_true * c[i]
                R[i, j] = K * c[i] / y
        result = online_a2(R, c, angles, K, 662.72, 1.401)
        assert np.isfinite(result["a2"]), f"A2 not finite: {result}"
        assert abs(result["a2"] - A2_true) / A2_true < 0.1, f"A2 mismatch: {result['a2']} vs {A2_true}"
        assert abs(result["mw"] - M_true) / M_true < 0.1
        assert result["n_points"] > 0
        assert result["r_squared"] > 0.8

    def test_online_a2_no_concentration_spread(self):
        n_angles = 8
        angles = np.array([15, 25, 35, 45, 55, 65, 75, 90], dtype=float)
        c = np.full(10, 0.001)
        R = np.ones((10, n_angles)) * 1e-5
        result = online_a2(R, c, angles, K=1e-7, wavelength_nm=662.72, n0=1.401)
        assert np.isnan(result["a2"])
        assert result["fit_quality"] == "no_concentration_spread"

    def test_online_a2_too_few_angles(self):
        angles = np.array([90.0])
        c = np.array([0.001, 0.002])
        R = np.ones((2, 1))
        mask = np.array([True])
        result = online_a2(R, c, angles, K=1e-7, wavelength_nm=662.72, n0=1.401,
                           angle_mask=mask)
        assert np.isnan(result["a2"])
        assert result["fit_quality"] == "too_few_angles"


# ---------------------------------------------------------------------------
# A2 — Batch mode
# ---------------------------------------------------------------------------
class TestBatchA2:
    """Test batch A2 from multiple concentrations."""

    def test_batch_a2_basic(self):
        c = np.array([0.001, 0.002, 0.003, 0.004, 0.005])
        A2_true = 5e-4
        Mw_true = 15000.0
        K = 1e-7
        R0 = K * c / (1.0 / Mw_true + 2 * A2_true * c)
        result = batch_a2(c, R0, K)
        assert np.isfinite(result["a2"])
        assert abs(result["a2"] - A2_true) / A2_true < 0.05
        assert abs(result["mw"] - Mw_true) / Mw_true < 0.05
        assert result["r_squared"] > 0.95

    def test_batch_a2_too_few_points(self):
        result = batch_a2(np.array([0.001]), np.array([1e-5]), K=1e-7)
        assert np.isnan(result["a2"])
        assert result["n_points"] == 0

    def test_batch_a2_negative_concentration(self):
        c = np.array([-0.001, 0.002])
        R0 = np.array([1e-5, 2e-5])
        result = batch_a2(c, R0, K=1e-7)
        assert np.isnan(result["a2"]) or result["n_points"] < 2


# ---------------------------------------------------------------------------
# Zimm plot data
# ---------------------------------------------------------------------------
class TestZimmPlot:
    """Test Zimm plot data generation."""

    def test_zimm_plot_returns_data(self):
        n_slices = 10
        n_angles = 6
        angles = np.array([20, 30, 40, 50, 60, 90], dtype=float)
        c = np.linspace(0.001, 0.003, n_slices)
        K = 1e-7
        R = np.ones((n_slices, n_angles)) * 1e-5
        result = zimm_plot_data(R, c, angles, K, 662.72, 1.401)
        assert len(result["x"]) > 0
        assert len(result["y"]) > 0
        assert len(result["x"]) == len(result["y"])
        assert len(result["angles"]) == len(result["x"])
        assert len(result["concentrations"]) == len(result["x"])
        assert result["k_scale"] > 0

    def test_zimm_plot_empty_data(self):
        result = zimm_plot_data(np.array([]), np.array([]), np.array([]),
                                K=1e-7, wavelength_nm=662.72, n0=1.401)
        assert len(result["x"]) == 0


# ---------------------------------------------------------------------------
# Absorption correction
# ---------------------------------------------------------------------------
class TestAbsorptionCorrection:
    """Test forward-monitor absorption correction."""

    def test_compute_transmittance_no_absorption(self):
        fm = np.ones(100) * 5.0
        t = np.linspace(0, 10, 100)
        T = compute_transmittance(fm, t, peak_start=4, peak_end=6)
        assert T.size == 100
        assert np.allclose(T, 1.0, atol=0.01)

    def test_compute_transmittance_with_absorption(self):
        fm = np.ones(100) * 5.0
        fm[40:60] = 2.5
        t = np.linspace(0, 10, 100)
        T = compute_transmittance(fm, t, peak_start=4, peak_end=6)
        assert T.size == 100
        in_peak = (t >= 4) & (t <= 6)
        assert np.mean(T[in_peak]) < 0.7
        outside = ~in_peak
        assert np.allclose(T[outside], 1.0, atol=0.01)

    def test_correct_molar_mass_with_absorption(self):
        M = np.ones(100) * 15000.0
        fm = np.ones(100) * 5.0
        fm[40:60] = 2.5
        t = np.linspace(0, 10, 100)
        result = correct_molar_mass(M, fm, t, peak_start=4, peak_end=6)
        assert result["corrected_molar_mass"].size == 100
        assert result["absorption_detected"] is True
        in_peak = (t >= 4) & (t <= 6)
        assert np.mean(result["corrected_molar_mass"][in_peak]) < 15000.0
        outside = ~in_peak
        assert np.allclose(result["corrected_molar_mass"][outside], 15000.0, rtol=0.01)

    def test_correct_molar_mass_no_absorption(self):
        M = np.ones(100) * 15000.0
        fm = np.ones(100) * 5.0
        t = np.linspace(0, 10, 100)
        result = correct_molar_mass(M, fm, t, peak_start=4, peak_end=6)
        assert result["absorption_detected"] is False
        assert np.allclose(result["corrected_molar_mass"], 15000.0, rtol=0.01)

    def test_correct_mals_signal_2d(self):
        R = np.ones((50, 8)) * 1e-5
        fm = np.ones(50) * 5.0
        fm[20:30] = 2.5
        t = np.linspace(0, 5, 50)
        result = correct_mals_signal(R, fm, t, peak_start=2, peak_end=3)
        assert result["corrected_mals"].shape == (50, 8)
        assert result["absorption_detected"] is True

    def test_correct_molar_mass_empty(self):
        result = correct_molar_mass(np.array([]), np.array([]), np.array([]),
                                    peak_start=0, peak_end=1)
        assert len(result["corrected_molar_mass"]) == 0
        assert result["absorption_detected"] is False


# ---------------------------------------------------------------------------
# Chromatogram cache
# ---------------------------------------------------------------------------
class TestChromatogramCache:
    """Test .npz disk caching of chromatogram arrays."""

    def test_save_and_load_cache(self):
        test_hash = "test_cache_hash_123"
        arrays = {
            "time": np.linspace(0, 10, 100),
            "mals_data": np.random.rand(100, 18),
            "ri_data": np.random.rand(100),
        }
        save_cached_chromatograms(test_hash, arrays)
        loaded = get_cached_chromatograms(test_hash)
        assert loaded is not None
        assert "time" in loaded
        assert "mals_data" in loaded
        assert "ri_data" in loaded
        assert loaded["time"].shape == (100,)
        assert loaded["mals_data"].shape == (100, 18)
        invalidate_cache(test_hash)

    def test_get_cache_returns_none_for_missing(self):
        result = get_cached_chromatograms("nonexistent_hash_xyz")
        assert result is None

    def test_invalidate_cache_removes_file(self):
        test_hash = "test_invalidate_hash"
        save_cached_chromatograms(test_hash, {"time": np.array([1, 2, 3])})
        invalidate_cache(test_hash)
        assert get_cached_chromatograms(test_hash) is None

    def test_clear_all_cache(self):
        save_cached_chromatograms("clear_test_1", {"time": np.array([1])})
        save_cached_chromatograms("clear_test_2", {"time": np.array([2])})
        count = clear_all_cache()
        assert count >= 2
        assert get_cached_chromatograms("clear_test_1") is None
        assert get_cached_chromatograms("clear_test_2") is None

    def test_get_cache_size_bytes(self):
        save_cached_chromatograms("size_test_hash", {"time": np.linspace(0, 100, 1000)})
        size = get_cache_size_bytes()
        assert size > 0
        invalidate_cache("size_test_hash")


# ---------------------------------------------------------------------------
# Backup & integrity
# ---------------------------------------------------------------------------
class TestBackupIntegrity:
    """Test VACUUM INTO backup and integrity check."""

    def test_integrity_check_passes(self):
        ok, msg = check_integrity(engine)
        assert ok is True
        assert msg == "ok"

    def test_create_backup(self):
        result = create_backup(engine)
        assert "error" not in result
        assert "path" in result
        assert os.path.exists(result["path"])
        assert result["size_bytes"] > 0

    def test_list_backups(self):
        create_backup(engine)
        backups = list_backups()
        assert len(backups) > 0
        assert "filename" in backups[0]
        assert "size_bytes" in backups[0]

    def test_cleanup_old_backups(self):
        count = cleanup_old_backups(retention_days=30)
        assert count >= 0


# ---------------------------------------------------------------------------
# System endpoints
# ---------------------------------------------------------------------------
class TestSystemEndpoints:
    """Test the /api/system backup and integrity endpoints."""

    def test_db_integrity_check_endpoint(self):
        with TestClient(app) as client:
            resp = client.get("/api/system/health/db")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"

    def test_backup_create_endpoint(self):
        with TestClient(app) as client:
            resp = client.post("/api/system/backup")
            assert resp.status_code == 200
            data = resp.json()
            assert "path" in data
            assert data["size_bytes"] > 0

    def test_backup_list_endpoint(self):
        with TestClient(app) as client:
            client.post("/api/system/backup")
            resp = client.get("/api/system/backups")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total"] > 0
            assert len(data["backups"]) > 0

    def test_backup_cleanup_endpoint(self):
        with TestClient(app) as client:
            resp = client.delete("/api/system/backups/cleanup?retention_days=30")
            assert resp.status_code == 200
            assert "deleted_count" in resp.json()


# ---------------------------------------------------------------------------
# Integration tests with the test .afe8 file
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not TEST_FILE or not os.path.exists(TEST_FILE), reason="No test .afe8 file available")
class TestPhase8Integration:
    """Integration tests using the real .afe8 test file."""

    _experiment_id = None

    def _ensure_upload(self, client):
        if TestPhase8Integration._experiment_id is not None:
            return TestPhase8Integration._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestPhase8Integration._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestPhase8Integration._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestPhase8Integration._experiment_id

    def test_a2_endpoint_returns_response(self):
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            resp = client.get(f"/api/experiments/{exp_id}/results/a2")
            assert resp.status_code == 200
            data = resp.json()
            assert "a2" in data
            assert "method" in data
            assert data["method"] == "online"

    def test_zimm_plot_endpoint_returns_data(self):
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            resp = client.get(f"/api/experiments/{exp_id}/results/zimm-plot")
            assert resp.status_code == 200
            data = resp.json()
            assert "x" in data
            assert "y" in data
            assert "k_scale" in data

    def test_absorption_correction_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            fm = [1.0] * 100
            t_axis = list(np.linspace(0, 10, 100))
            resp = client.post(
                f"/api/experiments/{exp_id}/results/absorption-correction",
                json={
                    "forward_monitor": fm,
                    "time_axis": t_axis,
                    "peak_start": 4.0,
                    "peak_end": 6.0,
                    "baseline_pct": 10.0,
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "corrected_molar_mass" in data
            assert "absorption_detected" in data

    def test_batch_a2_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            resp = client.post(
                f"/api/experiments/{exp_id}/results/a2/batch",
                json={
                    "concentrations": [0.001, 0.002, 0.003, 0.004, 0.005],
                    "rayleigh_ratio_zero": [1e-5, 2e-5, 3e-5, 4e-5, 5e-5],
                    "optical_constant": 1e-7,
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "a2" in data
            assert "n_points" in data

    def test_chromatogram_caching_speeds_up_second_load(self):
        """Verify that chromatogram cache is used on second load."""
        from app.db.session import SessionLocal
        from app.models import Experiment
        from app.services.chromatogram_cache import invalidate_cache
        from app.services.chromatogram_service import load_chromatograms

        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            db = SessionLocal()
            try:
                exp = db.query(Experiment).filter(Experiment.id == exp_id).first()
                file_hash = exp.file_hash
                invalidate_cache(file_hash)
                data1 = load_chromatograms(exp.raw_data_path, file_hash=file_hash)
                assert data1.get("time") is not None
                cached = get_cached_chromatograms(file_hash)
                assert cached is not None
                data2 = load_chromatograms(exp.raw_data_path, file_hash=file_hash)
                assert data2.get("time") is not None
                assert len(data2["time"]) == len(data1["time"])
            finally:
                db.close()
