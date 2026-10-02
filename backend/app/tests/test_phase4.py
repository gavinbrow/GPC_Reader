"""Phase 4 tests: advanced analysis engine modules and their API routes.

Unit tests (no ASTRA file needed) exercise each engine with synthetic data
where the expected result is known analytically.  Integration tests (class
``TestPhase4Integration``) require ``ASTRA_TEST_FILE`` and reuse the
upload/auto-analyze pattern from ``test_procedures.py``.
"""

import os

import numpy as np
import pytest

from app.services.branching import compute_branching
from app.services.column_calibration import (
    apply_calibration,
    column_profile,
    fit_calibration_curve,
    resolution_between_peaks,
)
from app.services.conformation import compute_conformation
from app.services.conjugate import compute_conjugate
from app.services.dn_dc import (
    determine_dndc_from_calibration,
    determine_dndc_from_concentration,
)
from app.services.error_analysis import (
    assess_snr,
    fit_quality_indicators,
    propagate_uncertainty,
)
from app.services.particle import compute_particle_density
from app.services.peak_statistics import (
    compute_peak_statistics,
)
from app.services.peak_statistics import (
    resolution_between_peaks as peak_resolution,
)
from app.services.viscometry import compute_viscometry


# ---------------------------------------------------------------------------
# Conformation
# ---------------------------------------------------------------------------
class TestConformation:
    def test_slope_recovery(self):
        M = np.logspace(3, 6, 50)
        Rg = M ** 0.5
        r = compute_conformation(M, Rg)
        assert np.isfinite(r["slope"])
        assert abs(r["slope"] - 0.5) < 0.02
        assert r["conformation_class"] == "random coil"
        assert r["n_points"] == 50
        assert r["r_squared"] > 0.99

    def test_sphere_slope(self):
        M = np.logspace(3, 6, 50)
        Rg = M ** (1.0 / 3.0)
        r = compute_conformation(M, Rg)
        assert r["conformation_class"] == "sphere"
        assert abs(r["slope"] - 1.0 / 3.0) < 0.02

    def test_insufficient_data(self):
        M = np.array([1000.0, 2000.0])
        Rg = np.array([10.0, 14.0])
        r = compute_conformation(M, Rg)
        assert np.isnan(r["slope"])
        assert r["conformation_class"] == "insufficient data"
        assert r["n_points"] == 2

    def test_empty_input(self):
        r = compute_conformation(np.array([]), np.array([]))
        assert r["log_m"] == []
        assert r["log_rg"] == []
        assert np.isnan(r["slope"])
        assert r["conformation_class"] == "insufficient data"

    def test_filters_nonpositive(self):
        M = np.array([1000.0, -1.0, 0.0, np.nan, 1e5, 1e6])
        Rg = np.array([10.0, 1.0, 0.0, 1.0, 100.0, 200.0])
        r = compute_conformation(M, Rg)
        assert r["n_points"] == 3
        assert np.isfinite(r["slope"])


