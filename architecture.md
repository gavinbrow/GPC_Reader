# Astra Web App - Architecture & Planning Document

## 1. Project Overview

### 1.1 Goal
Build a **self-hosted web application** deployed on a local lab machine that
imports Wyatt ASTRA `.afe8` files and provides interactive analysis capabilities
replicating (and eventually exceeding) the Wyatt ASTRA desktop software.

**Key decisions (confirmed with user):**
- **Deployment:** Self-hosted on a local machine (not cloud)
- **Multi-user:** Yes - multiple scientists will use it simultaneously
- **Architecture:** Hybrid - JavaScript frontend + Python API backend for
  server-side analysis (the numerical heavy-lifting stays in Python with
  `astra_reader.py`; the frontend handles UI and visualization)
- **Instrument control:** No - read-only, post-collection analysis only
- **Detector scope:** MALS, UV, RI only (no DLS/QELS)
- **Regulatory compliance:** Not needed (no 21 CFR Part 11)
- **File writing:** Yes - allow writing modified `.afe8` files back to disk
- **Instrument support:** Work with Wyatt instruments as-is (DAWN, Optilab, UV)
- **Priority features:** Baseline per detector, peak selection, auto molar mass
  (Mn, Mw, Mz), polydispersity, distributions, reporting

The app should let users:

- Upload `.afe8` files (gzip-compressed SQLite databases)
- View raw chromatograms from all detectors (MALS, UV, RI)
- Interactively set baselines per detector
- Select and define peaks
- Automatically compute molar mass (Mn, Mw, Mz), polydispersity, radius, etc.
- Generate reports and export data
- Save modified `.afe8` files with updated analysis parameters

### 1.2 What We Already Know About the File Format

`.afe8` files are **gzip-compressed SQLite databases**. The decompressed database
contains 150+ tables (62 typically populated). Key findings:

| Layer | Format |
|---|---|
| Outer | gzip (magic `1f 8b`) |
| Inner | SQLite 3 database |
| Data BLOBs | 16-byte header (4 x uint32: blob_size, uncomp_size, count, elem_size) + zlib-compressed doubles/floats |
| Small BLOBs (angles, norms) | 16-byte header + raw doubles (no zlib) |

See `astra_reader.py` for the working reader implementation and the full data
model.

---

## 2. ASTRA Feature Inventory (Target Scope)

Based on research of the Wyatt ASTRA website and the procedure tables found in
the `.afe8` database, here is the complete feature set to replicate.

### 2.1 Data Import & File Management
- [ ] Upload `.afe8` files via web interface
- [ ] Auto-decompress gzip and parse SQLite
- [ ] Display experiment metadata (sample name, solvent, operator, dates)
- [ ] Display instrument configuration (MALS angles, UV wavelengths, RI params)
- [ ] Display fluid flow path (Pump -> Sampler -> UV -> LS -> RI)
  *(Viscometer may be present in file but is not a primary analysis target)*
- [ ] Support batch import of multiple files (sequence processing)
- [ ] Display sample set info (`.afs8` linked files)

### 2.2 Processing Procedures (The "Procedure Chain")

These map directly to the `WDirectoryEntry` table and the procedure tables in
the database. They execute in order:

#### 2.2.1 Basic Collection
- [ ] Display collection parameters (operator, script, duration, flow rate, injection volume)
- [ ] Show collection interval and laser power settings

#### 2.2.2 Despiking
- [ ] Interactive despiking level control (off, light, medium, heavy)
- [ ] Visual before/after comparison
- [ ] Spike detection overlay on chromatogram

#### 2.2.3 Define Baselines
- [ ] **Per-detector baseline selection** (MALS each angle, UV each channel, RI, viscometer)
- [ ] Baseline types: constant, linear, point-pair
- [ ] Interactive drag-to-set baseline start/end points
- [ ] Auto-baseline algorithm (width in std dev, number of passes)
- [ ] Show baseline subtraction preview
- [ ] Baseline std dev display
- [ ] Blank run subtraction (upload a blank `.afe8` and subtract)

#### 2.2.4 Alignment / Interdetector Delay
- [ ] Auto-detect interdetector delays between detectors
- [ ] Manual adjustment of delay values
- [ ] Visual overlay of aligned chromatograms
- [ ] Display delay in volume (mL) and time (min)

#### 2.2.5 Dilution Factor
- [ ] Compute dilution correction
- [ ] Display dilution factor per detector
- [ ] Sample peak and breakthrough peak selection

#### 2.2.6 Band Broadening Correction
- [ ] Toggle band broadening correction on/off
- [ ] Display instrumental term, mixing term, mixing2 term, relative amplitude term
- [ ] Visual before/after comparison (the "grimace" removal)
- [ ] Per-detector broadening parameters
- [ ] Reference instrument selection (typically RI)

#### 2.2.7 Normalization (MALS)
- [ ] Normalization peak selection
- [ ] Percent to keep setting (default 25%)
- [ ] Display normalization coefficients per detector angle
- [ ] R(theta)/R(0) ratio display
- [ ] Fit quality indicators (chi-squared, residual)

#### 2.2.8 Convert to Physical Units
- [ ] Apply detector-specific calibration constants to convert raw voltages to Rayleigh ratio
- [ ] Use solvent Rayleigh-ratio reference (e.g., toluene) for absolute calibration
- [ ] Store calibration constant and reference material per instrument in `mals_config`
- [ ] Convert raw voltages to physical units

#### 2.2.9 Convert to Concentration
- [ ] Select concentration source (RI, UV, or both)
- [ ] Convert RI signal to concentration: c = (RI - baseline) / (dn/dc * K_RI)
- [ ] Convert UV signal to concentration: c = A / (epsilon * l)
- [ ] Combine RI and UV concentration signals when both are available
- [ ] Display concentration vs. elution volume

#### 2.2.10 Define Peaks
- [ ] **Interactive peak selection** on chromatogram
- [ ] Auto-peak detection (threshold, baseline %, min peak width)
- [ ] Multiple peak regions (Peak 1, Peak 2, etc.)
- [ ] Region of interest (ROI) selection
- [ ] Per-peak parameters: dn/dc, UV extinction, concentration, injected mass
- [ ] Per-peak LS model selection (Debye, Zimm, Berry, random coil, etc.)
- [ ] Per-peak LS fit degree (1st order, 2nd order)
- [ ] Per-peak radius type selection
- [ ] Display peak max value and max index

#### 2.2.11 Determine Mass and Radius from LS
- [ ] Compute molar mass per slice (M(v))
- [ ] Compute RMS radius per slice (Rg(v))
- [ ] Select enabled detectors and angles
- [ ] Display fit model and fit degree
- [ ] Show per-slice angular fit quality
- [ ] Display second virial coefficient (A2) if applicable

#### 2.2.12 Determine Extinction from RI (when UV + RI available)
- [ ] Calculate UV extinction coefficient from RI data
- [ ] Display calculated extinction and comparison to entered value

#### 2.2.13 Fit Mass or Radius
- [ ] Select fit model (Zimm, Debye, Berry, etc.)
- [ ] Select fit order (1st, 2nd)
- [ ] Display fit range and extrapolation direction
- [ ] Show fit residuals and chi-squared

#### 2.2.14 Determine Distributions and Moments
- [ ] Compute Mn, Mw, Mz (number/weight/z-average molar mass)
- [ ] Compute polydispersity (Mw/Mn, Mz/Mw)
- [ ] Compute radius moments
- [ ] **Differential distribution** plot (weight fraction vs. molar mass)
- [ ] **Cumulative distribution** plot (cumulative weight fraction vs. molar mass)
- [ ] Adaptive binning algorithm for distribution calculation
- [ ] Distribution range selection (interactive drag on distribution graph)
- [ ] Smoothing control
- [ ] Bin size control
- [ ] Number density distribution (if applicable)

#### 2.2.15 Peak Areas
- [ ] Compute peak area per detector
- [ ] Display peak area ratios
- [ ] Recovery fraction calculation

### 2.3 Advanced Analysis Procedures

> Items marked **OUT OF SCOPE** are included only as context for future versions.
> They are not implemented in this architecture and should not appear in the
> module tree or API.

#### 2.3.1 Protein Conjugate / Copolymer Analysis
- [ ] Input: dn/dc and UV extinction for protein + modifier
- [ ] Compute total molar mass, protein fraction, modifier fraction per slice
- [ ] Display protein fraction vs. elution volume plot
- [ ] Requires MALS + UV + RI (three detectors)

