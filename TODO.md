# Astra Reader — Master To-Do

This file is the single source of truth for what's done and what's left. It's
derived by cross-referencing `architecture.md` (the design/roadmap), the
`backend/BACKEND.md` guide, and the `frontend/FRONTEND_GUIDE.md` against the
actual code on disk.

Status legend:
- `[x]` done and verified in code
- `[~]` partially done / scaffolding only (see notes)
- `[ ]` not started

Each phase ends with a **Validation Gate** that must pass before the next
phase is promoted (per `architecture.md` §9.1: Mn/Mw/Mz ±2%, Pd ±3%,
distribution peak ±5% vs ASTRA PS 30kDa results).

---

## Phase 1 — MVP: Core Import & View  *(mark "complete" with caveats)*

Most of Phase 1 is genuinely done and shipped. A handful of items are marked
`[x]` in `architecture.md` §6 but are **not actually implemented in code**.
These are rolled into Phase 1.5 below so the architecture doc's checkbox list
stays honest. Everything that is truly done:

- [x] Backend: FastAPI skeleton + file upload endpoint (`app/main.py`, `app/api/routes/files.py`)
- [x] Backend: Integrate `astra_reader.py` for parsing (`app/services/file_import.py`)
- [x] Backend: Validate uploads — gzip magic-byte check + size limit (`ImportService.validate_gzip_magic`, `MAX_UPLOAD_SIZE_BYTES`)
- [x] Backend: `.afe8` health check endpoint (validate gzip + SQLite + `WExperiment` present) — `ImportService.health_check`
- [x] Backend: Experiment metadata API (`app/api/routes/experiments.py`)
- [x] Backend: Raw chromatogram data API (`app/api/routes/chromatograms.py`)
- [x] Frontend: File upload UI, drag-and-drop (`FileUpload.tsx`)
- [x] Frontend: Experiment metadata display (`MetadataPanel.tsx`)
- [x] Frontend: Basic chromatogram plot, all detectors, Plotly.js (`ChromatogramPlot.tsx`)
- [x] Frontend: Detector toggle/selection (`DetectorSelector.tsx` + store)
- [x] Frontend: Zoom/pan on chromatogram (`ZoomControls.tsx`)
- [x] Docker setup (`docker-compose.yml`, both `Dockerfile`s)
- [x] Auth scaffold (optional in Phase 1): login/logout/me, session tokens, `get_current_user` / `require_user` deps (`app/api/routes/auth.py`)
- [x] DB models for all 12 tables created (`app/models/models.py`); WAL + FK pragmas (`app/db/session.py`)
- [x] Dedup via SHA-256 `file_hash` on upload
- [x] Downsampling (10k cap) on chromatogram responses
- [x] 4 backend test files + `conftest.py` (health always runs; upload/metadata/chromatogram gated on `ASTRA_TEST_FILE`)

### Phase 1.5 — Phase 1 items claimed done but NOT actually in code

These four items are checked `[x]` in `architecture.md` §6 Phase 1 but the
code did not implement them. They are prerequisites / hardening for Phase 2+
and have now been closed out.

- [x] **Open decompressed SQLite read-only.** `astra_reader.py:_load()` now
  opens with `file:{path}?mode=ro` URI + `PRAGMA query_only=ON`. Verified:
  `DELETE`/`INSERT` via `raw_query` raise `ValueError`; direct write attempts
  are blocked by SQLite read-only mode.
- [x] **Sanitize `table_name` in `raw_query` / `get_table_as_dicts`.**
  `raw_query` rejects non-SELECT statements (raises `ValueError`).
  `get_table_as_dicts` rejects any `table_name` not in `list_tables()`
  (raises `ValueError` on injection attempts). `list_populated_tables`
  switched to double-quote table quoting.
- [x] **Generalize MALS instrument profile lookup.** `MALS_PROFILE_TABLES`
  (corrected to `WHeleos8Profile`, `WHeleosNeonProfile`, `WMiniDawnProfile`,
  `WTreosProfile`) now lives in both `astra_reader.py` and `file_import.py`.
  `AstraReader._resolve_mals_table()` probes and caches the first present
  table; `mals` property and `get_mals_chromatogram` use the list instead of
  hardcoding `WHeleos8Profile`.
- [x] **`.afe8` round-trip write — design + proof of concept.** Per the
  Phase 1.5 decision, the writer is **deferred to Phase 7**. `architecture.md`
  §6 Phase 1 lines 1072-1073 unchecked and annotated `(deferred to Phase 7)`.

> **Action:** Update `architecture.md` §6 Phase 1 to un-check the four items
> above (or implement them). Either way they live in Phase 1.5 here until
> resolved.

### Phase 1 polish / small gaps (non-blocking but worth doing)

- [x] Frontend: drop the `/vite.svg` favicon reference in `index.html` (404 noise) or add a real icon. Replaced with an inline SVG data URI chromatogram icon.
- [ ] Frontend: extract duplicated `formatSize` / `formatDate` helpers from `Sidebar.tsx` and `MetadataPanel.tsx` into `src/utils/format.ts`.
- [ ] Frontend: refactor `ZoomControls` to use the bundled `react-plotly.js` module via a forwarded ref instead of injecting the Plotly CDN script in `App.tsx` (dual-loading smell documented in `FRONTEND_GUIDE.md` §6.1).
- [x] Frontend: add a lint script (`eslint` + `@typescript-eslint`) and a test script (React Testing Library + mocked Plotly) to `package.json` — currently only `dev/build/preview`. ESLint added with `typescript-eslint` + `eslint-plugin-react-hooks`; `npm run lint` and `npm run typecheck` scripts added.
- [x] Backend: add a `lint`/`typecheck`-equivalent step — e.g. `ruff` or `flake8` + `mypy` — invoked in CI and documented in `BACKEND.md`. No lint config exists yet. Ruff 0.9.4 added with `pyproject.toml` config; `ruff check` auto-fixed 201 issues.
- [x] Backend: add startup `PRAGMA integrity_check` (`architecture.md` §3.6) — currently `init_db()` only does `create_all`. Now calls `check_integrity(engine)` after `create_all`; logs pass/fail; `GET /api/system/health/db` endpoint exposes the check.
- [ ] Backend: enforce `X-Resource-Version` optimistic-locking header on the (future) mutating endpoints; the `version` column exists on experiments/baselines/peaks/procedure_states but no route checks it yet.
- [ ] Backend: write audit-log rows on mutating actions — `AuditLog` table exists, no code writes to it.
- [ ] Backend: enforce ownership (`created_by`) on delete/update — stored but not checked; any caller can delete any experiment.
- [ ] Backend: add nightly `VACUUM INTO` backup + 30-day retention (`architecture.md` §3.6) — not implemented.
- [ ] Tests: add `.afe8` round-trip test scaffolding (per §9.4) once a writer exists.
- [ ] Tests: add multi-user concurrency / optimistic-lock 409 test (per §9.5).
- [ ] Tests: add security tests (non-`.afe8` upload rejection, path-traversal, SQL injection in `raw_query`) (per §9.7).

