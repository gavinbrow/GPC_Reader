"""Phase 3b tests: Debye/Berry fits, 2nd-order fits, KDE distributions,
band broadening, and angular fit quality metrics.

Unit tests (no ASTRA file needed) follow the synthetic-data conventions of
``test_engines.py``.  Integration tests (class ``TestPhase3bIntegration``)
require ``ASTRA_TEST_FILE`` and reuse the upload/auto-analyze pattern from
``test_procedures.py``.
"""

import os

import numpy as np
import pytest

from app.services.band_broadening import apply_band_broadening_correction
from app.services.distributions import KDE_FALLBACK_THRESHOLD, compute_distribution
from app.services.molar_mass import (
    berry_fit_per_slice,
    compute_molar_mass,
    debye_fit_per_slice,
    optical_constant,
    zimm_fit_per_slice,
)


def _synthetic_setup():
    n0 = 1.401
    dn_dc = 0.185
    wavelength_nm = 658.0
    K = optical_constant(n0, dn_dc, wavelength_nm)
    lambda_sol = (wavelength_nm * 1e-9) / n0
    angles = np.array([32.0, 44.0, 57.0, 72.0, 90.0, 108.0, 126.0, 141.0])
    theta_rad = np.deg2rad(angles)
    x = np.sin(theta_rad / 2) ** 2
    return n0, dn_dc, wavelength_nm, K, lambda_sol, angles, x


# ---------------------------------------------------------------------------
# Band broadening
# ---------------------------------------------------------------------------
class TestBandBroadening:
    def test_disabled_returns_input_unchanged(self):
        t = np.linspace(0, 10, 200)
        s = np.exp(-((t - 5) ** 2) / (2 * 0.3 ** 2))
        out = apply_band_broadening_correction(t, s, params={"enabled": False})
        assert np.allclose(out, s, equal_nan=True)

    def test_empty_input(self):
        out = apply_band_broadening_correction(np.array([]), np.array([]))
        assert out.size == 0

    def test_deconvolution_narrows_peak(self):
        n = 400
        t = np.linspace(0, 10, n)
        dt = float(t[1] - t[0])
        sigma_true = 0.08
        peak = np.exp(-((t - 5.0) ** 2) / (2 * sigma_true ** 2))
        tau_min = 0.10
        tau_samples = tau_min / dt
        half = n // 2
        idx = np.arange(n) - half
        kernel = np.exp(-np.abs(idx) / tau_samples)
        kernel /= kernel.sum()
        broadened = np.convolve(peak, kernel, mode="same")

        def _fwhm(sig):
            peak_val = np.max(sig)
            above = np.where(sig > 0.5 * peak_val)[0]
            if above.size < 2:
                return np.nan
            return float(t[above[-1]] - t[above[0]])

        fwhm_broad = _fwhm(broadened)
        deconv = apply_band_broadening_correction(
            t, broadened, params={"V_mixing": 0.10, "flow_rate": 1.0})
        fwhm_deconv = _fwhm(deconv)
        assert np.isfinite(fwhm_deconv)
        assert fwhm_deconv < fwhm_broad


# ---------------------------------------------------------------------------
# Debye fit
# ---------------------------------------------------------------------------
class TestDebyeFit:
    def test_recovers_known_M(self):
        n0, dn_dc, wavelength_nm, K, lambda_sol, angles, x = _synthetic_setup()
        M_true = 30000.0
        Rg_true = 15e-9
        c = 0.003
        P_form = 1.0 - (16.0 * np.pi ** 2 / (3.0 * lambda_sol ** 2)) * Rg_true ** 2 * x
        P_form = np.maximum(P_form, 0.01)
        R_theta = K * c * M_true * P_form
        m, rg = debye_fit_per_slice(R_theta, c, x, K, lambda_sol)
        assert abs(m - M_true) / M_true < 0.05
        if np.isfinite(rg):
            assert abs(rg - Rg_true) / Rg_true < 0.20

    def test_degenerate_returns_nan(self):
        R = np.array([0.0, 0.0, 0.0])
        x = np.array([0.1, 0.3, 0.5])
        m, rg = debye_fit_per_slice(R, 0.001, x, 1e-7, 5e-7)
        assert np.isnan(m)
        assert np.isnan(rg)

    def test_quality_metrics_returned(self):
        n0, dn_dc, wavelength_nm, K, lambda_sol, angles, x = _synthetic_setup()
        M_true = 30000.0
        c = 0.003
        R_theta = K * c * M_true * np.ones_like(x)
        m, rg, q = debye_fit_per_slice(R_theta, c, x, K, lambda_sol, return_quality=True)
        assert np.isfinite(q["chi2"])
        assert q["residuals"].shape[0] == x.size
        assert q["n_angles_used"] == x.size