#### 2.3.2 Viral Vector Analysis (AAV/VLP) - OUT OF SCOPE
- [ ] Input: dn/dc and UV extinction for capsid + nucleic acid
- [ ] Compute total/full/empty particle concentrations
- [ ] Capsid-to-genome ratio (Cp/Vg)
- [ ] Percent aggregates
- [ ] Requires MALS + UV + RI

#### 2.3.3 Lipid Nanoparticle - Nucleic Acid (LNP-NA) Analysis - OUT OF SCOPE
- [ ] UV scattering correction for particles >20 nm radius
- [ ] Payload distribution (payload molar mass vs. particle size)
- [ ] Encapsulation efficiency
- [ ] Requires MALS + UV + RI, typically with FFF separation

#### 2.3.4 Polymer Branching Analysis
- [ ] Input: linear reference file, Mark-Houwink K and a, repeat unit mass
- [ ] Branching types: tri-functional, tetra-functional, star, comb
- [ ] Compute branching ratio, branch units per molecule, long-chain branching frequency
- [ ] Conformation plot overlay (branched vs. linear)
- [ ] Radius method or mass method selection
- [ ] Requires MALS + Viscometer (+ concentration)

#### 2.3.5 Molecular Conformation
- [ ] **Conformation plot**: log(Rg) vs. log(M) with slope analysis
- [ ] Slope interpretation: 0.33 = sphere, 0.5 = random coil, 1.0 = rod
- [ ] **Mark-Houwink-Sakurada plot**: log([eta]) vs. log(M)
- [ ] Requires MALS + Viscometer + concentration

#### 2.3.6 Viscometry (Stretch Goal)
*Viscometer data is parsed and displayed if present, but advanced viscometry
analysis is a stretch goal for future phases.*
- [ ] Intrinsic viscosity [eta] vs. elution volume
- [ ] Specific viscosity vs. elution volume
- [ ] Mark-Houwink-Sakurada K and a determination
- [ ] Hydrodynamic radius from viscometry
- [ ] Molar mass via MHS equation (universal calibration)
- [ ] Molar mass via universal calibration (hydrodynamic volume)
- [ ] Intrinsic viscosity distributions and moments
- [ ] Requires Viscometer + concentration detector

#### 2.3.7 Conventional & Universal Column Calibration
- [ ] Import multiple calibration standard runs
- [ ] Merge calibration data into single curve
- [ ] Conventional calibration (log M vs. elution volume, concentration detector only)
- [ ] Universal calibration (log(M*[eta]) vs. elution volume, with viscometer)
- [ ] Column profile display with plate count, asymmetry, resolution
- [ ] Apply calibration curve to unknown samples
- [ ] Compare MALS vs. calibration molar mass

#### 2.3.8 Particle Concentration & Number Density
- [ ] Geometric radius per slice (from angular fit)
- [ ] Number density per slice
- [ ] Total particle count per peak
- [ ] Number fraction distribution
- [ ] Requires MALS only + known sample refractive index

#### 2.3.9 Second Virial Coefficient (A2)
- [ ] Zimm plot (global fitting, no extrapolation)
- [ ] Online A2 determination (autodilution)
- [ ] Batch A2 from multiple concentrations

#### 2.3.10 dn/dc and UV Extinction Determination
- [ ] Direct measurement mode (known concentration injections)
- [ ] Online measurement mode (100% mass recovery assumption)
- [ ] RI calibration constant determination (third-party RI)

#### 2.3.11 Absorption Correction
- [ ] Forward monitor correction for absorbing samples
- [ ] Pure solvent peak region selection
- [ ] Corrected molar mass display

#### 2.3.12 Online DLS (QELS) - OUT OF SCOPE
- [ ] Correlation function display
- [ ] Translational diffusion coefficient (Dt)
- [ ] Hydrodynamic radius (Rh) vs. elution volume
- [ ] Single exponential fit with residuals

#### 2.3.13 DLS Batch (Cumulants & Regularization) - OUT OF SCOPE
- [ ] Cumulants fit (mean Rh, polydispersity)
- [ ] Regularization analysis (DYNALS algorithm)
- [ ] Rh intensity/weight distributions
- [ ] Multiple species resolution

#### 2.3.14 Peak Statistics
- [ ] Column plate count
- [ ] Peak width
- [ ] Asymmetry factor
- [ ] Tailing factor
- [ ] Resolution between peaks
- [ ] Per-detector statistics

#### 2.3.15 Error Analysis & Uncertainties
- [ ] Per-slice uncertainty propagation
- [ ] Uncertainty display as numerical values or percentages
- [ ] Signal-to-noise ratio assessment
- [ ] Fit quality indicators (chi-squared, R-squared, residuals)

### 2.4 Reporting & Visualization

#### 2.4.1 Graph Types
- [ ] **Chromatogram overlay** - all detectors vs. time/volume
- [ ] **Molar mass vs. elution volume** - M(v) with peak overlay
- [ ] **Radius vs. elution volume** - Rg(v) with peak overlay
- [ ] **Conformation plot** - log(Rg) vs. log(M)
- [ ] **Mark-Houwink plot** - log([eta]) vs. log(M)
- [ ] **Differential distribution** - dW/dlog(M) vs. log(M)
- [ ] **Cumulative distribution** - W(>M) vs. log(M)
- [ ] **Number density distribution**
- [ ] **Protein fraction vs. volume** (conjugate analysis)
- [ ] **Branching ratio vs. molar mass**
- [ ] **Branch units per molecule vs. molar mass**
- [ ] **Long-chain branching frequency vs. molar mass**
- [ ] **Angular fit plot** (per-slice MALS fit)
- [ ] **Zimm plot** (A2 analysis)
- [ ] **Calibration curve** (log M vs. volume)
- [ ] **EASI Graph** - overlay multiple runs
- [ ] **3D surface plot** (MALS angle vs. time vs. intensity)

#### 2.4.2 EASI Table
- [ ] Summary table comparing multiple runs
- [ ] Customizable columns (select which results to show)
- [ ] Configurable precision and format
- [ ] Uncertainty display toggle (percent or numerical)
- [ ] Export to CSV/Excel
- [ ] Copy to clipboard

#### 2.4.3 Report Designer
- [ ] Customizable report layout
- [ ] Logo upload and placement
- [ ] Custom title and summary notes
- [ ] Select which data/graphs to include
- [ ] Numerical formatting control (significant digits, notation)
- [ ] Export to PDF
- [ ] Export to HTML
- [ ] Report templates (save/load)

### 2.5 Batch Processing & Automation

#### 2.5.1 One-to-Many Processing
- [ ] Process one experiment, then apply same settings to multiple files
- [ ] Select which settings to propagate (baselines, peaks, procedures, etc.)
- [ ] Batch results summary
- [ ] Batch EASI Table generation

#### 2.5.2 Sequence Processing
- [ ] Import sample sequences (from `.afs8` files)
- [ ] Per-sample method assignment
- [ ] Automated post-processing
- [ ] Replicate handling and statistics

#### 2.5.3 Method Templates
- [ ] Save current analysis settings as a reusable method/template
- [ ] Load method template on file import
- [ ] Default method for one-click analysis
- [ ] Method sharing between users

### 2.6 User Management (Lightweight)
*Note: Full 21 CFR Part 11 compliance is NOT needed per user request.*
- [ ] Simple user identification (name/lab member, no passwords needed for local)
- [ ] Track who created/modified an experiment (for lab bookkeeping)
- [ ] Lightweight ownership model: every experiment has an `owner_id`; only the
      owner can delete or overwrite it; other users have read-only access by default
- [ ] `is_shared` flag on experiments allows read/write for all lab members
- [ ] Session tokens with 7-day expiry and revocation on logout
- [ ] Audit log records all create/update/delete/export/analyze actions
- [ ] Optional: Light authentication if multiple labs share the machine

---

## 3. Technical Architecture

### 3.1 High-Level Architecture

**Hybrid approach:** JavaScript frontend for UI/visualization + Python API
backend for server-side analysis. The numerical computation (MALS fitting,
distributions, band broadening, etc.) stays in Python leveraging
`astra_reader.py` and NumPy/SciPy. The frontend handles all interactivity,
plotting, and user experience.