# ---------------------------------------------------------------------------
# Conjugate
# ---------------------------------------------------------------------------
class TestConjugate:
    def test_fractions_sum_to_one(self):
        n = 30
        t = np.linspace(10, 20, n)
        mals = np.full(n, 1e5)
        uv = np.linspace(0.1, 1.0, n)
        ri = np.linspace(0.1, 1.0, n)
        r = compute_conjugate(mals, uv, ri, t,
                              dn_dc_protein=0.185,
                              dn_dc_modifier=0.05,
                              uv_ext_protein=1.0,
                              uv_ext_modifier=0.5,
                              cell_length=10.0)
        assert r["message"] is None
        for pf, mf in zip(r["protein_fraction"], r["modifier_fraction"], strict=False):
            if pf is not None and np.isfinite(pf) and mf is not None and np.isfinite(mf):
                assert abs((pf + mf) - 1.0) < 1e-9

    def test_missing_uv_returns_empty(self):
        r = compute_conjugate(np.array([1e5]), None, np.array([0.1]),
                              np.array([10.0]),
                              dn_dc_protein=0.185,
                              dn_dc_modifier=None,
                              uv_ext_protein=1.0,
                              uv_ext_modifier=0.5,
                              cell_length=10.0)
        assert r["message"] is not None
        assert "missing" in r["message"].lower()
        assert r["total_molar_mass"] == []

    def test_missing_extinction(self):
        r = compute_conjugate(np.array([1e5]), np.array([0.5]), np.array([0.1]),
                              np.array([10.0]),
                              dn_dc_protein=0.185,
                              dn_dc_modifier=0.05,
                              uv_ext_protein=None,
                              uv_ext_modifier=0.5,
                              cell_length=10.0)
        assert r["message"] is not None

    def test_component_molar_mass(self):
        n = 5
        t = np.linspace(10, 12, n)
        mals = np.full(n, 1e5)
        dn_dc = 0.185
        eps_p = 1.0
        L = 10.0
        uv = np.full(n, 0.001 * eps_p * L / dn_dc)
        ri = np.full(n, 0.001)
        r = compute_conjugate(mals, uv, ri, t,
                              dn_dc_protein=dn_dc,
                              dn_dc_modifier=dn_dc,
                              uv_ext_protein=eps_p,
                              uv_ext_modifier=0.0,
                              cell_length=L)
        assert r["message"] is None
        assert abs(r["protein_fraction"][0] - 1.0) < 1e-6
        assert abs(r["protein_molar_mass"][0] - 1e5) < 1.0
        assert abs(r["modifier_molar_mass"][0] - 0.0) < 1.0


# ---------------------------------------------------------------------------
# Branching
# ---------------------------------------------------------------------------
class TestBranching:
    def test_linear_reference_g_one(self):
        M = np.logspace(3, 6, 50)
        Rg = M ** 0.5
        c = np.full(50, 0.001)
        ref_m = M.copy()
        ref_rg = Rg.copy()
        r = compute_branching(M, Rg, c, ref_m, ref_rg, branching_type="tri")
        assert r["message"] is None
        g_mean = np.nanmean(r["branching_ratio_g"])
        assert abs(g_mean - 1.0) < 0.05
        assert np.all(np.isfinite(r["branch_units_per_molecule"]))
        assert np.nanmean(r["branch_units_per_molecule"]) < 1.0

    def test_branched_g_below_one(self):
        M = np.logspace(3, 6, 50)
        Rg = (M ** 0.5) * 0.8
        c = np.full(50, 0.001)
        ref_m = M.copy()
        ref_rg = M ** 0.5
        r = compute_branching(M, Rg, c, ref_m, ref_rg, branching_type="tri")
        g_mean = np.nanmean(r["branching_ratio_g"])
        assert g_mean < 0.95
        assert np.nanmean(r["branch_units_per_molecule"]) > 0.1

    def test_no_linear_reference(self):
        M = np.logspace(3, 6, 50)
        Rg = M ** 0.5
        c = np.full(50, 0.001)
        r = compute_branching(M, Rg, c, None, None, branching_type="tri")
        assert r["message"] is not None
        assert r["branching_ratio_g"] == []

    def test_empty_input(self):
        r = compute_branching(np.array([]), np.array([]), np.array([]),
                              None, None, branching_type="tri")
        assert r["molar_mass"] == []
        assert r["message"] is not None