# ---------------------------------------------------------------------------
# Berry fit
# ---------------------------------------------------------------------------
class TestBerryFit:
    def test_recovers_known_M(self):
        n0, dn_dc, wavelength_nm, K, lambda_sol, angles, x = _synthetic_setup()
        M_true = 30000.0
        Rg_true = 15e-9
        c = 0.003
        P_form = 1.0 - (16.0 * np.pi ** 2 / (3.0 * lambda_sol ** 2)) * Rg_true ** 2 * x
        P_form = np.maximum(P_form, 0.01)
        R_theta = K * c * M_true * P_form
        m, rg = berry_fit_per_slice(R_theta, c, x, K, lambda_sol)
        assert abs(m - M_true) / M_true < 0.10
        if np.isfinite(rg):
            assert abs(rg - Rg_true) / Rg_true < 0.30

    def test_degenerate_returns_nan(self):
        R = np.array([0.0, 0.0, 0.0])
        x = np.array([0.1, 0.3, 0.5])
        m, rg = berry_fit_per_slice(R, 0.001, x, 1e-7, 5e-7)
        assert np.isnan(m)
        assert np.isnan(rg)


# ---------------------------------------------------------------------------
# 2nd-order Zimm
# ---------------------------------------------------------------------------
class TestZimmSecondOrder:
    def test_recovers_M_with_curvature(self):
        n0, dn_dc, wavelength_nm, K, lambda_sol, angles, x = _synthetic_setup()
        M_true = 30000.0
        Rg_true = 15e-9
        c = 0.003
        a = 1.0 / M_true
        b = (16.0 * np.pi ** 2 / (3.0 * lambda_sol ** 2)) * Rg_true ** 2 / M_true
        curvature = 0.02 * b * np.max(x)
        y = a + b * x + curvature * x ** 2
        R_theta = K * c / y
        m1, rg1 = zimm_fit_per_slice(R_theta, c, x, K, lambda_sol, fit_degree=1)
        m2, rg2 = zimm_fit_per_slice(R_theta, c, x, K, lambda_sol, fit_degree=2)
        assert abs(m2 - M_true) / M_true < 0.10
        err1 = abs(m1 - M_true) / M_true
        err2 = abs(m2 - M_true) / M_true
        assert err2 <= err1 * 1.5


# ---------------------------------------------------------------------------
# KDE distribution
# ---------------------------------------------------------------------------
class TestKDEDistribution:
    def test_basic_kde(self):
        rng = np.random.default_rng(42)
        M = rng.lognormal(mean=np.log(30000.0), sigma=0.3, size=500)
        c = rng.uniform(0.001, 0.005, size=500)
        dist = compute_distribution(M, c, n_bins=40)
        assert dist["method"] == "kde"
        assert len(dist["bin_centers"]) > 0
        assert np.sum(dist["weights"]) > 0
        total_c = float(np.sum(c))
        assert abs(np.sum(dist["weights"]) - total_c) / total_c < 0.20
        cum = np.asarray(dist["cumulative"])
        assert cum.size > 0
        assert abs(cum[-1] - 1.0) < 0.05

    def test_binned_fallback_above_threshold(self):
        n = KDE_FALLBACK_THRESHOLD + 100
        rng = np.random.default_rng(7)
        M = rng.lognormal(mean=np.log(30000.0), sigma=0.3, size=n)
        c = rng.uniform(0.001, 0.005, size=n)
        dist = compute_distribution(M, c, n_bins=50)
        assert dist["method"] == "binned"
        assert len(dist["bin_centers"]) == 50

    def test_empty(self):
        dist = compute_distribution(np.array([]), np.array([]))
        assert len(dist["bin_centers"]) == 0