```
+----------------------------------------------------------+
|                     Web Browser (Frontend)                |
|  React + TypeScript + Plotly.js for visualizations       |
|  (multi-user: each browser session is independent)       |
+----------------------------------------------------------+
                          |  HTTP/WebSocket (local network)
+----------------------------------------------------------+
|                     API Server (Backend)                  |
|  Python + FastAPI                                        |
|  Runs on the lab machine, serves all users               |
|                                                          |
|  +------------------+  +------------------+              |
|  |  File Import &    |  |  Analysis Engine  |             |
|  |  Export Service   |  |  (procedures)     |             |
|  |  (.afe8 read/write)| |  (NumPy/SciPy)   |             |
|  +------------------+  +------------------+              |
|                                                          |
|  +------------------+  +------------------+              |
|  |  Project/Data     |  |  Report Engine    |             |
|  |  Store            |  |  (PDF/HTML gen)   |             |
|  +------------------+  +------------------+              |
+----------------------------------------------------------+
                          |
              +--------------------------+
              |    Data Storage Layer     |
              |  SQLite + File Store      |
              |  (lightweight, local)     |
              +--------------------------+
```

**Why hybrid (not pure JS):** The MALS fitting algorithms (Zimm/Debye/Berry),
band broadening correction, distribution calculations, and uncertainty
propagation require NumPy/SciPy and are already implemented in Python. Porting
all of this to JavaScript would be a massive effort with significant accuracy
risk. The Python backend handles all computation; the JS frontend handles
rendering and interaction. This is the standard architecture for scientific
web apps.

**Async worker architecture:** FastAPI is async single-event-loop per process.
CPU-heavy tasks (MALS fitting, distributions, batch analysis, report generation)
are dispatched to a background worker pool via `concurrent.futures.ProcessPoolExecutor`
or a task queue (Celery/RQ/ARQ). The API returns `202 Accepted` with a job ID;
WebSocket `/api/experiments/{id}/progress` streams updates. Synchronous endpoints
(file upload, metadata, chromatogram reads) remain in FastAPI.

### 3.2 Technology Stack (Proposed)

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React + TypeScript | Mature ecosystem, strong typing, component model |
| Charts | Plotly.js or D3.js | Scientific plotting, zoom/pan, interactivity |
| UI Framework | Tailwind CSS + shadcn/ui | Rapid dev, clean aesthetic, customizable |
| State Mgmt | Zustand or Redux Toolkit | Predictable state for complex analysis flows |
| Backend | Python + FastAPI | Async, automatic OpenAPI docs, type-safe |
| Data Parsing | `astra_reader.py` (existing) | Already built and tested |
| Numerical | NumPy + SciPy | Standard scientific Python stack |
| Database | SQLite | Lightweight, no server install, perfect for local deployment |
| File Store | Local filesystem | Store uploaded .afe8 files, exports, and working copies |
| Report Gen | WeasyPrint (PDF) + Jinja2 | HTML-to-PDF, template-based |
| Deployment | Docker + docker-compose | Reproducible, portable, easy local setup |
| CORS | FastAPI middleware | Allow lab subnet explicitly (not wildcard in production) |
| Rate Limiting | slowapi or nginx | Cap file uploads per user/IP to prevent accidental DoS |

> **Note on SQLite vs PostgreSQL:** Since this is self-hosted on a local machine,
> SQLite avoids the need to install/configure a database server. It handles
> concurrent reads well. For multi-user writes, we use WAL mode + short
> transactions. If write contention becomes an issue, migrating to PostgreSQL
> is straightforward (the SQLAlchemy models are DB-agnostic).

### 3.3 Backend Module Structure

```
backend/
  app/
    main.py                  # FastAPI app entry point
    config.py                # Configuration settings
    
    api/
      routes/
        files.py             # Upload, list, delete .afe8 files
        experiments.py        # Get experiment metadata
        chromatograms.py     # Get raw/processed chromatogram data
        baselines.py         # Set/get baselines per detector
        peaks.py             # Define/get peak ranges
        procedures.py        # Run analysis procedures
        results.py           # Get computed results
        distributions.py     # Get distribution plots/data
        reports.py           # Generate and download reports
        batch.py             # Batch processing endpoints
    
    services/
      file_import.py         # .afe8 parsing (wraps astra_reader.py)
      file_export.py         # .afe8 writing (save modified parameters back to file)
      baseline_engine.py     # Baseline computation and subtraction
      peak_engine.py         # Peak detection and selection
      alignment_engine.py    # Interdetector delay computation
      band_broadening.py     # Band broadening correction
      normalization.py       # MALS normalization
      concentration.py       # Concentration conversion
      molar_mass.py          # Molar mass & radius from LS (Zimm/Debye/Berry)
      #                         # Includes condition number check + NaN fallback
      distributions.py       # Differential/cumulative distributions
      moments.py             # Mn, Mw, Mz, polydispersity
      conjugate.py           # Protein conjugate / copolymer analysis
      branching.py           # Polymer branching calculations
      viscometry.py          # Intrinsic viscosity, MHS, universal cal
      column_calibration.py  # Conventional/universal calibration
      particle.py            # Number density, particle concentration
      error_analysis.py      # Uncertainty propagation
      report_engine.py       # Report generation (PDF/HTML)
      batch_processor.py     # One-to-many processing
    
    models/
      experiment.py          # SQLAlchemy models for stored data
      baseline.py
      peak.py
      procedure.py
      results.py
      user.py
    
    db/
      session.py             # Database session management
      base.py                # SQLAlchemy base
    
    schemas/
      # Pydantic schemas for API request/response validation
  
  astra_reader.py            # The existing file reader (core library)
  requirements.txt
  Dockerfile
```

### 3.4 Frontend Module Structure

```
frontend/
  src/
    App.tsx
    main.tsx
    
    components/
      layout/
        Sidebar.tsx          # Experiment tree, file list
        Header.tsx           # Navigation, user menu
        Workspace.tsx        # Main content area
      
      upload/
        FileUpload.tsx       # Drag-and-drop .afe8 upload
        BatchUpload.tsx      # Multi-file upload
      
      chromatogram/
        ChromatogramPlot.tsx  # Main interactive chromatogram (Plotly)
        DetectorSelector.tsx  # Toggle detectors/angles
        BaselineEditor.tsx    # Interactive baseline drag handles
        PeakSelector.tsx      # Interactive peak region selection
        ZoomControls.tsx
      
      analysis/
        ProcedureChain.tsx    # Visual procedure pipeline
        DespikingPanel.tsx
        BaselinePanel.tsx
        AlignmentPanel.tsx
        BandBroadeningPanel.tsx
        NormalizationPanel.tsx
        ConcentrationPanel.tsx
        PeakPanel.tsx
        MolarMassPanel.tsx
        FitPanel.tsx
        DistributionPanel.tsx
        ConjugatePanel.tsx
        BranchingPanel.tsx
        ViscometryPanel.tsx
        ConformationPanel.tsx
        CalibrationPanel.tsx
        ParticlePanel.tsx
      
      results/
        ResultsTable.tsx       # Summary results table
        EASITable.tsx          # Multi-run comparison table
        MomentsDisplay.tsx     # Mn, Mw, Mz, Pd display
      
      plots/
        ConformationPlot.tsx
        MarkHouwinkPlot.tsx
        DifferentialDistribution.tsx
        CumulativeDistribution.tsx
        MolarMassPlot.tsx      # M(v) overlay
        RadiusPlot.tsx         # Rg(v) overlay
        ZimmPlot.tsx
        AngularFitPlot.tsx
        CalibrationCurve.tsx
        NumberDensityPlot.tsx
        BranchingPlots.tsx
      
      reports/
        ReportDesigner.tsx
        ReportPreview.tsx
        ReportExport.tsx
      
      tables/
        EASITable.tsx
        PeakStatisticsTable.tsx
        ResultsTable.tsx
    
    stores/
      experimentStore.ts      # Current experiment state
      baselineStore.ts        # Baseline state per detector
      peakStore.ts            # Peak range state
      procedureStore.ts       # Procedure chain state
      settingsStore.ts        # Global settings
    
    api/
      client.ts               # Axios/fetch wrapper
      endpoints.ts            # API endpoint definitions
    
    types/
      experiment.ts           # TypeScript interfaces
      chromatogram.ts
      baseline.ts
      peak.ts
      results.ts
      procedures.ts
```

### 3.5 Data Flow