# ---------------------------------------------------------------------------
# Viscometry
# ---------------------------------------------------------------------------
class TestViscometry:
    def test_mhs_fit_recovery(self):
        M = np.logspace(4, 6, 40)
        K_true = 0.001
        a_true = 0.7
        iv = K_true * M ** a_true
        t = np.linspace(10, 20, 40)
        r = compute_viscometry(t, intrinsic_viscosity=iv, molar_mass=M)
        assert np.isfinite(r["mhs_K"])
        assert np.isfinite(r["mhs_a"])
        assert abs(r["mhs_a"] - a_true) < 0.02
        assert abs(r["mhs_K"] - K_true) / K_true < 0.05
        assert r["mhs_r_squared"] > 0.99

    def test_rh_computation(self):
        M = np.array([1e5])
        iv = np.array([50.0])
        t = np.array([10.0])
        r = compute_viscometry(t, intrinsic_viscosity=iv, molar_mass=M)
        assert np.isfinite(r["hydrodynamic_radius"][0])
        assert r["hydrodynamic_radius"][0] > 0

    def test_empty_input(self):
        r = compute_viscometry(np.array([]))
        assert r["intrinsic_viscosity"] == []
        assert np.isnan(r["mhs_K"])
        assert np.isnan(r["mhs_a"])

    def test_universal_molar_mass(self):
        M = np.array([1e5, 2e5])
        iv = np.array([10.0, 20.0])
        t = np.array([10.0, 11.0])
        r = compute_viscometry(t, intrinsic_viscosity=iv, molar_mass=M)
        assert np.isfinite(r["universal_molar_mass"][0])
        assert abs(r["universal_molar_mass"][0] - 1e6) < 1.0


# ---------------------------------------------------------------------------
# Column calibration
# ---------------------------------------------------------------------------
class TestColumnCalibration:
    def test_fit_apply_roundtrip(self):
        V = np.linspace(10, 20, 10)
        M_std = 10 ** (6 - 0.3 * (V - 10))
        r = fit_calibration_curve(V, M_std, degree=2)
        assert r["r_squared"] > 0.99
        assert r["calibration_type"] == "conventional"
        M_apply = apply_calibration(V, r["coefficients"])
        rel_err = np.abs(M_apply - M_std) / M_std
        assert np.max(rel_err) < 0.05

    def test_universal_calibration(self):
        V = np.linspace(10, 20, 10)
        M_std = 10 ** (6 - 0.3 * (V - 10))
        iv = np.full(10, 50.0)
        r = fit_calibration_curve(V, M_std, viscometer_iv=iv, degree=2)
        assert r["calibration_type"] == "universal"
        assert r["r_squared"] > 0.99

    def test_column_profile_plate_count(self):
        n = 1000
        t = np.linspace(0, 10, n)
        sig = np.exp(-((t - 5.0) ** 2) / (2 * 0.2 ** 2))
        cp = column_profile(t, sig)
        assert np.isfinite(cp["plate_count"])
        assert cp["plate_count"] > 100
        assert abs(cp["asymmetry_factor"] - 1.0) < 0.2

    def test_resolution(self):
        rs = resolution_between_peaks(5.0, 7.0, 1.0, 1.0)
        assert abs(rs - 2.0) < 1e-9

    def test_resolution_invalid(self):
        assert np.isnan(resolution_between_peaks(5.0, 7.0, 0.0, 1.0))

    def test_empty_fit(self):
        r = fit_calibration_curve(np.array([]), np.array([]))
        assert r["coefficients"] == []
        assert np.isnan(r["r_squared"])


# ---------------------------------------------------------------------------
# Particle
# ---------------------------------------------------------------------------
class TestParticle:
    def test_number_density(self):
        M = np.array([1e5, 2e5, 4e5])
        Rg = np.array([10.0, 12.0, 15.0])
        c = np.array([0.001, 0.001, 0.001])
        r = compute_particle_density(M, Rg, c)
        assert np.isfinite(r["total_count"])
        for d in r["number_density"]:
            assert np.isfinite(d) and d > 0

    def test_number_fraction_sums_to_one(self):
        M = np.logspace(4, 6, 30)
        Rg = M ** 0.4
        c = np.full(30, 0.001)
        r = compute_particle_density(M, Rg, c)
        total = np.nansum(r["number_fraction"])
        assert abs(total - 1.0) < 1e-6

    def test_geometric_radius(self):
        M = np.array([1e5])
        Rg = np.array([10.0])
        c = np.array([0.001])
        r = compute_particle_density(M, Rg, c)
        expected = 10.0 * np.sqrt(5.0 / 3.0)
        assert abs(r["geometric_radius"][0] - expected) < 1e-6

    def test_empty_input(self):
        r = compute_particle_density(np.array([]), np.array([]), np.array([]))
        assert r["molar_mass"] == []
        assert np.isnan(r["total_count"])