# ---------------------------------------------------------------------------
# Angular fit quality via compute_molar_mass
# ---------------------------------------------------------------------------
class TestAngularFitQuality:
    def test_quality_arrays_present_and_finite(self):
        n0, dn_dc, wavelength_nm, K, lambda_sol, angles, x = _synthetic_setup()
        n_slices = 12
        M_true = 30000.0
        Rg_true = 15e-9
        c = np.full(n_slices, 0.003)
        P_form = 1.0 - (16.0 * np.pi ** 2 / (3.0 * lambda_sol ** 2)) * Rg_true ** 2 * x
        P_form = np.maximum(P_form, 0.01)
        R_theta = np.empty((n_slices, x.size))
        for i in range(n_slices):
            R_theta[i] = K * c[i] * M_true * P_form
        result = compute_molar_mass(R_theta, c, angles, n0, dn_dc, wavelength_nm,
                                    fit_model=0, fit_degree=1, return_quality=True)
        assert "chi2" in result
        assert "residuals" in result
        assert "n_angles_used" in result
        chi2 = np.asarray(result["chi2"])
        assert chi2.shape == (n_slices,)
        finite_chi2 = chi2[np.isfinite(chi2)]
        assert finite_chi2.size > 0
        assert np.all(finite_chi2 >= 0)
        resid_list = result["residuals"]
        assert len(resid_list) == n_slices
        n_used = np.asarray(result["n_angles_used"])
        assert np.all(n_used >= 0)
        assert n_used.max() >= 2

    def test_default_zimm_first_order_unchanged(self):
        n0, dn_dc, wavelength_nm, K, lambda_sol, angles, x = _synthetic_setup()
        n_slices = 8
        M_true = 30000.0
        c = np.full(n_slices, 0.003)
        P_form = 1.0 - (16.0 * np.pi ** 2 / (3.0 * lambda_sol ** 2)) * 15e-9 ** 2 * x
        P_form = np.maximum(P_form, 0.01)
        R_theta = np.empty((n_slices, x.size))
        for i in range(n_slices):
            R_theta[i] = K * c[i] * M_true * P_form
        res_default = compute_molar_mass(R_theta, c, angles, n0, dn_dc, wavelength_nm)
        res_explicit = compute_molar_mass(R_theta, c, angles, n0, dn_dc, wavelength_nm,
                                          fit_model=0, fit_degree=1)
        assert np.allclose(res_default["molar_mass"], res_explicit["molar_mass"],
                           equal_nan=True)
        assert res_default["fit_model"] == "zimm"
        assert res_default["fit_degree"] == 1


# ---------------------------------------------------------------------------
# Integration tests (require ASTRA test file)
# ---------------------------------------------------------------------------
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
class TestPhase3bIntegration:
    _experiment_id = None
    _analyzed = False

    def _ensure_upload(self, client):
        if TestPhase3bIntegration._experiment_id is not None:
            return TestPhase3bIntegration._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestPhase3bIntegration._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestPhase3bIntegration._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestPhase3bIntegration._experiment_id

    def _ensure_analyzed(self, client):
        exp_id = self._ensure_upload(client)
        if TestPhase3bIntegration._analyzed:
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
        TestPhase3bIntegration._analyzed = True
        return exp_id

    def test_zimm_first_order_regression(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.post(f"/api/experiments/{exp_id}/procedures/run")
            assert response.status_code == 200, response.text
            data = response.json()
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
            assert mn is not None
            assert mw is not None
            assert mz is not None
            assert pd is not None
            mn_err = abs(mn - EXPECTED["Mn"]) / EXPECTED["Mn"]
            mw_err = abs(mw - EXPECTED["Mw"]) / EXPECTED["Mw"]
            mz_err = abs(mz - EXPECTED["Mz"]) / EXPECTED["Mz"]
            pd_err = abs(pd - EXPECTED["Pd"]) / EXPECTED["Pd"]
            assert mn_err <= TOL_MN_MW_MZ, f"Mn {mn:.1f} err {mn_err*100:.2f}%"
            assert mw_err <= TOL_MN_MW_MZ, f"Mw {mw:.1f} err {mw_err*100:.2f}%"
            assert mz_err <= TOL_MN_MW_MZ, f"Mz {mz:.1f} err {mz_err*100:.2f}%"
            assert pd_err <= TOL_PD, f"Pd {pd:.4f} err {pd_err*100:.2f}%"

    def test_angular_fit_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/angular-fit")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1
            peak = data["peaks"][0]
            assert len(peak["chi2"]) > 0
            assert peak["fit_model"] == "zimm"
            assert peak["fit_degree"] == 1
            finite_chi2 = [v for v in peak["chi2"] if v is not None]
            assert len(finite_chi2) > 0

    def test_distributions_kde(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(
                f"/api/experiments/{exp_id}/results/distributions?bins=auto&smoothing=0")
            assert response.status_code == 200, response.text
            data = response.json()
            assert len(data) >= 1
            peak = data[0]
            assert len(peak["bin_centers"]) > 0
            assert peak["method"] in ("kde", "binned")

    def test_band_broadening_disabled_by_default(self):
        with TestClient(app) as client:
            exp_id = self._ensure_upload(client)
            client.post(f"/api/experiments/{exp_id}/auto-analyze")
            response = client.get(f"/api/experiments/{exp_id}/procedures")
            assert response.status_code == 200, response.text
            procs = response.json()["procedures"]
            bb = next((p for p in procs if p["procedure_name"] == "band_broadening"), None)
            assert bb is not None, "band_broadening procedure state missing"
            assert bb["is_enabled"] is False