```
1. User uploads .afe8 file
   Frontend --> POST /api/files/upload --> Backend
   Backend: gzip decompress --> SQLite --> astra_reader.py --> parse metadata + raw data
   Backend: Store experiment record in SQLite, raw data in file store
   Backend --> Return experiment summary --> Frontend displays

2. User views chromatogram
   Frontend --> GET /api/chromatograms/{exp_id} --> Backend
   Backend: Load raw data from store, apply current procedure chain
   Backend --> Return JSON {time[], detectors: {MALS: [[]], UV: [[]], RI: []}} --> Frontend
   Frontend: Render with Plotly.js, interactive zoom/pan

3. User sets baseline (interactive)
   Frontend: User drags baseline handles on chromatogram
   Frontend --> PUT /api/baselines/{exp_id}/{detector} --> Backend
   Backend: Store baseline {detector, type, x1, y1, x2, y2}
   Backend: Recompute baseline-subtracted data
   Backend --> Return updated chromatogram --> Frontend re-renders

4. User defines peak (interactive)
   Frontend: User drags peak region on chromatogram
   Frontend --> PUT /api/peaks/{exp_id} --> Backend
   Backend: Store peak {start, end, dn_dc, ls_model, fit_degree, ...}
   Backend: Trigger recomputation of molar mass, radius, moments
   Backend --> Return updated results --> Frontend displays

5. User runs "One-Click Analysis"
   Frontend --> POST /api/procedures/{exp_id}/auto --> Backend
   Backend: Execute full procedure chain:
     1. Despiking
     2. Auto-baseline (all detectors)
     3. Auto-alignment
     4. Band broadening
     5. Normalization
     6. Convert to physical units
     7. Convert to concentration
     8. Auto-peak detection
     9. Molar mass & radius from LS
     10. Distributions & moments
   Backend --> Return all results --> Frontend displays everything

6. User exports report
   Frontend --> POST /api/reports/{exp_id}/generate --> Backend
   Backend: Jinja2 template --> HTML --> WeasyPrint --> PDF
   Backend --> Return PDF download --> Frontend triggers download
```

### 3.6 Backup & Integrity Strategy

SQLite on a lab machine is vulnerable to power loss, disk failure, and accidental
deletion. The following measures protect user data:

- **Startup integrity check:** Run `PRAGMA integrity_check` on application startup;
  if it fails, alert the user and halt (do not silently continue with a corrupt DB).
- **Automated nightly backup:** Use SQLite's `VACUUM INTO` to create a consistent
  snapshot backup every night (e.g., `astra_backup_YYYYMMDD.sqlite`).
- **Backup retention:** Keep 30 days of backups; older backups are auto-deleted.
- **Recovery procedure:** Documented in the deployment guide: stop the app, copy
  the most recent valid backup to the data directory, restart.
- **Atomic file writes:** When exporting `.afe8` files, write to a temporary file
  first, then atomically rename. This prevents corruption if the process crashes
  mid-write.
- **Process supervision:** Deploy with systemd (Linux) or NSSM (Windows) with
  `Restart=always` and a health check endpoint (`GET /api/health`).

---

## 4. Database Schema (SQLite)

> Using SQLite for local deployment simplicity. WAL mode enabled for
> concurrent multi-user reads. The schema uses SQLAlchemy models so
> migration to PostgreSQL is trivial if needed later.

```sql
-- Users (lightweight, no passwords needed for local lab)
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name VARCHAR(200) NOT NULL,
    session_token VARCHAR(128),
    last_active TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Uploaded experiments
CREATE TABLE experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name VARCHAR(500) NOT NULL,
    original_path VARCHAR(1000),
    file_size BIGINT,
    file_hash VARCHAR(64),              -- SHA-256 for dedup
    
    -- Metadata extracted from .afe8
    sample_name VARCHAR(200),
    solvent_name VARCHAR(100),
    solvent_description VARCHAR(500),
    operator_name VARCHAR(200),
    collection_time TIMESTAMP,
    processing_time TIMESTAMP,
    astra_version VARCHAR(50),
    
    -- Instrument config (JSON)
    mals_config TEXT  -- JSON stored as text,                  -- {name, angles, wavelength, num_detectors, ...}
    ri_config TEXT  -- JSON stored as text,
    uv_config TEXT  -- JSON stored as text,
    viscometer_config TEXT  -- JSON stored as text,
    sample_config TEXT  -- JSON stored as text,                -- {dn_dc, concentration, ...}
    fluid_path TEXT  -- JSON stored as text,                   -- [{from, to, name}, ...]
    
    -- Raw data reference
    raw_data_path VARCHAR(1000),        -- Path to stored decompressed SQLite
    
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    version INTEGER DEFAULT 1                   -- optimistic locking for multi-user
);

-- Baselines (one per detector per experiment)
CREATE TABLE baselines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE CASCADE,
    detector_name VARCHAR(100),         -- "MALS_det1", "MALS_det2", "RI", "UV_ch1", etc.
    detector_class VARCHAR(100),        -- "WHeleos8Profile", "WNGOInstrumentProfile", etc.
    baseline_type INTEGER,              -- 0=constant, 1=linear, 2=point-pair
    x1 DOUBLE PRECISION,
    x2 DOUBLE PRECISION,
    y1 DOUBLE PRECISION,
    y2 DOUBLE PRECISION,
    slope DOUBLE PRECISION,
    intercept DOUBLE PRECISION,
    std_dev DOUBLE PRECISION,
    is_auto BOOLEAN DEFAULT FALSE,
    version INTEGER DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Peak ranges
CREATE TABLE peaks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE CASCADE,
    range_number INTEGER,
    range_name VARCHAR(200),
    range_start DOUBLE PRECISION,       -- minutes
    range_end DOUBLE PRECISION,         -- minutes
    range_type INTEGER,
    
    -- Sample parameters for this peak
    dn_dc DOUBLE PRECISION,
    uv_extinction DOUBLE PRECISION,
    concentration DOUBLE PRECISION,
    injected_mass DOUBLE PRECISION,
    real_ri DOUBLE PRECISION,
    
    -- LS analysis parameters
    ls_model INTEGER,                   -- 0=Zimm, 1=Debye, 2=Berry, etc.
    ls_fit_degree INTEGER,
    radius_type INTEGER,
    radius_seed DOUBLE PRECISION,
    a2 DOUBLE PRECISION,
    
    -- Computed results (filled after analysis)
    mn DOUBLE PRECISION,
    mw DOUBLE PRECISION,
    mz DOUBLE PRECISION,
    polydispersity DOUBLE PRECISION,
    rms_radius DOUBLE PRECISION,
    peak_area DOUBLE PRECISION,
    recovery DOUBLE PRECISION,
    
    is_auto BOOLEAN DEFAULT FALSE,
    version INTEGER DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Procedure chain state
CREATE TABLE procedure_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE CASCADE,
    procedure_name VARCHAR(100),        -- "despiking", "baselines", "alignment", etc.
    procedure_order INTEGER,
    is_enabled BOOLEAN DEFAULT TRUE,
    has_been_run BOOLEAN DEFAULT FALSE,
    parameters TEXT  -- JSON stored as text,                   -- All procedure-specific params
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Computed results (per slice data, stored for caching)
CREATE TABLE computed_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE CASCADE,
    peak_id INTEGER REFERENCES peaks(id) ON DELETE CASCADE,
    data_type VARCHAR(100),             -- "molar_mass", "radius", "concentration", etc.
    data_values TEXT  -- JSON stored as text,                  -- {time: [], values: []} or matrix
    uncertainties TEXT  -- JSON stored as text,
    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Report templates
CREATE TABLE report_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(200),
    template_config TEXT  -- JSON stored as text,              -- {sections, fields, formatting, logo_path}
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Method templates (reusable analysis settings)
CREATE TABLE method_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(200),
    description TEXT,
    template TEXT  -- JSON stored as text,                     -- Complete procedure chain + parameters
    is_public BOOLEAN DEFAULT FALSE,
    shared_with TEXT,                                           -- JSON array of user IDs, or NULL for all
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Batch processing jobs
CREATE TABLE batch_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_by INTEGER REFERENCES users(id),
    source_experiment_id INTEGER REFERENCES experiments(id),
    target_experiment_ids TEXT,              -- JSON array of experiment IDs
    settings_to_propagate TEXT,              -- JSON: which settings to copy
    status VARCHAR(20),                      -- pending, running, completed, failed
    progress_pct DOUBLE PRECISION,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- EASI tables (multi-run comparison summaries)
CREATE TABLE easi_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(200),
    experiment_ids TEXT,                     -- JSON array
    column_config TEXT,                      -- JSON: which columns to include
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4.1 Database Indexes

```sql
CREATE INDEX idx_baselines_experiment ON baselines(experiment_id);
CREATE INDEX idx_peaks_experiment ON peaks(experiment_id);
CREATE UNIQUE INDEX idx_peaks_experiment_number ON peaks(experiment_id, range_number);
CREATE INDEX idx_procedure_states_experiment ON procedure_states(experiment_id);
CREATE INDEX idx_computed_data_experiment ON computed_data(experiment_id);
CREATE INDEX idx_computed_data_peak ON computed_data(peak_id);
CREATE INDEX idx_experiments_sample ON experiments(sample_name);
CREATE INDEX idx_experiments_created ON experiments(created_at);
CREATE UNIQUE INDEX idx_experiments_file_hash ON experiments(file_hash);
```

### 4.2 SQLite Concurrency Note

WAL mode allows concurrent reads but **all writes serialize**. For 2-3 concurrent
users this is tolerable. For 5+ simultaneous users actively modifying experiments,
write contention will degrade performance. If this becomes an issue, migrating to
PostgreSQL (via SQLAlchemy) is straightforward. The `version` column on
`experiments` implements optimistic locking: when updating, check `version` hasn't
changed since last read; if it has, reject the write and inform the user.

### 4.3 Foreign Key Enforcement

SQLite disables foreign keys by default. The application must execute
`PRAGMA foreign_keys = ON` on every connection. All child tables use
`ON DELETE CASCADE` so deleting an experiment automatically removes its
baselines, peaks, procedure states, and computed data.

### 4.4 Audit Log

For lab bookkeeping, every mutating API call appends a row to the audit log:

```sql
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,          -- create, update, delete, export, analyze
    entity_type VARCHAR(50) NOT NULL,     -- experiment, baseline, peak, procedure, report
    entity_id INTEGER,
    changes TEXT,                          -- JSON diff of changed fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_experiment ON audit_log(experiment_id, created_at);