# ---------------------------------------------------------------------------
# Peak statistics
# ---------------------------------------------------------------------------
class TestPeakStatistics:
    def test_plate_count_gaussian(self):
        n = 1000
        t = np.linspace(0, 10, n)
        sig = np.exp(-((t - 5.0) ** 2) / (2 * 0.2 ** 2))
        ps = compute_peak_statistics(t, sig, peak_start=4.0, peak_end=6.0)
        assert np.isfinite(ps["plate_count"])
        assert ps["plate_count"] > 100
        assert np.isfinite(ps["retention_time"])
        assert abs(ps["retention_time"] - 5.0) < 0.05

    def test_asymmetry(self):
        n = 1000
        t = np.linspace(0, 10, n)
        sig = np.exp(-((t - 5.0) ** 2) / (2 * 0.2 ** 2))
        ps = compute_peak_statistics(t, sig)
        assert np.isfinite(ps["asymmetry_factor"])
        assert abs(ps["asymmetry_factor"] - 1.0) < 0.2

    def test_resolution(self):
        rs = peak_resolution(5.0, 7.0, 1.0, 1.0)
        assert abs(rs - 2.0) < 1e-9

    def test_empty_input(self):
        ps = compute_peak_statistics(np.array([]), np.array([]))
        assert np.isnan(ps["plate_count"])
        assert np.isnan(ps["retention_time"])


# ---------------------------------------------------------------------------
# dn/dc
# ---------------------------------------------------------------------------
class TestDnDc:
    def test_from_concentration_full_recovery(self):
        ri_area = 0.185
        flow_rate = 1.0
        injected_mass = 1.0
        value = determine_dndc_from_concentration(ri_area, flow_rate, injected_mass)
        assert abs(value - 0.185) < 1e-9

    def test_from_calibration(self):
        value = determine_dndc_from_calibration(0.185, 1.0, 1.0)
        assert abs(value - 0.185) < 1e-9

    def test_invalid_inputs_return_nan(self):
        assert np.isnan(determine_dndc_from_concentration(1.0, 0.0, 1.0))
        assert np.isnan(determine_dndc_from_concentration(1.0, 1.0, 0.0))
        assert np.isnan(determine_dndc_from_concentration(1.0, 1.0, None))
        assert np.isnan(determine_dndc_from_calibration(0.185, 0.0, 1.0))
        assert np.isnan(determine_dndc_from_calibration(None, 1.0, 1.0))