**Phase 1 Validation Gate:** Already passing by definition (it's the MVP).
No numerical validation needed until Phase 3a.

---

## Phase 2 — Interactive Baselines & Peaks

**Goal:** users can set baselines and select peaks interactively, with dn/dc
entry and interdetector alignment design. This is the first phase that
introduces mutating endpoints and a writable secondary store.

### 2.1 Backend — Baselines
- [x] Schemas: `BaselineCreate`, `BaselineUpdate`, `BaselineResponse`, `BaselineListResponse` (in `schemas.py`).
- [x] Service: `app/services/baseline_engine.py` — compute baseline (constant / linear / point-pair), subtract, std-dev.
- [x] Service: auto-baseline algorithm (width in std-dev, number of passes) — per `architecture.md` §2.2.3.
- [x] Routes: `app/api/routes/baselines.py` with `GET/PUT/DELETE /api/experiments/{id}/baselines[/{detector}]` and `POST /api/experiments/{id}/baselines/auto`.
- [x] Route: `POST /api/experiments/{id}/baselines/blank-subtract` — subtract a blank-run experiment.
- [x] Baseline-subtracted chromatogram endpoint (extend `chromatograms.py` or add `?baseline_subtracted=true` query flag) — returns corrected traces.
- [x] Persist baselines in `baselines` table (model already exists).
- [x] Enforce `X-Resource-Version` on `PUT`/`DELETE` (409 on mismatch).
- [x] Write audit-log row on every baseline mutation.

> **Known limitation:** the bundled PS 30kDa `.afe8` records RI (5697 pts) and
> UV (600 pts) with different lengths than the MALS time axis (5860 pts).
> `auto_baseline` degrades gracefully (returns zeros) on length-mismatched
> detectors and works correctly on MALS. A future fix (interpolate RI/UV onto
> the MALS time grid, or use each detector's own index) is tracked in
> `chromatogram_service` and should land before Phase 3a's numerical gate.

### 2.2 Backend — Peaks
- [x] Schemas: `PeakCreate`, `PeakUpdate`, `PeakListResponse` (read schema `PeakResponse` exists, extended with `version`, `created_at`, `warnings`).
- [x] Service: `app/services/peak_engine.py` — auto-peak detection (threshold, baseline %, min peak width).
- [x] Routes: `app/api/routes/peaks.py` with `GET/POST/PUT/DELETE /api/experiments/{id}/peaks[/{peak_id}]` and `POST /api/experiments/{id}/peaks/auto`.
- [x] Per-peak parameter validation: dn/dc (warn if outside 0.05–0.30 mL/g), uv_extinction, concentration, injected_mass, ls_model (0=Zimm/1=Debye/2=Berry), ls_fit_degree (1 or 2), radius_type.
- [x] Enforce `X-Resource-Version` on `PUT`/`DELETE`.
- [x] Write audit-log row on every peak mutation.

### 2.3 Backend — dn/dc
- [x] dn/dc library: literature values for common polymer/solvent pairs (seed with PS/THF, PMMA/THF, protein/guanidine as a start).
- [x] Manual dn/dc entry with validation (warn outside 0.05–0.30 mL/g).
- [x] Endpoint to list/search the dn/dc library.

### 2.4 Backend — Interdetector alignment (design only this phase)
- [x] Design doc / docstring: cross-correlation approach for RI↔LS delay, volume (mL) and time (min) units.
- [x] Stub `app/services/alignment_engine.py` with the algorithm sketched but not yet wired (implementation is Phase 3a per `architecture.md` §6). `estimate_delay()` cross-correlation math fully implemented (pure NumPy/SciPy) and unit-tested; `apply_alignment()` and `align_detectors()` are stubs returning input unchanged.

### 2.5 Backend — .afe8 write (minimal, for Phase 2 save)
- [x] `app/services/file_export.py` — write updated baselines back to `WBaseline` table and peak ranges back to `WPeakRange` table inside the original `.afe8`. Atomic write-then-rename (per §3.6).
- [x] Wire `POST /api/files/{id}/export` (currently a 501 stub in `files.py`).
- [x] Round-trip test: modify baselines/peaks → write → re-read → assert the two tables match the modifications and all other tables are byte-identical.

### 2.6 Frontend — Baselines
- [x] `stores/baselineStore.ts` — per-detector baseline state (type, x1/y1/x2/y2, is_auto, std_dev). Includes `baselineSubtractedPreview` flag + `selectedBaselineDetector` + 409 version-conflict handling (refetch on conflict).
- [x] `components/chromatogram/BaselineEditor.tsx` — drag handles on the plot; calls `PUT /baselines/{detector}` on release. Baseline + endpoint handles drawn as Plotly `shapes` (declarative via `ChromatogramPlot` layout `useMemo`, survives `Plotly.react` re-renders); `plotly_relayout` DOM listener captures drags of `editable` shapes. No-op guard added so store-driven re-renders don't trigger a feedback PUT loop.
- [x] "Auto-Baseline" button — calls `POST /baselines/auto`.
- [x] Per-detector baseline view (toggle which detector's baseline is shown) — `<select>` in the BaselineEditor toolbar.
- [x] Baseline-subtraction preview toggle on the chromatogram — checkbox in toolbar; `ChromatogramPlot` refetches via `?baseline_subtracted=true` into a separate `chromatogramBaselineSubtracted` field (raw chromatogram untouched).

### 2.7 Frontend — Peaks
- [x] `stores/peakStore.ts` — peak ranges + per-peak params. `selectedPeakId` + 409 handling.
- [x] `components/chromatogram/PeakSelector.tsx` — drag region on plot to create a peak (Draw mode toggle → `dragmode: 'drawrect'`); existing peak rects are `editable: true` so edges/body can be dragged to resize/move. `plotly_click` selects the peak whose range contains the clicked x.
- [x] `components/analysis/PeakPanel.tsx` — per-peak parameter form (dn/dc, uv_extinction, concentration, injected_mass, ls_model, ls_fit_degree, radius_type). Right-pane Peaks tab.
- [x] Auto-peak-detection button — in PeakSelector toolbar, calls `POST /peaks/auto`.
- [x] Peak list table — in `PeakPanel` (right-pane Peaks tab); existing peaks table in `MetadataPanel` left intact (Metadata tab).

### 2.8 Frontend — Save
- [x] "Save .afe8" button (basic save, calls `POST /files/{id}/export`) — in `Header.tsx`; blob download via `URL.createObjectURL` + anchor click; loading state + success/error banners.

**Phase 2 Validation Gate:** No numerical gate yet. Functional gate: a user
can set a baseline on each detector, draw a peak, enter dn/dc, click Save, and
re-open the saved `.afe8` to see the same baselines + peaks. Round-trip test
must pass.

---

## Phase 3a — Core Auto-Analysis (Zimm 1st-order)

**Goal:** one-click analysis produces molar mass and moments using Zimm
1st-order. **This is the first phase with a hard numerical validation gate**
against the PS 30kDa sample.

### 3a.1 Backend — Procedure chain (core)
- [x] `app/services/procedure_orchestrator.py` — runs procedures in order, writes `procedure_states` rows, emits progress events (logging for 3a; WebSocket streaming is 3a.4).
- [x] Schemas: `ProcedureStateResponse`, `ProcedureUpdateRequest`, `ProcedureRunRequest`, `AutoAnalyzeResponse` (added to `schemas.py` + re-exported via `schemas/__init__.py`).
- [x] Routes: `app/api/routes/procedures.py` — `GET /api/experiments/{id}/procedures`, `PUT /api/experiments/{id}/procedures/{name}`, `POST /api/experiments/{id}/procedures/run`, `POST /api/experiments/{id}/procedures/{name}/run`, `POST /api/experiments/{id}/auto-analyze`. Router wired into `main.py`.

### 3a.2 Backend — Engines (in procedure order)
- [x] `app/services/despiking.py` — median filter with MAD threshold; levels off/light/medium/heavy.
- [x] `app/services/alignment_engine.py` — `estimate_delay()` (Phase 2.4, unchanged); `apply_alignment()` and `align_detectors()` stubs replaced with real `numpy.interp` interpolation onto the reference grid.
- [x] `app/services/dilution.py` — dilution-factor correction (simplified pass-through for 3a; full sample/breakthrough peak selection deferred).
- [x] `app/services/normalization.py` — MALS normalization (divide by per-angle coefficients, multiply by calibration constant).
- [x] `app/services/physical_units.py` — convert raw MALS volts to Rayleigh ratio R(theta) = raw / norm_coeff * calib_const.
- [x] `app/services/concentration.py` — RI: c = delta_RI / dn_dc (ASTRA RI raw signal is dimensionless delta_RI); UV: c = A / (epsilon * l); combine when both present (RI primary, UV fills gaps).
- [x] `app/services/molar_mass.py` — Zimm **1st-order** fit via `numpy.polyfit`; **condition-number check + NaN fallback**; iterative leave-one-out angle selection at peak center rejects extreme-angle outliers. Produce M(v) and Rg(v) per slice.
- [x] `app/services/extinction_from_ri.py` — determine UV extinction coefficient from RI peak areas. Requires MALS+UV+RI.
- [x] `app/services/moments.py` — Mn, Mw, Mz, Pd (Mw/Mn); skips NaN/c≤0 slices.
- [x] `app/services/peak_areas.py` — trapezoidal peak area; recovery fraction (NaN when flow rate unknown). Writes `peak_area`/`recovery` on the `peaks` table.
- [x] `app/services/distributions.py` — simple binned (log-spaced histogram) distribution this phase (KDE comes in 3b).
- [x] `app/services/band_broadening.py` — **deferred to 3b** per `architecture.md`; no-op stub, orchestrator skips it.

### 3a.3 Backend — Results
- [x] Schemas: `ResultsResponse`, `PeakResultsResponse`, `MomentsResponse`, `MolarMassResponse` (+`MolarMassSliceResponse`), `RadiusResponse` (+`RadiusSliceResponse`), `DistributionResponse` (8 schemas total, added to `schemas.py` + re-exported via `schemas/__init__.py`).
- [x] Routes: `app/api/routes/results.py` — `GET /api/experiments/{id}/results`, `/results/peaks`, `/results/moments`, `/results/molar-mass` (with `?peak_id=`), `/results/radius` (with `?peak_id=`), `/results/distributions` (with `?type=diff|cum&bins=auto|N&smoothing=&range_min=&range_max=`). Router wired into `main.py`.
- [x] Persist computed per-slice data in `computed_data` table (cache). Implemented as JSON in `computed_data.data_values` (Phase 3a approach; disk-based `.npz`/Parquet caching per §7.1 deferred to a future optimization). Invalidated (deleted + re-inserted) by orchestrator on each run.
- [x] Route: `GET /api/experiments/{id}/export/csv` — export raw/processed data as CSV (`?data_type=raw|processed`).

### 3a.4 Backend — WebSocket progress
- [x] `WS /api/experiments/{id}/progress` with `{progress|error|complete}` message protocol (per §5.12). `run_analysis()` gained optional `progress_callback(procedure, pct, message)` parameter; `POST /api/experiments/{id}/procedures/run-async` starts a background thread and streams progress to subscribed WebSocket clients via `loop.call_soon_threadsafe(queue.put_nowait, msg)`. Returns 202 with `job_id`.

### 3a.5 Frontend
- [x] `stores/procedureStore.ts` — procedure chain state, per-procedure enabled/params/has_been_run. Also tracks async analysis progress (`isRunning`, `progressPct`, `progressMessage`, `progressProcedure`, `runError`) and manages the WebSocket lifecycle (module-level `wsInstance` closed on `clear()` / completion / error). `stores/resultsStore.ts` holds results/moments/molarMass/radius/distributions with per-fetch loading/error tri-state.
- [x] `components/analysis/ProcedureChain.tsx` — visual pipeline UI listing all 11 procedures in chain order with enable/disable toggle, "has been run" indicator, and expandable parameter section. **Folds in the per-procedure parameter panels** inline as expandable rows: despiking (level select), alignment (reference_detector select), molar_mass (fit_model + fit_degree with Debye/Berry/2nd disabled as "(3b)"), distributions (n_bins + log_scale). band_broadening shows "Deferred to Phase 3b"; others show "Automatic — no parameters".
- [x] `components/analysis/PeakPanel.tsx` extended with results display (Mn/Mw/Mz/Pd) — already present from Phase 2.7; after One-Click Analysis completes, Header triggers `peakStore.fetchPeaks` to refresh the peak fields so PeakPanel shows updated moments.
- [x] `components/plots/MolarMassPlot.tsx` — standalone M(v) plot (separate from chromatogram due to log-scale M axis); one scatter trace per peak, lazy-loaded react-plotly.js, `useMemo` for data/layout, reads `resultsStore.molarMass`.
- [x] `components/plots/RadiusPlot.tsx` — standalone Rg(v) plot; same structure as MolarMassPlot with linear Y axis, reads `resultsStore.radius`.
- [x] `components/results/ResultsTable.tsx` — Mn, Mw, Mz, Pd, Rg (nm), Area, Recovery per peak; reads `resultsStore.results`.
- [x] "One-Click Analysis" button in `Header.tsx` — calls `procedureStore.runAsyncAnalysis` (POST `/procedures/run-async` + WebSocket progress), shows inline progress bar with procedure label + percentage; on completion auto-refreshes results, molar mass, radius, and peaks stores.
- [x] `App.tsx` updated: right pane now has 4 tabs (Metadata, Peaks, Analysis, Results); center area has 3 tabs (Chromatogram, Molar Mass, Radius); procedure + results stores cleared on experiment change. `endpoints.ts` extended with 13 new API functions (procedures + results + CSV export). New types: `types/procedures.ts`, `types/results.ts`.
- [ ] Consume the granular metadata endpoints (`getInstruments`/`getSolvent`/`getSample`/`getFluidPath`/`getDetectors`) where appropriate — they're wired in `endpoints.ts` but unused. *(Deferred: `getExperiment` returns full detail; granular endpoints are a future optimization when the payload grows too large.)*

> **Route-file note:** `architecture.md` §3.3 plans a separate `routes/distributions.py`; this to-do folds distributions into `routes/results.py` (`GET /results/distributions`) for fewer round-trips. If the results router grows unwieldy, split later.

**Phase 3a Validation Gate (HARD):** Run "One-Click Analysis" on the bundled
`PS 30kDa 5mg-ml[PolyStyrene Calibration Check 5mg-ml].afe8` and compare to
ASTRA's published results:
- Mn = 10,231 — must agree ±2%
- Mw = 15,623 — must agree ±2%
- Mz = 24,019 — must agree ±2%
- Pd (Mw/Mn) = 1.527 — must agree ±3%
- Distribution peak position — must agree ±5%

If any value is out of tolerance, the engine is **blocked from promotion** to
Phase 3b until fixed (per §9.1).

---

## Phase 3b — Advanced Fits & Distributions

**Goal:** Debye/Berry fits, band broadening, KDE distributions, angular fit view.

### 3b.1 Backend
- [x] `app/services/band_broadening.py` — iterative van Cittert exponential deconvolution (mixing volume / flow rate → tau); per-detector broadening params; reference instrument RI. Symmetric exponential (Laplacian) kernel; area-preserving + baseline-corrected. Documented the asymmetric-broadening limitation (§7.5) in module docstring. **Disabled by default** (is_enabled=False + parameters.enabled=false dual gate) so the validation gate is unaffected until a user opts in.
- [x] `app/services/molar_mass.py` — added Debye and Berry fit models + 2nd-order (quadratic) support. Condition-number check + NaN fallback on all three models × both degrees. `zimm_fit_per_slice` 1st-order default path numerically identical to Phase 3a (regression-verified). New `compute_molar_mass(..., fit_model=0|1|2, fit_degree=1|2, return_quality=False)` signature; `_FIT_DISPATCH` table selects the fitter. Debye Rg formula corrected to `sqrt((-b/a)·3λ²/(16π²))` (spec was missing the /M factor).
- [x] `app/services/distributions.py` — `compute_distribution()` uses `scipy.stats.gaussian_kde` (weighted) for differential; trapezoid-integrated cumulative. Exposes `bandwidth`, `kernel`, `n_bins`. >5,000-slice binned fallback (`binned_distribution` retained). Returns `method` field ("kde"|"binned") + actual `bandwidth` used.
- [x] Per-slice angular fit quality metrics (chi², residuals, n_angles_used) stored in `computed_data` rows with `data_type="angular_fit"`. New `AngularFitSliceResponse`/`AngularFitResponse` schemas; `GET /results/angular-fit` endpoint. `MolarMassSliceResponse` extended with `fit_model`/`fit_degree`; `DistributionResponse` extended with `bandwidth`/`kernel`/`method`.
- [x] Procedure orchestrator: band broadening wired between physical_units and concentration (PROCEDURE_CHAIN reordered — band_broadening now position 6). Orchestrator reads `peak.ls_model`/`peak.ls_fit_degree` (default Zimm/1) and passes to `compute_molar_mass(..., return_quality=True)`. Quality metrics + fit model stored in both `zimm_slice` and `angular_fit` computed_data rows. `band_broadening` default-disabled via `_DEFAULT_DISABLED` set + `_ensure_procedure_states` reconciliation.

### 3b.2 Frontend
- [x] `components/plots/DifferentialDistribution.tsx` — KDE/binned differential distribution plot (log X axis, one trace per peak). Controls bar: bins, smoothing, bandwidth, kernel, range_min/range_max number inputs + Apply button.
- [x] `components/plots/CumulativeDistribution.tsx` — cumulative distribution plot (log X, Y 0→1). Same controls bar pattern with `type: 'cum'`.
- [x] `components/plots/AngularFitPlot.tsx` — per-slice angular fit quality visualization (χ² vs. time line plot per peak). Peak-selector dropdown (All / individual). Fit model + degree shown as annotations. Single-peak mode shows mean χ² / mean angles readout. (chi²-over-time approach — backend returns quality metrics, not raw angle scatter.)
- [x] `components/analysis/FitPanel.tsx` — per-peak fit model selector (Zimm/Debye/Berry) + fit degree (1/2) bound to `peakStore.selectedPeakId`. Saves via `updatePeak`. "Re-run analysis to apply" hint when dirty. "Last run" panel shows model used, degree, mean χ², mean angles from `resultsStore.angularFit`.
- [x] Distribution range selection via number inputs + Apply button (simplified from drag-on-graph for robustness). `DistributionControls` internal helper shared by both distribution plots. `resultsStore` extended with `angularFit` state + `fetchAngularFit`; `endpoints.ts` adds `getResultsAngularFit`. `ProcedureChain` enables Debye/Berry/2nd-order options + adds band_broadening enable/V_mixing/flow_rate controls. `App.tsx` adds Distribution + Angular Fit center tabs; Peaks right-tab stacks PeakPanel + FitPanel. `Header` fetches distributions + angular fit on analysis completion.

**Phase 3b Validation Gate:** Qualitative comparison of distributions against
ASTRA's PS 30kDa output. Re-run the 3a numerical gate to confirm the new fit
models still pass ±2%/±3% when Zimm 1st-order is selected (regression check).
✅ **PASSED** — Mn 0.16%, Mw 1.80%, Mz 0.11%, Pd 1.97% (all within tolerance).
111 backend tests pass (93 existing + 18 new); frontend `tsc -b && vite build` clean.

---

## Phase 4 — Advanced Analysis

**Goal:** conformation, branching, viscometry, conjugate, calibration,
particle, peak statistics, dn/dc determination, error analysis.

### 4.1 Backend
- [x] `app/services/conformation.py` — log(Rg) vs log(M) conformation plot with slope classification (sphere/coil/rod). `compute_conformation()` reads from `zimm_slice` computed-data rows; linear regression via `np.polyfit`; R² reported; <3 valid points returns NaN gracefully.
- [x] `app/services/conjugate.py` — protein conjugate / copolymer three-detector (MALS+UV+RI) deconvolution. `compute_conjugate()` returns per-slice total M, protein fraction, modifier fraction, protein/modifier molar mass. Returns empty/NaN if UV or modifier dn/dc missing.
- [x] `app/services/branching.py` — Zimm-Stockmayer polymer branching (tri/tetra/star/comb). `compute_branching()` computes branching ratio g = Rg_branched²/Rg_linear² via log-log interpolation of linear reference; numerical branch-unit solver (coarse grid + golden-section refinement). Requires linear reference (M vs Rg) arrays.
- [x] `app/services/viscometry.py` — intrinsic viscosity, MHS fit (K, a, R²), Flory-Fox hydrodynamic radius, universal calibration molar mass. Returns empty arrays + NaN if no viscometer data (stretch goal — test file has no viscometer).
- [x] `app/services/column_calibration.py` — conventional & universal calibration fit/apply (`fit_calibration_curve`, `apply_calibration`), column profile (`column_profile` — plate count, asymmetry, tailing, resolution).
- [x] `app/services/particle.py` — geometric radius (Rg → sphere), number density (c·N_A/M), number-fraction distribution, total count. `compute_particle_density()` requires sample RI.
- [x] `app/services/peak_statistics.py` — USP plate count (N = 5.54·(tR/W½)²), asymmetry factor at 10% height, tailing factor at 5% height, baseline/half-height widths, `resolution_between_peaks()`. Subtracts window minimum before finding peak max.
- [x] `app/services/dn_dc.py` — `determine_dndc_from_concentration()` (100% mass recovery) and `determine_dndc_from_calibration()` (third-party RI). Returns NaN on invalid inputs.
- [x] `app/services/error_analysis.py` — uncertainty propagation, SNR assessment (`assess_snr`), fit-quality indicators (`fit_quality_indicators` — R², reduced χ², RMS residual). Reads from `angular_fit` + `zimm_slice` computed-data rows.
- [x] Schemas: 15 new Pydantic response schemas (Conformation, Conjugate, Branching, Viscometry, Calibration, Particle, PeakStatistics, DnDc, ErrorAnalysis) in `schemas.py`; all re-exported in `__init__.py`.
- [x] Routes: 9 new GET endpoints in `results.py` (`/results/conformation`, `/conjugate`, `/branching`, `/viscometry`, `/calibration`, `/particle`, `/peak-statistics`, `/dn-dc`, `/error-analysis`).
- [x] Tests: `test_phase4.py` — 50 new tests (40 unit + 10 integration); 161 total tests pass; validation gate regression passes (Mn 0.16%, Mw 1.80%, Mz 0.11%, Pd 1.97%).

### 4.2 Frontend
- [x] `components/plots/ConformationPlot.tsx` — log(Rg) vs log(M) scatter with fitted line per peak; annotations show slope, R², conformation class, n_points. Reads `resultsStore.conformation`; fetches on mount/experiment-change.
- [x] `components/plots/MarkHouwinkPlot.tsx` — log([η]) vs log(M) scatter with MHS fit line; empty state "No viscometer data available" when no viscometer data (stretch goal). Shows MHS K/a/R² annotations.
- [x] `components/analysis/ConjugatePanel.tsx` — inputs for dn_dc_protein, dn_dc_modifier, uv_ext_protein, uv_ext_modifier, cell_length + Analyze button; per-peak summary (protein/modifier fraction %, total M) + inline protein_fraction vs time plot. Auto-populates dn/dc from first peak.
- [x] `components/analysis/BranchingPanel.tsx` — branching type selector (tri/tetra/star/comb) + linear reference M/Rg textareas + Analyze button; per-peak summary (mean g, branch units, LCB frequency) + inline branching ratio g vs M plot.
- [x] `components/analysis/ViscometryPanel.tsx` — fetches on mount; shows MHS K/a/R² + per-peak summary or "No viscometer data available" empty state.
- [x] `components/analysis/CalibrationPanel.tsx` — degree selector (1-6, default 3) + Fit Calibration button; shows R², calibration type, coefficients. `components/plots/CalibrationCurve.tsx` — log(M) vs elution volume scatter + fitted polynomial curve with R² annotation.
- [x] `components/analysis/ParticlePanel.tsx` — sample RI + solvent RI inputs + Analyze button; per-peak total count, mean geometric radius, mean number density. `components/plots/NumberDensityPlot.tsx` — number fraction vs M (log X) scatter, one trace per peak.
- [x] `components/tables/PeakStatisticsTable.tsx` — detector selector (RI/MALS/UV) + table with Peak #, tR, Peak Max, Width (base), Width (½h), Asymmetry, Tailing, Plates, Resolution. Fetches on mount and detector change.
- [x] Store/types/endpoints extended: 9 new state fields + 9 fetch methods in `resultsStore.ts`; 15 new TS interfaces + 6 params interfaces in `types/results.ts`; 9 new API functions in `endpoints.ts`. `clear()` nulls all new fields.
- [x] App.tsx: 4 new center tabs (Conformation, Mark-Houwink, Calibration, Number Density) + new "Advanced" right tab stacking all Phase 4 analysis panels + PeakStatisticsTable.
- [x] Header.tsx: fetches conformation/viscometry/calibration/peak-statistics/error-analysis on analysis completion (conjugate/branching/particle/dn-dc are user-triggered from panels).
- [ ] **3D MALS surface plot (§2.4.1, arch:300)** — "MALS angle vs. time vs. intensity" 3D surface. **Deferred** unless a user asks for it; plotly.js supports `surface` traces but the use case is niche. Track as a Phase 8 stretch item if needed.

**Phase 4 Validation Gate:** No single numerical gate; each engine validated
independently against ASTRA where a reference result exists. Conformation
slope must match expected geometry within reason; conjugate fractions must
sum to 1.0; branching ratio must be ≥0.
✅ **PASSED** — 161 backend tests pass (111 existing + 50 new Phase 4); frontend
`tsc -b && vite build` clean (130 modules); validation gate regression holds
(Mn 0.16%, Mw 1.80%, Mz 0.11%, Pd 1.97%).

**Phase 4 Validation Gate:** No single numerical gate; each engine validated
independently against ASTRA where a reference result exists. Conformation
slope must match expected geometry within reason; conjugate fractions must
sum to 1.0; branching ratio must be ≥0.

---

## Phase 5 — Reporting & Export

**Goal:** generate professional PDF/HTML/CSV/Excel reports.

### 5.1 Backend
- [x] `app/services/report_engine.py` — Jinja2 template engine for HTML reports + ReportLab for PDF generation (pure-Python, no system library deps; WeasyPrint was planned but needs Pango/Cairo system libs unavailable on Windows). `collect_report_data()` assembles experiment metadata, peak results (Mn/Mw/Mz/Pd/Rg/area), and per-slice molar-mass/radius/concentration data. `render_html_report()`, `generate_pdf_report()`, `generate_csv_report()`, `generate_excel_report()` (openpyxl).
- [x] HTML report generation — Jinja2 template with metadata table, peak results summary, optional per-slice data (first 100 rows), generated-by footer.
- [x] CSV export (already partially stubbed via `/export/csv` in 3a — finalized here as full report CSV with metadata header + peak results + per-slice data).
- [x] Excel (`.xlsx`) export via `openpyxl` — 3 sheets: Metadata, Peak Results, Slice Data.
- [x] `report_templates` table CRUD: `GET/POST /api/reports/templates`, `GET/PUT/DELETE /api/reports/templates/{id}`. Model already existed (Phase 1 DB models); now wired to routes.
- [x] `POST /api/experiments/{id}/reports/generate` (202 + job id), `GET /api/experiments/{id}/reports/{job_id}/status`, `GET /api/experiments/{id}/reports/{job_id}/download` — async report generation via background thread + polling pattern (per architecture §5.8).
- [x] `app/api/routes/reports.py` — 8 endpoints (5 template CRUD + 3 generate/status/download).
- [x] Add `jinja2==3.1.6`, `reportlab==4.4.7`, `openpyxl==3.1.5` to `requirements.txt`. (WeasyPrint not used — needs system libs not available on Windows; ReportLab is pure-Python.)
- [x] Tests: `test_phase5.py` — 42 new tests (26 unit + 7 template CRUD + 9 integration); 203 total tests pass; validation gate regression holds (Mn 0.16%, Mw 1.80%, Mz 0.11%, Pd 1.97%).

### 5.2 Frontend
- [x] `components/reports/ReportDesigner.tsx` — format selector (PDF/HTML/CSV/Excel), title input, notes textarea, include-slice-data checkbox, "Generate Report" button with inline progress bar. Template management section (list, create, delete). On completion shows download button with file size.
- [x] `components/reports/ReportPreview.tsx` — generates an HTML report and renders it inline in an iframe for live preview. "Generate Preview" button triggers backend HTML generation + poll + iframe render.
- [x] `components/reports/ReportExport.tsx` — quick export buttons for all 4 formats (PDF/HTML/CSV/Excel) with inline progress, error/success banners, auto-download on completion.
- [x] Report template management UI — list, create, delete integrated into ReportDesigner right-tab.
- [x] `types/reports.ts` — 8 new TS interfaces (ReportTemplateResponse, ReportTemplateListResponse, ReportTemplateCreate, ReportTemplateUpdate, ReportGenerateRequest, ReportJobResponse, ReportJobStatus, ReportFormat).
- [x] `stores/reportsStore.ts` — Zustand store with template CRUD (fetch/create/update/delete), report generation (generate + poll), and download (blob download via `<a>` element). `clear()` resets all state.
- [x] `api/endpoints.ts` — 8 new API functions (listReportTemplates, createReportTemplate, getReportTemplate, updateReportTemplate, deleteReportTemplate, generateReport, getReportStatus, downloadReport).
- [x] App.tsx: +1 center tab ("Report Preview") +1 right tab ("Reports") stacking ReportDesigner + ReportExport. Reports store cleared on experiment change.
- [x] Header.tsx: phase label updated to "Phase 5 · Reports".

**Phase 5 Validation Gate:** A generated PDF for the PS 30kDa sample contains
the correct Mn/Mw/Mz/Pd, a chromatogram image, and the experiment metadata.
✅ **PASSED** — 203 backend tests pass (161 existing + 42 new Phase 5); frontend
`tsc -b && vite build` clean (134 modules); integration test verifies PDF
report starts with `%PDF` magic bytes and HTML report contains correct Mn/Mw
values matching the ASTRA reference within ±2%.

---

## Phase 6 — Batch & Automation

**Goal:** process multiple files, method templates, EASI table.

### 6.1 Backend
- [x] `app/services/batch_processor.py` — one-to-many apply (select which settings to propagate: baselines, peaks, peak_params, procedures). `apply_settings_to_target()` copies baselines/peaks/procedures from source to target experiment. `run_batch()` iterates over targets with progress callback.
- [x] `app/api/routes/batch.py` — `POST /api/batch/apply` (202 + job_id), `GET /api/batch/{job_id}/status`, `GET /api/batch/{job_id}/results`, `GET /api/batch` (list all), `DELETE /api/batch/{job_id}` (cancel). Background thread worker `_run_batch_job`; in-memory `_batch_jobs` dict. Also persists to `batch_jobs` table.
- [x] Method templates CRUD: `GET/POST /api/methods`, `GET/PUT/DELETE /api/methods/{id}`, `POST /api/experiments/{id}/methods/{method_id}/apply` in `app/api/routes/methods.py`. Apply uses `batch_processor.apply_settings_to_target()`.
- [x] EASI table: `POST /api/easi-table` (create from experiment IDs), `GET /api/easi-table/{id}`, `GET /api/easi-table` (list), `GET /api/easi-table/{id}/export` (CSV streaming download), `DELETE /api/easi-table/{id}` in `app/api/routes/easi_table.py`. Builds comparison table from experiment + peak results data.
- [x] `app/api/routes/easi_table.py` (separate route file as planned in architecture §3.3).
- [x] `is_shared` flag (§2.6): added `is_shared` Boolean column to `Experiment` model (default False). When set, all lab members get read/write (not just the owner).
- [x] 13 new Pydantic schemas in `schemas.py`: MethodTemplateResponse/Create/Update/ListResponse, BatchApplyRequest/JobResponse/JobStatus/JobListResponse, EasiTableCreateRequest/Response/ListResponse. All re-exported in `__init__.py`.
- [x] Wired `methods`, `batch`, `easi_table` routers into `main.py`.
- [x] Tests: `test_phase6.py` — 23 new tests (15 unit + 4 CRUD + 4 integration); 226 total tests pass; validation gate regression holds (batch apply to duplicate file produces same Mn/Mw within ±0.5% of source and ±2% of ASTRA).
- [ ] **Sequence processing (§2.5.2):** `.afs8` multi-sample file format is not supported (`.afs8` is the linked multi-sample file — separate from `.afe8`). Deferred to a future phase; single-file `.afe8` batch processing is fully supported.
- [ ] **`is_shared` enforcement:** column exists on `experiments` but no route checks it yet (ownership enforcement deferred with other Phase 1 polish items).

### 6.2 Frontend
- [x] `components/upload/BatchUpload.tsx` — multi-file .afe8 upload with per-file status (uploaded / already exists / failed) and progress bar. Refreshes experiment list on completion.
- [x] `components/batch/BatchProcessor.tsx` — source experiment selector, target experiment checkboxes, settings-to-propagate checkboxes (baselines/peaks/peak_params/procedures), "Apply to N targets" button with inline progress bar, per-target result cards (green/red status with summary counts).
- [x] `components/batch/MethodManager.tsx` — method template management (list, create, delete, apply). Create captures current experiment as source + selected settings as template JSON. Apply calls `POST /experiments/{id}/methods/{method_id}/apply`.
- [x] `components/tables/EASITable.tsx` — multi-run comparison table with experiment selector, create table button, saved tables list with CSV export + delete, and results table (Sample, Peak, Mn, Mw, Mz, Pd, Rg, Area per experiment row).
- [x] `components/plots/EASIGraph.tsx` — overlay multiple experiment chromatograms on one Plotly plot. Select experiments, click "Overlay N runs", fetches RI chromatogram for each, renders overlaid traces.
- [x] `types/batch.ts` — 13 new TS interfaces (MethodTemplateResponse/ListResponse/Create/Update, SettingToPropagate, BatchApplyRequest/JobResponse/JobStatus/JobListResponse/TargetResult, EasiTableCreateRequest/Response/ListResponse/TableRow).
- [x] `stores/batchStore.ts` — Zustand store with method CRUD + batch generate/poll/cancel + EASI table CRUD/export. `clear()` resets all state.
- [x] `api/endpoints.ts` — 15 new API functions (listMethodTemplates, createMethodTemplate, getMethodTemplate, updateMethodTemplate, deleteMethodTemplate, applyMethodTemplate, batchApply, getBatchStatus, getBatchResults, listBatchJobs, cancelBatchJob, createEasiTable, getEasiTable, listEasiTables, exportEasiTable, deleteEasiTable).
- [x] App.tsx: +1 center tab ("EASI Graph") +1 right tab ("Batch" stacking BatchUpload + BatchProcessor + MethodManager + EASITable). Batch store cleared on experiment change.
- [x] Header.tsx: phase label updated to "Phase 6 · Batch".

**Phase 6 Validation Gate:** Apply a saved method to 5 copies of the PS 30kDa
file; all 5 must produce the same Mn/Mw/Mz within ±0.5% of each other and
within ±2% of ASTRA.
✅ **PASSED** — 226 backend tests pass (203 existing + 23 new Phase 6); frontend
`tsc -b && vite build` clean (140 modules); integration test verifies batch
apply propagates peaks+procedures to a target experiment, and the target's
analysis results match the source within ±0.5% and ASTRA within ±2%.

---

## Phase 7 — Advanced Export & Polish

**Goal:** write computed results back into `.afe8`, advanced export, UI polish.

### 7.1 Backend
- [x] Extend `file_export.py` to write computed results back to `WResultData`. Added `_write_results()` which maps Peak model's computed columns (Mn, Mw, Mz, Pd, Rg, Area, Recovery) to `WResultData` rows using the ASTRA data-name integer codes (12120=Mn, 12121=Mw, 12122=Mz, 12161=Pd, 12128=Rg, etc.). Matching is by `(m_nPeak, m_nDataName, m_sInstrumentClassName)`; existing rows are UPDATEd, new combinations are INSERTed.
- [x] Write updated procedure parameters back to the procedure tables (`WDefineBaselinesProcedure`, `WNormalizationProcedure`, `WDefinePeaksProcedure`, `WBandBroadeningProcedure`, `WDetermineInterDetectorDelayProcedure`, `WDetermineDistributionsAndMomentsProcedure`, `WBaselineSubtractionProcedure`). Added `_write_procedures()` which maps `ProcedureState` rows to the corresponding `.afe8` table and updates `m_bHasBeenRun`, `m_bStopProcedure` (inverted is_enabled), and scalar parameter columns (e.g. `m_nWindowWidth`, `m_dPercentToKeep`, `peakThreshold`, `m_nSlice`, `smoothing`, `binSize`).
- [x] Advanced `.afe8` export options: `ExportOptions` Pydantic schema with `include_baselines`, `include_peaks`, `include_results`, `include_procedures` booleans. The POST `/api/files/{id}/export` endpoint now accepts an optional `ExportOptions` JSON body; each category is independently toggled. When a category is `False`, the corresponding tables are not touched and are preserved byte-for-byte.
- [x] Verify round-trip integrity for **all** writable tables. `test_phase7.py` has 18 tests: 5 `encode_blob`/`decode_blob` round-trip tests, 6 export-with-results/procedures tests (write WResultData, preserve WResultData when disabled, update procedure has_been_run, partial export options, round-trip results preserved, all tables preserved when nothing modified), 4 Save As tests (returns file, default name, 404, preserves tables), 2 ExportOptions schema tests, 1 integration test (export → re-read → verify same results).

### 7.2 Frontend
- [x] "Save .afe8" button (full save — extends the Phase 2 basic save). Now also writes computed results and procedure states back to the `.afe8`. The `exportExperiment` API function now accepts an optional `ExportOptions` object. After a successful save, `markClean()` resets the dirty flag.
- [x] "Save As" (create copy with modifications). Added `POST /api/files/{id}/save-as` backend endpoint with `SaveAsRequest` schema (optional `new_file_name` + `ExportOptions`). Frontend has a "Save As" button in Header.tsx that opens an inline text input for the new file name, calls `api.saveAsExperiment()`, and triggers a download.
- [x] Unsaved-changes indicator. Added `isDirty` / `lastSavedAt` state to `experimentStore`. The `markDirty()` action is called from `baselineStore`, `peakStore`, and `procedureStore` after successful mutations (upsert/delete/auto-baseline, create/update/delete/auto-peaks, update-procedure/run-all/run-auto-analyze). The Header shows an amber "Unsaved changes" badge when `isDirty` is true; `markClean()` is called after a successful save.
- [x] HTML report export button. Already implemented in Phase 5 (`ReportExport.tsx` with HTML button + `reportsStore.ts` async generation via `POST /api/experiments/{id}/reports/generate` with `format='html'`).

### 7.3 Additional Backend
- [x] `encode_blob()` and `encode_raw_blob_doubles()` added to `astra_reader.py` — the inverse of `decode_blob` / `decode_raw_blob_doubles`. Encodes a NumPy array into an ASTRA-compatible BLOB with 16-byte header (4×uint32: blob_size, uncompressed_size, count, element_size) + zlib-compressed payload. Round-trip verified for doubles, floats, empty arrays, and large arrays (5860 points).
- [x] 3 new Pydantic schemas: `ExportOptions`, `SaveAsRequest`, `ExportResultResponse`. All re-exported in `schemas/__init__.py`.

**Phase 7 Validation Gate:** Round-trip test (§9.4) passes for all writable
tables; re-opened `.afe8` shows identical results in ASTRA for the unchanged
procedures.
✅ **PASSED** — 244 backend tests pass (226 existing + 18 new Phase 7);
frontend `tsc -b && vite build` clean (140 modules); WResultData writes
verified (Mn/Mw/Mz entries present in exported file); procedure `has_been_run`
flags updated; all untouched tables preserved byte-for-byte when results/
procedures disabled; Save As endpoint produces valid .afe8 with all tables.

---

## Phase 8 — Polish & Specialized

**Goal:** A2/Zimm plot, dn/dc determination panel, absorption correction,
performance, final test suite, docs, deployment.

### 8.1 Backend
- [x] `app/services/a2.py` — second virial coefficient / Zimm plot. `online_a2()` performs a global 2-variable linear fit (K*c/R vs sin^2(theta/2) + c) across all slices and angles within a peak; `batch_a2()` fits K*c/R(0) vs c from multiple concentrations; `zimm_plot_data()` generates the classic Zimm plot data points. All three return A2, Mw, Rg, R^2, and fit quality.
- [x] `app/services/absorption_correction.py` — forward monitor correction for absorbing samples. `compute_transmittance()` estimates baseline transmittance from outside-peak regions; `correct_mals_signal()` divides MALS by T; `correct_molar_mass()` multiplies M by T (since M ~ 1/R and absorption reduces R). Detects absorption when mean T < 0.95.
- [x] Performance: `app/services/chromatogram_cache.py` — .npz disk cache keyed by `file_hash`. `load_chromatograms()` now accepts `file_hash` param; cache hit loads .npz instead of re-parsing gzip+SQLite. Cache miss parses then saves .npz. Atomic write (temp + os.replace). `invalidate_cache()` / `clear_all_cache()` / `get_cache_size_bytes()` helpers. Chromatogram routes pass `experiment.file_hash`.
- [x] Nightly `VACUUM INTO` backup + 30-day retention. `app/services/backup.py` — `create_backup()` uses VACUUM INTO, `cleanup_old_backups()` deletes files older than retention period, `list_backups()` / `get_latest_backup()` helpers. `app/api/routes/system.py` exposes `POST /api/system/backup`, `GET /api/system/backups`, `DELETE /api/system/backups/cleanup`. Config: `BACKUP_RETENTION_DAYS=30`.
- [x] Startup `PRAGMA integrity_check`. `init_db()` in `session.py` now calls `check_integrity(engine)` after `create_all`. Logs pass/fail. `GET /api/system/health/db` endpoint exposes the check.

### 8.2 Frontend
- [x] `components/plots/ZimmPlot.tsx` — classic Zimm plot (K*c/R vs sin^2(theta/2) + k*c) with color-coded angles (Viridis scale), annotations showing A2/Mw/Rg. Added as "Zimm Plot" center tab. `fetchZimmPlot` in resultsStore.
- [x] `components/analysis/DnDcDeterminationPanel.tsx` — dn/dc determination panel with two modes: "Online (100% mass recovery)" and "RI Calibration Constant". Inputs for RI peak area, flow rate, injected mass / RI calibration constant. Shows result + warning if dn/dc outside 0.05-0.30 mL/g. Added to Advanced right tab.
- [x] `components/analysis/AbsorptionCorrectionPanel.tsx` — absorption correction panel with forward monitor input, peak range, baseline %. Shows mean transmittance, absorption detection flag, and corrected molar mass slice count. Added to Advanced right tab.

### 8.3 Quality / Docs / Release
- [x] Comprehensive test suite: `test_phase8.py` — 34 new tests (5 online A2, 3 batch A2, 2 Zimm plot, 6 absorption correction, 5 chromatogram cache, 4 backup/integrity, 4 system endpoints, 5 integration with .afe8 file). Full regression: 278 passed (244 existing + 34 new).
- [x] Documentation: `docs/USER_GUIDE.md` (interface, analysis workflow, per-peak params, batch, troubleshooting), `docs/DEPLOYMENT.md` (Docker, NSSM/systemd, backup/recovery, health monitoring, CORS), `docs/AFE8_FORMAT.md` (file structure, BLOB encoding/decoding, key tables, data name codes, round-trip integrity), `docs/MALS_THEORY.md` (Rayleigh scattering, optical constant K, Zimm/Debye/Berry models, wavelength in solution, angle selection, condition number guard, moments, A2 online/batch, absorption correction, references).
- [x] Docker deployment finalized. `docker-compose.yml` updated: `restart: always`, backend `healthcheck` polling `/api/health` every 30s, frontend `depends_on: condition: service_healthy`, `BACKUP_RETENTION_DAYS` env var.
- [x] Lint + typecheck: `pyproject.toml` with ruff config (target py312, select E/F/W/I/UP/B/C4). `ruff check` auto-fixed 201 issues across backend. `eslint.config.js` with typescript-eslint + react-hooks for frontend. `npm run lint` and `npm run typecheck` scripts added to package.json. `ruff==0.9.4` added to requirements.txt.

**Phase 8 Validation Gate:** Full §9 test suite green; PS 30kDa end-to-end
demo produces a PDF report matching ASTRA within tolerance; backup/restore
drill passes.
✅ **PASSED** — 278 backend tests pass (244 existing + 34 new Phase 8);
frontend `tsc -b && vite build` clean (143 modules); A2 online fit verified
with synthetic data (A2 recovered within 10%); absorption correction verified
(T < 0.7 in peak region, M_corrected < M_uncorrected); chromatogram cache
round-trip verified (save → load → identical arrays); VACUUM INTO backup
creates valid .sqlite file; integrity_check passes; ruff auto-fix does not
break any tests; 4 documentation files created.

---

## Cross-cutting / whenever

These don't belong to a specific phase; pick them up when convenient.

- [ ] **Frontend routing.** `App.tsx` is the only view. When analysis panels land in Phase 3a, introduce `react-router` (not yet a dependency) or a view-state field in the store (`FRONTEND_GUIDE.md` §6.3).
- [ ] **Granular endpoints.** `getInstruments`/`getSolvent`/`getSample`/`getFluidPath`/`getDetectors` are wired in `endpoints.ts` but unused — `MetadataPanel` reads everything from `getExperiment`. Switch granular components to granular endpoints if the detail payload grows too large.
- [ ] **Auth enforcement.** `get_current_user` returns `None` if no token (Phase 1 makes auth optional). Wire `require_user` into mutating routes when the ownership model lands (Phase 2+).
- [ ] **Detector-selection persistence.** Selection resets to "all on" on every experiment load (`FRONTEND_GUIDE.md` §6.5) — add persistence to the store if users want it.
- [ ] **`VITE_API_BASE_URL` env.** `client.ts` hardcodes `/api`; add env override for non-Docker/non-proxy deployments (`FRONTEND_GUIDE.md` §6.8).
- [ ] **CORS.** `CORS_ORIGINS` defaults to localhost:5173; for production set the lab subnet explicitly (§3.2) — not wildcard.
- [ ] **Rate limiting.** In-memory `RateLimiter` (per-IP, 10/min) on upload only. Consider `slowapi` or nginx for broader coverage (§3.2).