```

### 4.5 Session Management

```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    revoked BOOLEAN DEFAULT FALSE,
    ip_address VARCHAR(45),
    user_agent TEXT
);

CREATE UNIQUE INDEX idx_sessions_token ON sessions(token_hash);
```

Session tokens expire after 7 days of inactivity and are revoked on logout.

### 4.6 Large Array Storage

Time-series and matrix results are stored as compressed binary files on disk
(NumPy `.npz` or Parquet). The `computed_data` table holds only the file path,
shape, dtype, and hash; the JSON `data_values` field is reserved for small
scalar/annotation data.

---

## 5. API Endpoints

### 5.1 Authentication & Health
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Lightweight login (enter display name, get session token) |
| POST | `/api/auth/logout` | End session |
| GET | `/api/auth/me` | Get current user info |
| GET | `/api/health` | Health check for Docker/monitoring |

### 5.2 File Management
| Method | Path | Description |
|---|---|---|
| POST | `/api/files/upload` | Upload one or more `.afe8` files |
| GET | `/api/files` | List all uploaded experiments (supports `?page=&limit=&sample_name=&date_from=&date_to=`) |
| GET | `/api/files/{id}` | Get experiment metadata |
| DELETE | `/api/files/{id}` | Delete experiment and all associated data |
| POST | `/api/files/{id}/export` | Export modified .afe8 file (with updated baselines, peaks, etc.) |

### 5.3 Raw Data
| Method | Path | Description |
|---|---|---|
| GET | `/api/experiments/{id}/chromatograms` | Get all chromatogram data (raw) |
| GET | `/api/experiments/{id}/chromatograms/{detector}` | Get specific detector data |
| GET | `/api/experiments/{id}/instruments` | Get instrument configuration |
| GET | `/api/experiments/{id}/solvent` | Get solvent info |
| GET | `/api/experiments/{id}/sample` | Get sample info |
| GET | `/api/experiments/{id}/fluid-path` | Get fluid connection chain |
| GET | `/api/experiments/{id}/detectors` | List detectors/angles/channels with codes and enabled flags |

### 5.4 Baselines
| Method | Path | Description |
|---|---|---|
| GET | `/api/experiments/{id}/baselines` | Get all baselines |
| PUT | `/api/experiments/{id}/baselines/{detector}` | Set/update baseline |
| POST | `/api/experiments/{id}/baselines/auto` | Auto-detect baselines |
| DELETE | `/api/experiments/{id}/baselines/{detector}` | Reset baseline |
| POST | `/api/experiments/{id}/baselines/blank-subtract` | Subtract a blank-run experiment from current |

### 5.5 Peaks
| Method | Path | Description |
|---|---|---|
| GET | `/api/experiments/{id}/peaks` | Get all peak ranges |
| POST | `/api/experiments/{id}/peaks` | Create new peak range |
| PUT | `/api/experiments/{id}/peaks/{peak_id}` | Update peak range/params |
| DELETE | `/api/experiments/{id}/peaks/{peak_id}` | Delete peak range |
| POST | `/api/experiments/{id}/peaks/auto` | Auto-detect peaks |

### 5.6 Procedures
| Method | Path | Description |
|---|---|---|
| GET | `/api/experiments/{id}/procedures` | Get procedure chain state |
| PUT | `/api/experiments/{id}/procedures/{name}` | Update procedure parameters |
| POST | `/api/experiments/{id}/procedures/run` | Run full procedure chain |
| POST | `/api/experiments/{id}/procedures/{name}/run` | Run single procedure |
| POST | `/api/experiments/{id}/auto-analyze` | One-click full analysis |

### 5.7 Results
| Method | Path | Description |
|---|---|---|
| GET | `/api/experiments/{id}/results` | Get all computed results |
| GET | `/api/experiments/{id}/results/peaks` | Get per-peak results |
| GET | `/api/experiments/{id}/results/moments` | Get Mn, Mw, Mz, Pd |
| GET | `/api/experiments/{id}/results/distributions?type=diff\|cum&bins=auto\|N&smoothing=&range_min=&range_max=` | Get distribution data with controls |
| GET | `/api/experiments/{id}/results/molar-mass` | Get M(v) slice data |
| GET | `/api/experiments/{id}/results/radius` | Get Rg(v) slice data |
| GET | `/api/experiments/{id}/results/conformation` | Get conformation plot data |
| GET | `/api/experiments/{id}/export/csv` | Export raw/processed data as CSV |

### 5.8 Reports
| Method | Path | Description |
|---|---|---|
| GET | `/api/reports/templates` | List report templates |
| POST | `/api/reports/templates` | Create report template |
| POST | `/api/experiments/{id}/reports/generate` | Queue report generation; returns 202 with job ID |
| GET | `/api/experiments/{id}/reports/{job_id}/status` | Poll report generation status |
| GET | `/api/experiments/{id}/reports/{job_id}/download` | Download completed report |

### 5.9 Batch Processing
| Method | Path | Description |
|---|---|---|
| POST | `/api/batch/apply` | Apply settings from one experiment to others |
| GET | `/api/batch/{job_id}/status` | Check batch job status |
| GET | `/api/batch/{job_id}/results` | Get batch job results |
| GET | `/api/batch` | List all batch jobs (history) |
| DELETE | `/api/batch/{job_id}` | Cancel a running batch job |

### 5.10 EASI Table
| Method | Path | Description |
|---|---|---|
| POST | `/api/easi-table` | Create EASI table from multiple experiments |
| GET | `/api/easi-table/{id}` | Get EASI table data |
| GET | `/api/easi-table/{id}/export` | Export EASI table as CSV |

### 5.11 Method Templates
| Method | Path | Description |
|---|---|---|
| GET | `/api/methods` | List method templates (public + owned) |
| POST | `/api/methods` | Create new method template |
| GET | `/api/methods/{id}` | Get method template details |
| PUT | `/api/methods/{id}` | Update method template (owner or admin) |
| DELETE | `/api/methods/{id}` | Delete method template |
| POST | `/api/experiments/{id}/methods/{method_id}/apply` | Apply method template to experiment |

### 5.12 WebSocket
| Method | Path | Description |
|---|---|---|
| WS | `/api/experiments/{id}/progress` | Real-time procedure progress updates |

**WebSocket message protocol:**
- `progress` — `{type: "progress", procedure: "baselines", pct: 45, message: "Computing..."}`
- `error`    — `{type: "error", procedure: "molar_mass", message: "Fit failed at slice 234"}`
- `complete` — `{type: "complete", results_url: "/api/experiments/123/results"}`

### 5.13 Standard Error Response

All API errors return a consistent JSON body:

```json
{
  "type": "about:blank",
  "title": "MALS fit failed",
  "detail": "Fit did not converge at slice 234; condition number exceeded threshold.",
  "status": 422,
  "instance": "/api/experiments/123/results/molar-mass",
  "procedure": "molar_mass",
  "slice": 234
}
```

All mutating endpoints (PUT/POST/DELETE) on experiments, baselines, peaks, and
procedure states include an `X-Resource-Version` header. The server returns
`409 Conflict` if the version mismatches (optimistic locking).
---

## 6. Development Phases

### Phase 1: MVP - Core Import & View (Weeks 1-3)
**Goal:** Upload files, view chromatograms, see metadata

- [x] Backend: FastAPI skeleton + file upload endpoint
- [x] Backend: Integrate `astra_reader.py` for parsing
- [x] Backend: Validate uploads (check magic bytes 1f 8b + SQLite header, file size limit)
- [x] Backend: Open decompressed SQLite in read-only mode (mode=ro) during parsing
- [x] Backend: Sanitize table_name in raw_query against sqlite_master whitelist
- [x] Backend: `.afe8` health check endpoint (validate gzip + SQLite + required tables)
- [x] Backend: Generalize instrument profile lookup (WHeleos8, WHeleosNeon, WMiniDawn, WTreos)
- [x] Backend: Experiment metadata API
- [x] Backend: Raw chromatogram data API
- [x] Frontend: File upload UI (drag-and-drop)
- [x] Frontend: Experiment metadata display
- [x] Frontend: Basic chromatogram plot (all detectors, Plotly.js)
- [x] Frontend: Detector toggle/selection
- [x] Frontend: Zoom/pan on chromatogram
- [x] Docker setup (docker-compose)
- [ ] **Design:** .afe8 round-trip write strategy (which tables to write, BLOB re-compression approach, unknown table preservation) (deferred to Phase 7)
- [ ] **Backend:** Read-only round-trip proof of concept: read .afe8, write back byte-for-byte, re-read, verify equality of key tables and BLOBs (deferred to Phase 7)

### Phase 2: Interactive Baselines & Peaks (Weeks 4-6)
**Goal:** Users can set baselines and select peaks interactively, with dn/dc entry and alignment design

- [ ] Backend: Baseline storage and computation
- [ ] Backend: Peak range storage
- [ ] Backend: Baseline-subtracted chromatogram API
- [ ] Backend: dn/dc library (literature values for common polymer/solvent pairs)
- [ ] Backend: Manual dn/dc entry with validation (warn if outside 0.05-0.30 mL/g)
- [ ] Backend: Interdetector delay/alignment algorithm design (cross-correlation approach)
- [ ] Backend: Write updated baselines back to WBaseline table in .afe8
- [ ] Backend: Write updated peak ranges back to WPeakRange table in .afe8
- [ ] Frontend: Interactive baseline editor (drag handles on plot)
- [ ] Frontend: Auto-baseline button
- [ ] Frontend: Interactive peak selector (drag region on plot)
- [ ] Frontend: Peak parameter form (dn/dc, concentration, LS model, etc.)
- [ ] Frontend: Auto-peak detection
- [ ] Frontend: Per-detector baseline view

### Phase 3a: Core Auto-Analysis (Weeks 7-12)
**Goal:** One-click analysis produces molar mass and moments using Zimm 1st-order

- [ ] Backend: Despiking engine (median filter with MAD threshold; levels: off/light/medium/heavy)
- [ ] Backend: Interdetector delay/alignment engine (cross-correlation of RI and LS signals)
- [ ] Backend: MALS normalization engine
- [ ] Backend: Concentration conversion engine (uses dn/dc from Phase 2)
- [ ] Backend: Molar mass from LS (Zimm 1st-order fit only)
- [ ] Backend: Radius from LS (Rg per slice)
- [ ] Backend: Moments calculation (Mn, Mw, Mz, Pd)
- [ ] Backend: Simple binned distribution
- [ ] Backend: Procedure chain orchestrator (core)
- [ ] Frontend: Procedure chain UI (visual pipeline)
- [ ] Frontend: Molar mass vs. volume plot (M(v) overlay)
- [ ] Frontend: Radius vs. volume plot (Rg(v) overlay)
- [ ] Frontend: Results table (Mn, Mw, Mz, Pd, radius)
- [ ] Frontend: "One-Click Analysis" button
- [ ] **Validate:** Compare Mn/Mw/Mz against ASTRA PS 30kDa results immediately

### Phase 3b: Advanced Fits & Distributions (Weeks 13-18)
**Goal:** Debye/Berry fits, band broadening, KDE distributions, angular fit view

- [ ] Backend: Band broadening correction engine (exponential deconvolution)
- [ ] Backend: Debye and Berry fit models (in addition to Zimm)
- [ ] Backend: 2nd-order fit support
- [ ] Backend: KDE distribution calculation (differential + cumulative, via scipy.stats.gaussian_kde)
- [ ] Backend: Per-slice angular fit quality metrics
- [ ] Backend: Procedure chain orchestrator (full, with band broadening)
- [ ] Frontend: Differential distribution plot (KDE)
- [ ] Frontend: Cumulative distribution plot
- [ ] Frontend: Angular fit view (per-slice MALS fit visualization)
- [ ] Frontend: Fit model selector (Zimm/Debye/Berry, 1st/2nd order)
- [ ] **Validate:** Compare distributions against ASTRA qualitatively

### Phase 4: Advanced Analysis (Weeks 19-28)
**Goal:** Conformation, branching, viscometry, conjugate analysis

- [ ] Backend: Conformation plot data (log Rg vs. log M)
- [ ] Backend: Protein conjugate / copolymer analysis
- [ ] Backend: Branching analysis (tri/tetra/star/comb)
- [ ] Backend: Viscometry analysis (intrinsic viscosity, MHS)
- [ ] Backend: Mark-Houwink-Sakurada plot data
- [ ] Backend: Conventional & universal calibration
- [ ] Backend: Particle concentration & number density
- [ ] Backend: Peak statistics (plate count, asymmetry, etc.)
- [ ] Backend: dn/dc determination from known concentration (100% mass recovery)
- [ ] Backend: dn/dc from RI calibration constant
- [ ] Backend: Error analysis & uncertainty propagation
- [ ] Frontend: Conformation plot component
- [ ] Frontend: Mark-Houwink plot component
- [ ] Frontend: Conjugate analysis panel
- [ ] Frontend: Branching analysis panel
- [ ] Frontend: Viscometry panel
- [ ] Frontend: Calibration curve panel
- [ ] Frontend: Peak statistics table

### Phase 5: Reporting & Export (Weeks 29-33)
**Goal:** Generate professional reports, export data

- [ ] Backend: Report template engine (Jinja2)
- [ ] Backend: PDF generation (WeasyPrint)
- [ ] Backend: HTML report generation
- [ ] Backend: CSV export
- [ ] Backend: Excel (.xlsx) export via openpyxl
- [ ] Frontend: Report designer UI
- [ ] Frontend: Report preview
- [ ] Frontend: Export buttons (PDF, CSV, HTML)
- [ ] Frontend: Report template management

### Phase 6: Batch & Automation (Weeks 34-38)
**Goal:** Process multiple files, method templates

- [ ] Backend: One-to-many batch processor
- [ ] Backend: Method template save/load
- [ ] Frontend: Batch upload & processing UI
- [ ] Frontend: Method template manager
- [ ] Frontend: EASI Table (multi-run comparison)
- [ ] Frontend: EASI Graph (overlay multiple runs)

### Phase 7: Advanced Export & Polish (Weeks 39-44)
**Goal:** Advanced export formats, computed result writing, UI polish

- [ ] Backend: Write computed results back to WResultData/WScalarData in .afe8
- [ ] Backend: Write updated procedure parameters back to procedure tables
- [ ] Backend: Advanced .afe8 export options (filtered data, partial writes)
- [ ] Backend: Verify round-trip integrity for all writable tables
- [ ] Frontend: "Save .afe8" button (basic save already works from Phase 2)
- [ ] Frontend: "Save As" (create copy with modifications)
- [ ] Frontend: Unsaved changes indicator
- [ ] Frontend: Export to HTML report format

### Phase 8: Polish & Specialized (Weeks 45-50)
**Goal:** A2/Zimm, dn/dc, absorption correction, final polish

- [ ] Backend: Second virial coefficient (A2) / Zimm plot
- [ ] Backend: Absorption correction (forward monitor)
- [ ] Frontend: Zimm plot component
- [ ] Frontend: dn/dc determination panel
- [ ] Backend: Performance optimization (caching, lazy loading)
- [ ] Comprehensive test suite (validate against ASTRA results)
- [ ] Documentation
- [ ] Docker deployment finalized for local lab machine

---

## 7. Key Technical Decisions to Make

### 7.1 Data Storage Strategy
**Question:** How should we store and cache parsed data?

**Recommendation:** Keep the original `.afe8` on disk as the immutable source of
truth. Decompress to a temporary SQLite only when needed for parsing. Cache
extracted chromatogram arrays on disk as NumPy `.npz` or Parquet files keyed by
`(experiment_id, detector, revision)`. Store metadata, baselines, peaks,
procedure parameters, and results in the application SQLite database. Do not
store full chromatogram arrays as JSON text in SQLite. Invalidate the cache
when baselines, peaks, or procedure parameters change.

### 7.2 Real-time vs. Batch Recomputation
**Question:** When a user adjusts a baseline, should all downstream results
recompute immediately (real-time) or on demand?

**Recommendation:** Real-time for visual feedback (baseline-subtracted
chromatogram), but defer heavy computations (molar mass, distributions) until
the user clicks "Recompute" or "Run Analysis". Use WebSocket for progress
updates on long-running computations.

### 7.3 Charting Library
**Question:** Plotly.js vs. D3.js vs. uPlot?

**Recommendation:** **Plotly.js** for the MVP. It has built-in zoom/pan/hover,
supports scientific plots natively, and handles 5860+ points comfortably (SVG
mode handles 10k-50k points). For multi-angle overlays (8 MALS + UV + RI = 12+
traces), use `scattergl` (WebGL) for the overlay if DOM complexity becomes an
issue. The real performance concern is not rendering but **incremental
recomputation**: every baseline drag should only recompute what's necessary,
not the full procedure chain. Target: < 2 seconds for full recompute. D3.js
can be used for custom visualizations later.

### 7.4 MALS Fit Models Implementation
**Question:** How to implement the Zimm, Debye, and Berry fits?

**Recommendation:** Start with **Zimm fit** (1st order, most common). Use
`scipy.optimize.curve_fit` or `numpy.polyfit` for the angular extrapolation.
The key equations:

The optical constant for Rayleigh scattering is:

    K = 4*pi^2 * n_0^2 * (dn/dc)^2 / (N_A * lambda_0^4)

where n_0 is the solvent refractive index, dn/dc is the specific refractive
increment, N_A is Avogadro's number, and lambda_0 is the laser wavelength in
vacuum. For UV-based concentration, replace (dn/dc) with the extinction
coefficient epsilon (path-length-corrected).

- **Zimm**: K*c/R(theta) = 1/M * (1 + (16*pi^2/3*lambda^2) * <Rg^2> * sin^2(theta/2)) + 2*A2*c
- **Debye**: R(theta)/K*c = M * (1 - (16*pi^2/3*lambda^2) * <Rg^2> * sin^2(theta/2)) - 2*A2*c*M^2
- **Berry**: sqrt(K*c/R(theta)) = 1/sqrt(M) * (1 + (8*pi^2/3*lambda^2) * <Rg^2> * sin^2(theta/2)) + A2*c*sqrt(M)

> **Note on wavelength (lambda):** In the angular term, lambda is the wavelength
> in solution (lambda = lambda_0 / n_0). When K is defined as 4*pi^2 * n_0^2 * (dn/dc)^2
> / (N_A * lambda_0^4), using lambda_solution in the angular term is consistent.
> If K is instead defined without the explicit n_0^2 factor, multiply the angular
> term by n_0^2 to keep the equations consistent.
> For the DAWN 8 at 662.72 nm in THF (n_0 ~ 1.40), lambda_solution ~ 473 nm.
>
> **Note on Debye approximation:** The Debye form shown above is a first-order
> expansion valid for small particles (Rg < lambda/20). For larger particles,
> the exact Debye form 1/(M*P(theta)) + 2*A2*c should be used, where P(theta)
> is the full form factor.

### 7.5 Band Broadening Algorithm
**Question:** The patented Wyatt algorithm is proprietary. How to handle?

**Recommendation:** Implement a standard exponential deconvolution approach
as a starting point. The mixing volume model (exponential tail with time
constant = V_mixing / flow_rate) is well-documented in chromatography
literature. This won't match Wyatt's patented algorithm exactly but will
provide reasonable correction. Can be improved over time.

**Known limitations to document:**
- Real SEC band broadening is asymmetric (sharp front, exponential tail). A
  symmetric model will under-correct the leading edge and over-correct the tail.
- UV (before MALS) and RI (after MALS) experience different broadening due to
  different flow path lengths and cell volumes.
- At high concentrations, viscous fingering adds non-linear broadening.
- Results will improve peak shape but may not match ASTRA quantitatively.

### 7.6 Distribution Calculation
**Question:** Wyatt uses a proprietary adaptive binning algorithm. Alternative?

**Recommendation:** Implement a kernel density estimation (KDE) approach using
`scipy.stats.gaussian_kde` for the differential distribution. For cumulative,
integrate the per-slice molar mass data weighted by concentration. This is a
well-established method and will produce good results.

**Performance note:** `gaussian_kde` is O(N^2) and can be slow for large
chromatograms. For datasets > 5,000 slices, use FFTKDE or a binned estimator
with configurable bandwidth. Expose `bandwidth`, `kernel`, and `bin_count`
parameters in the API and UI. Document that the distribution is an
approximation of Wyatt's proprietary adaptive binning algorithm.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Proprietary algorithms (band broadening, distributions) can't be exactly replicated | High | Medium | Use standard algorithms from literature; document differences. Band broadening will improve peak shape but may not match ASTRA quantitatively. |
| MALS fit models are mathematically complex | Medium | High | Start with Zimm 1st order; add models incrementally; validate against ASTRA results |
| User expects exact match with ASTRA desktop results | High | High | Document that this is an independent implementation; focus on "good enough" accuracy |
| `.afe8` format may change with future ASTRA versions | Low | Medium | Version detection in header; adaptive parsing |
| Multiple detector configurations (DAWN, TREOS, miniDAWN, Optilab models) | Medium | Medium | Use class-based instrument profiles; handle unknown instruments gracefully |
| **SQLite corruption from power loss or crash** | Medium | **Critical** | WAL mode + `PRAGMA integrity_check` on startup + nightly `VACUUM INTO` backup + 30-day retention |
| **Single backend process = single point of failure** | Medium | High | Deploy with systemd/NSSM `Restart=always` + health check endpoint + gunicorn multi-worker for production |
| **Numerical instability in MALS fitting** (low angles, large Rg) | Medium | High | Condition number checking; fall back to lower fit orders; warn users when results are unreliable |
| **Incorrect results due to dn/dc errors** (Mw ~ 1/(dn/dc)^2) | High | High | Validate dn/dc against literature values; warn on extreme values; provide dn/dc library |
| **Band broadening: asymmetric broadening not captured** | Medium | Medium | Start with symmetric exponential model; note limitation; improve with asymmetric model later |
| **Knowledge bus factor of 1** (format knowledge concentrated in one person) | High | High | Document .afe8 format spec separately from code; write MALS fitting theory doc with references |
| **No ASTRA validation until late in development** | High | High | Validate each engine against PS 30kDa test case as soon as it's built (Phase 3a onward) |

---

## 9. Testing Strategy

### 9.1 Validation Against ASTRA
- Use the provided `PS 30kDa 5mg-ml` file as a test case
- Compare our computed Mn, Mw, Mz against ASTRA's results:
  - ASTRA Mn = 10,231 | Mw = 15,623 | Mz = 24,019 | Pd = 1.527
- Compare chromatogram shapes and peak positions
- Compare distribution plots qualitatively
- **Continuous validation:** Each analysis engine is validated against the PS
  30kDa test case as soon as it's built (Phase 3a onward), not deferred to the end.
- **Acceptance tolerances:**
  - Mn/Mw/Mz must agree with ASTRA to within +/-2% relative for the PS 30kDa standard
  - Polydispersity must agree to within +/-3% relative
  - Distribution peak position must agree to within +/-5% relative
  - If an engine exceeds tolerance, it is blocked from promotion to the next phase
- **Scope note:** Testing focuses on MALS + UV + RI analysis. DLS/QELS,
  viscometry, viral vector, and LNP features are out of scope.

### 9.2 Unit Tests
- `astra_reader.py`: BLOB decoding, all data types, edge cases
- Baseline engine: linear, constant, point-pair, auto-detection
- Peak engine: auto-detection, manual ranges, edge cases
- Molar mass: Zimm fit against known standards
- Distributions: KDE vs. binned, cumulative integration

### 9.3 Integration Tests
- Full procedure chain end-to-end
- File upload -> parse -> analyze -> report generation
- Batch processing with multiple files

### 9.4 .afe8 Round-Trip Tests
For a representative set of files:
1. Read original `.afe8` with `astra_reader.py` and record metadata + selected BLOBs
2. Modify baselines and peak ranges
3. Write a new `.afe8` using the writer
4. Re-read the new file
5. Assert key tables match the modifications and all untouched tables/BLOBs are
   preserved byte-for-byte

### 9.5 Multi-User Concurrency Tests
- Simulate two users editing the same experiment's baselines concurrently;
  expect one `409 Conflict` and the other to succeed
- Verify SQLite WAL mode allows concurrent reads during a long analysis write
- Measure p95 response time for baseline updates under 5 concurrent users

### 9.6 Frontend Tests
- Chromatogram rendering and detector toggling (React Testing Library + mocked Plotly)
- Baseline handle drag and peak region selection interactions
- "One-Click Analysis" button state machine

### 9.7 Security Tests
- Upload of non-.afe8 files rejected by magic-byte check
- Path traversal attempts in file names sanitized
- SQL injection in raw_query table-name parameter blocked by whitelist

---

## 10. Resolved Design Decisions

All design questions have been confirmed with the user:

| # | Question | Decision |
|---|---|---|
| 1 | Deployment target | **Self-hosted on local lab machine** (not cloud) |
| 2 | Multi-user | **Yes** - multiple scientists use simultaneously. Hybrid JS frontend + Python API backend |
| 3 | Architecture choice | **Option 2: API backend for server-side analysis** (Python handles all numerical computation; JS handles UI) |
| 4 | Instrument control | **No** - read-only, post-collection analysis only |
| 5 | DLS support | **No** - focus on MALS, UV, RI only |
| 6 | Regulatory compliance | **Not needed** - no 21 CFR Part 11 |
| 7 | File writing | **Yes** - allow saving modified .afe8 files back to disk |
| 8 | Third-party detectors | **No** - work with Wyatt instruments as-is (DAWN, Optilab, UV) |
| 9 | Priority features | Baseline per detector, peak selection, auto Mn/Mw/Mz, polydispersity, distributions |

### Architecture Rationale: Hybrid JS + Python

The user identified two options:
1. **All JS** - parse and analyze entirely in the browser
2. **API backend** - Python server handles analysis, JS handles UI

We chose **Option 2** because:
- `astra_reader.py` already works and is tested
- NumPy/SciPy provide the numerical primitives needed for MALS fits, distributions
- Porting all analysis to JS would be a massive rewrite with accuracy risk
- The Python backend runs on the lab machine; all users connect via browser
- File I/O (reading/writing .afe8) is cleaner in Python (gzip + sqlite3)
- The backend can handle multiple concurrent users via async FastAPI

The frontend is still a normal web app (React + Plotly.js) - it just talks to
the Python API instead of doing computation itself. This is the standard
architecture for scientific web applications.

---

## Appendix A: Procedure Chain from the Database

The `WDirectoryEntry` table in the `.afe8` file lists these procedures in order:

| # | Name | Table | Purpose |
|---|---|---|---|
| 1 | Basic Collection | WBasicCollectionProcedure | Data acquisition settings |
| 2 | Despiking Procedure | WDespikingProcedure | Remove signal spikes |
| 3 | Define Baselines | WDefineBaselinesProcedure | Set baseline per detector |
| 4 | Alignment | WDetermineInterDetectorDelayProcedure | Interdetector delay correction |
| 5 | Dilution Factor | WDilutionFactorProcedure | Dilution correction |
| 6 | Band Broadening | WDetermineBandBroadeningProcedure | Interdetector dispersion correction |
| 7 | Normalization | WNormalizationProcedure | MALS detector normalization |
| 8 | Convert to Physical Units | WConvertToPhysicalUnitsProcedure | Apply calibration constants |
| 9 | Convert to Concentration | WConvertToConcentrationProcedure | Convert signal to concentration |
| 10 | Define Peaks | WDefinePeaksProcedure | Peak region selection |
| 11 | Peak Areas | WPeakAreasProcedure | Compute peak areas |
| 12 | Determine Mass and Radius from LS | WDetermineMassAndRadiusFromLSProcedure | Molar mass & Rg per slice |
| 13 | Determine Extinction from RI | WDetermineExtinctionFromRIProcedure | UV extinction from RI |
| 14 | Fit Mass or Radius | WFitMassOrRadiusProcedure | LS fit model & order |
| 15 | Determine Distributions and Moments | WDetermineDistributionsAndMomentsProcedure | Mn/Mw/Mz, distributions |

Additional procedures found in the database (not in the current experiment's chain):
- Branching (WBranchingProcedure)
- Protein Conjugate (WProteinConjugateProcedure)
- Co-Polymer Analysis (WCoPolymerAnalysisProcedure)
- Column Calibration (WCalibrateColumnProcedure)
- Column Plate Count (WColumnPlateCountProcedure)
- Cumulants (WCumulantsProcedure) - DLS
- Regularization (WRegularizationProcedure) - DLS
- Mark-Houwink (WMarkHouwinkProcedure)
- Mass from Column Calibration (WMassFromColumnCalibrationProcedure)
- Mass from VS (WMassFromVSProcedure)
- Online A2 (WOnlineA2Procedure)
- Particle Concentration from LS (WParticleConcentrationFromLSProcedure)
- Particles (WParticlesProcedure)
- Lipid NanoParticle (WLipidNanoParticleProcedure)
- AAV (WAAVProcedure)
- Parametric Plot (WParametricPlotProcedure)
- Distribution Analysis (WDistributionAnalysisProcedure)
- Script Collection (WScriptCollectionProcedure)
- Smoothing (WSmoothingProcedure)
- Baseline Subtraction (WBaselineSubtractionProcedure) - blank subtraction
- RINoise (WRINoiseProcedure)
- LSNoise (WLSNoiseProcedure)
- VINoise (WVINoiseProcedure)
- Pulse Correction (WPulseCorrectionProcedure)

## Appendix B: Data Name Codes Reference

Key integer codes used throughout the database for `m_nDataName`, `m_nValueName`, etc.

| Code | Meaning |
|---|---|
| 12018 | MALS normalization factor |
| 12021 | LS raw signal |
| 12022 | LS multi-angle signal (matrix) |
| 12025 | RI raw signal |
| 12027 | Time (index for all vector data) |
| 12068 | minutes (index units) |
| 12069 | g/mol |
| 12070 | nm (radius) |
| 12072 | V (volts) |
| 12074 | AU (absorbance) |
| 12075 | V (normalized) |
| 12098 | % |
| 12110 | UV signal (matrix) |
| 12120 | Mn (number-average MW) |
| 12121 | Mw (weight-average MW) |
| 12122 | Mz (z-average MW) |
| 12123 | Radius (nm) |
| 12128 | RMS radius (nm) |
| 12161 | Mw/Mn (polydispersity) |
| 12162 | Mz/Mw (polydispersity) |
| 12190 | Temperature |
| 12472 | Molar mass from detector |
| 12485 | Empty/placeholder |
| 12489 | RI raw voltage |
| 2259 | Specific viscosity |
| 2381 | Normalization coefficient |
| 2383 | Elution volume (mL) |
| 2411 | Intrinsic viscosity (dL/g) |

## Appendix C: MALS Detector Angles (from test file)

DAWN 8 with 8 detectors at angles: **32, 44, 57, 72, 90, 108, 126, 141 degrees**
(plus a 9th value of 135 for the replaced/QELS detector)

Laser wavelength: 662.72 nm
Calibration constant: 4.881e-05
All normalization coefficients: 1.0 (already normalized)