# ---------------------------------------------------------------------------
# Error analysis
# ---------------------------------------------------------------------------
class TestErrorAnalysis:
    def test_snr(self):
        signal = np.array([1.0, 1.1, 0.9, 1.05, 0.95])
        noise = np.array([0.01, 0.02, 0.015, 0.005, 0.012])
        snr = assess_snr(signal, noise)
        assert np.isfinite(snr)
        assert snr > 10

    def test_snr_zero_noise(self):
        signal = np.array([1.0, 1.0])
        noise = np.array([0.0, 0.0])
        assert np.isnan(assess_snr(signal, noise))

    def test_fit_quality_indicators(self):
        residuals = np.array([0.1, -0.1, 0.05, -0.05])
        qind = fit_quality_indicators(0.05, residuals, n_params=2)
        assert np.isfinite(qind["r_squared"])
        assert np.isfinite(qind["reduced_chi2"])
        assert qind["reduced_chi2"] > 0
        assert qind["rms_residual"] > 0

    def test_fit_quality_perfect(self):
        residuals = np.array([0.0, 0.0, 0.0])
        qind = fit_quality_indicators(0.0, residuals, n_params=2)
        assert qind["rms_residual"] == 0.0

    def test_uncertainty_propagation(self):
        M = np.logspace(4, 6, 30)
        c = np.full(30, 0.001)
        unc = propagate_uncertainty(M, None, c, None)
        assert len(unc["molar_mass_uncertainty"]) == 30
        assert np.isfinite(unc["Mn_uncertainty"]) or np.isnan(unc["Mn_uncertainty"])

    def test_uncertainty_empty(self):
        unc = propagate_uncertainty(np.array([]), None, np.array([]), None)
        assert unc["molar_mass_uncertainty"] == []


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
class TestPhase4Integration:
    _experiment_id = None
    _analyzed = False

    def _ensure_upload(self, client):
        if TestPhase4Integration._experiment_id is not None:
            return TestPhase4Integration._experiment_id
        with open(TEST_FILE, "rb") as f:
            response = client.post(
                "/api/files/upload",
                files={"file": ("test.afe8", f, "application/gzip")},
            )
        if response.status_code == 201:
            TestPhase4Integration._experiment_id = response.json()["experiment_id"]
        elif response.status_code == 400:
            detail = response.json().get("detail", "")
            assert "already uploaded" in detail
            TestPhase4Integration._experiment_id = int(detail.split("experiment ID ")[1].rstrip(")"))
        else:
            assert False, f"Unexpected upload status {response.status_code}: {response.text}"
        return TestPhase4Integration._experiment_id

    def _ensure_analyzed(self, client):
        exp_id = self._ensure_upload(client)
        if TestPhase4Integration._analyzed:
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
        TestPhase4Integration._analyzed = True
        return exp_id

    def test_conformation_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/conformation")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1
            peak = data["peaks"][0]
            slope = peak.get("slope")
            if slope is not None:
                assert slope > 0
                assert np.isfinite(slope)
            assert peak.get("n_points") is not None

    def test_conjugate_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(
                f"/api/experiments/{exp_id}/results/conjugate",
                params={
                    "dn_dc_protein": 0.185,
                    "dn_dc_modifier": 0.05,
                    "uv_ext_protein": 1.0,
                    "uv_ext_modifier": 0.5,
                    "cell_length": 10.0,
                },
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 0

    def test_branching_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(
                f"/api/experiments/{exp_id}/results/branching",
                params={"branching_type": "tri"},
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1

    def test_viscometry_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/viscometry")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1

    def test_calibration_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/calibration")
            assert response.status_code == 200, response.text
            data = response.json()
            assert "calibration_type" in data

    def test_particle_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(
                f"/api/experiments/{exp_id}/results/particle",
                params={"sample_ri": 1.59, "solvent_ri": 1.401},
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1

    def test_peak_statistics_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(
                f"/api/experiments/{exp_id}/results/peak-statistics",
                params={"detector": "RI"},
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] >= 1
            peak = data["peaks"][0]
            assert peak.get("plate_count") is not None
            assert peak["plate_count"] > 0

    def test_dn_dc_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(
                f"/api/experiments/{exp_id}/results/dn-dc",
                params={
                    "method": "concentration",
                    "ri_area": 0.185,
                    "flow_rate": 1.0,
                    "injected_mass": 1.0,
                },
            )
            assert response.status_code == 200, response.text
            data = response.json()
            assert data.get("dn_dc_value") is not None
            assert abs(data["dn_dc_value"] - 0.185) < 1e-6

    def test_error_analysis_endpoint(self):
        with TestClient(app) as client:
            exp_id = self._ensure_analyzed(client)
            response = client.get(f"/api/experiments/{exp_id}/results/error-analysis")
            assert response.status_code == 200, response.text
            data = response.json()
            assert isinstance(data, list)
            assert len(data) >= 1

    def test_regression_validation_gate(self):
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
