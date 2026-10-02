# Backend Documentation — Astra Reader

Reference for future agents. Read this instead of spelunking through every file.

---

## 1. What This Project Is

A self-hosted web app for analyzing Wyatt ASTRA `.afe8` files (gzip-compressed
SQLite databases containing GPC/SEC chromatography data from MALS, UV, and RI
detectors). The goal is to replicate and eventually exceed the Wyatt ASTRA
desktop software in a browser.

**Architecture:** Hybrid — React/TypeScript frontend (UI + Plotly.js visualization)
talks to a Python FastAPI backend (all numerical computation, file parsing,
storage). The split exists because the MALS fitting / distribution algorithms
require NumPy/SciPy and an existing tested reader (`astra_reader.py`).

**Deployment target:** A local lab machine, multi-user (multiple scientists via
browser), no cloud, no instrument control (read-only post-collection analysis).

**Current state:** Phase 1 (MVP — Core Import & View) is complete. Phases 2-8
(baselines, peaks, auto-analysis, advanced fits, reporting, batch) are planned
but not yet implemented. See `architecture.md` at the project root for the full
roadmap.

---

## 2. Tech Stack

| Layer | Tech | Version |
|---|---|---|
| Web framework | FastAPI | 0.115.6 |
| ASGI server | uvicorn[standard] | 0.34.0 |
| ORM | SQLAlchemy | 2.0.36 |
| Validation | Pydantic + pydantic-settings | 2.10.4 / 2.7.0 |
| Multipart uploads | python-multipart | 0.0.20 |
| Numerical | NumPy + SciPy | 2.2.1 / 1.15.0 |
| HTTP client (tests) | httpx | 0.28.1 |
| Testing | pytest + pytest-asyncio | 8.3.4 / 0.25.0 |
| Database | SQLite (WAL mode, FK enforcement) | — |
| Python | 3.12 (Docker) | — |

Dependencies are pinned in `backend/requirements.txt`.

---

## 3. Directory Layout

```
backend/
  astra_reader.py            # CORE: .afe8 file reader library (standalone, no app deps)
  requirements.txt
  Dockerfile
  data/                      # runtime data (gitignored)
    astra.db                 #   application SQLite database (WAL mode)
    astra.db-shm / -wal      #   WAL sidecar files
    uploads/                 #   uploaded .afe8 files stored by UUID
  app/
    __init__.py              # empty
    main.py                  # FastAPI app: CORS, exception handler, startup, health, routers
    config.py                # Settings (pydantic-settings), path computation
    api/
      __init__.py
      routes/
        __init__.py
        auth.py              # /api/auth/* — login, logout, me, token deps
        files.py             # /api/files/* — upload, list, get, delete, export(stub)
        chromatograms.py     # /api/experiments/{id}/chromatograms, /detectors
        experiments.py       # /api/experiments/{id}/instruments, solvent, sample, fluid-path
    db/
      __init__.py            # empty
      base.py                # SQLAlchemy DeclarativeBase
      session.py             # engine, SessionLocal, get_db dep, init_db, WAL/pragma setup
    models/
      __init__.py            # re-exports all models
      models.py              # all SQLAlchemy ORM models (12 tables)
    schemas/
      __init__.py            # re-exports all schemas
      schemas.py             # all Pydantic request/response schemas
    services/
      __init__.py            # empty
      file_import.py         # ImportService: validate, hash, health-check, parse, persist
      chromatogram_service.py # load chromatograms/detectors from .afe8, downsampling
    tests/
      __init__.py            # empty
      conftest.py            # sys.path setup for imports
      test_health.py         # /api/health
      test_upload.py         # upload + list (needs ASTRA_TEST_FILE env var)
      test_metadata.py       # experiment metadata endpoints (needs ASTRA_TEST_FILE)
      test_chromatogram.py   # chromatogram endpoints (needs ASTRA_TEST_FILE)
```

---

## 4. File-by-File Reference

### 4.1 `astra_reader.py` (1198 lines) — THE CORE READER

**This is the most important file.** It is a standalone module (no `app/`
dependencies, only stdlib + numpy) that reads `.afe8` files. All file-format
knowledge lives here.

**How it works:**
1. `AstraReader(file_path)` decompresses the gzip file to a temp SQLite DB,
   opens a `sqlite3.Connection`.
2. Properties (`experiment`, `file_info`, `solvent`, `mals`, `ri`, `uv`,
   `viscometer`, `sample`, `peaks`, `fluid_connections`) query specific SQLite
   tables (`WExperiment`, `WFileEntry`, `WSolventProfile`, `WHeleos8Profile`,
   `WNGOInstrumentProfile`, `WHplcUVDeviceProfile`, `WGenericViscometerProfile`,
   `WInjectedSampleProfile`, `WPeakRange`, `WFluidConnectionProfile`) and
   return typed dataclasses.
3. `vector_data`, `matrix_data`, `results` properties read the bulk data tables
   (`WVectorData`, `WMatrixData`, `WResultData`) and decode BLOB columns into
   numpy arrays.
4. Convenience methods: `get_mals_chromatogram()`, `get_ri_chromatogram()`,
   `get_uv_chromatogram()`, `get_molar_mass_results()`, `get_all_results_by_peak()`,
   `get_summary()`.
5. Low-level: `list_tables()`, `list_populated_tables()`, `raw_query()`,
   `get_table_as_dicts()`.
6. Has a CLI (`__main__`): `python astra_reader.py <file.afe8> [--summary] [--tables] [--results]`.

**BLOB decoding** (`decode_blob`, `decode_raw_blob_doubles`):
- ASTRA BLOBs have a 16-byte header: 4 × uint32 (blob_size, uncomp_size, count,
  elem_size), then zlib-compressed doubles/floats (magic `0x78 0x9c`).
- Small BLOBs (angles, normalization coeffs) are raw doubles after the header
  (no zlib) — use `decode_raw_blob_doubles`.
- Large BLOBs (chromatograms) are zlib-compressed — use `decode_blob`.

**Lookup dictionaries** (top of file):
- `INSTRUMENT_NAMES` — class name → human name (e.g. `WHeleos8Profile` → `DAWN 8 (MALS)`)
- `DATA_CATEGORIES` — dataCategory int → string (raw, concentration, molar_mass, etc.)
- `DATA_NAME_MAP` — `m_nDataName` integer codes → descriptive strings (12021 = LS raw, 12025 = RI raw, 12120 = Mn, 12121 = Mw, etc.). This is the key reference for interpreting data series.
- `lookup_data_name()`, `lookup_category()`, `lookup_instrument()` helpers.

**Dataclasses:** `ExperimentInfo`, `FileInfo`, `SolventInfo`, `MALSInfo`,
`RIInfo`, `UVInfo`, `ViscometerInfo`, `SampleInfo`, `PeakRange`, `VectorData`,
`MatrixData`, `ResultData`, `FluidConnection`.

**MALS profile table fallback:** `MALS_PROFILE_TABLES` in `file_import.py`
lists `WHeleos8Profile`, `WHeleosNeon`, `WMiniDawn`, `WTreos` — but the
`AstraReader.mals` property currently hardcodes `WHeleos8Profile`. Generalizing
this for non-DAWN instruments is a known TODO.

### 4.2 `app/main.py` (88 lines)

FastAPI app entry point. Creates the app with title/version from settings.
Adds CORS middleware (origins from config). Registers a global exception
handler that returns a standardized `ErrorResponse` (RFC 9457-ish JSON) for
all unhandled exceptions. On startup (`@app.on_event("startup")`) calls
`init_db()` to create tables. Defines `GET /api/health`. Includes four routers:
`auth`, `files`, `chromatograms`, `experiments`.

### 4.3 `app/config.py` (49 lines)

`Settings(BaseSettings)` with env-var overrides. Key settings:
- `APP_NAME`, `APP_VERSION` (1.0.0), `DEBUG` (True)
- `CORS_ORIGINS` — defaults to `["http://localhost:5173", "http://127.0.0.1:5173"]`
- `DATABASE_URL` / `DATABASE_PATH` — computed in `create()` relative to backend root
- `MAX_UPLOAD_SIZE_BYTES` — 500 MB
- `UPLOAD_DIR` — `backend/data/uploads/`, auto-created
- `RATE_LIMIT_UPLOADS_PER_MINUTE` — 10
- `SESSION_EXPIRY_DAYS` — 7

`Settings.create()` is a classmethod that computes paths relative to the
backend root (`backend/`) and ensures `data/` and `data/uploads/` exist. A
module-level singleton `settings = Settings.create()` is the instance used
everywhere.

### 4.4 `app/db/session.py` (50 lines)

- Creates the SQLAlchemy `engine` with `check_same_thread=False` (needed for
  FastAPI's threadpool). `echo=False`.
- `SessionLocal` sessionmaker (autocommit=False, autoflush=False).
- `_set_sqlite_pragmas()` is attached via `event.listen(engine, "connect", ...)`
  and runs `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` on every new
  raw connection. This is critical — SQLite disables FKs by default.
- `get_db()` — FastAPI dependency, yields a Session, closes in finally.
- `init_db()` — imports `app.models` (side-effect: registers models on
  Base.metadata) then calls `Base.metadata.create_all(bind=engine)`. Called on
  startup.

### 4.5 `app/db/base.py` (8 lines)

Single `class Base(DeclarativeBase): pass` — the shared declarative base for
all ORM models.

### 4.6 `app/models/models.py` (288 lines) — ALL ORM MODELS

12 SQLAlchemy models, all in one file. Key relationships use `cascade="all,
delete-orphan"` so deleting an experiment cascades to children.

| Model | Table | Purpose |
|---|---|---|
| `User` | `users` | Lightweight user (display_name, session_token, last_active). No passwords. |
| `Experiment` | `experiments` | Uploaded file record. Metadata + JSON config columns (mals_config, ri_config, uv_config, viscometer_config, sample_config, fluid_path) stored as JSON text. `raw_data_path` points to stored .afe8. `version` for optimistic locking. |
| `Baseline` | `baselines` | Per-detector baseline (type, x1/x2/y1/y2, slope, intercept, std_dev, is_auto). FK→experiments CASCADE. |
| `Peak` | `peaks` | Peak range + sample params (dn_dc, uv_extinction, concentration, injected_mass, ls_model, ls_fit_degree) + computed results (mn, mw, mz, polydispersity, rms_radius, peak_area, recovery). FK→experiments CASCADE. |
| `ProcedureState` | `procedure_states` | Procedure chain state (name, order, is_enabled, has_been_run, parameters JSON). |
| `ComputedData` | `computed_data` | Cached computed results per slice (data_type, data_values JSON, uncertainties JSON). FK→experiments and →peaks CASCADE. |
| `ReportTemplate` | `report_templates` | Report layout config (name, template_config JSON, is_default). |
| `MethodTemplate` | `method_templates` | Reusable analysis method (template JSON, is_public, shared_with JSON). |
| `BatchJob` | `batch_jobs` | Batch processing job (source_experiment_id, target_experiment_ids JSON, status, progress_pct). |
| `EasiTable` | `easi_tables` | Multi-run comparison table (experiment_ids JSON, column_config JSON). |
| `AuditLog` | `audit_log` | Audit trail (action, entity_type, entity_id, changes JSON). FK→experiments CASCADE. |
| `SessionRecord` | `sessions` | Session token storage (token_hash, expires_at, revoked, ip_address, user_agent). FK→users CASCADE. |

`Experiment` has relationships to: `user` (back_populates), `baselines`,
`peaks`, `procedure_states`, `computed_data`, `audit_logs` (all cascading).
`User` has `experiments` and `sessions` (cascading).

**Note:** Most Phase 2-8 tables (Baseline, Peak, ProcedureState, ComputedData,
ReportTemplate, MethodTemplate, BatchJob, EasiTable, AuditLog, SessionRecord)
are defined but not yet used by any route — they exist for future phases.

### 4.7 `app/models/__init__.py` (31 lines)

Re-exports all 12 model classes for convenient `from app.models import X`
imports. `init_db()` relies on this side-effect import to register models.

### 4.8 `app/schemas/schemas.py` (183 lines) — ALL PYDANTIC SCHEMAS

All request/response models in one file:

| Schema | Used by |
|---|---|
| `ErrorResponse` | Global exception handler (RFC 9457-ish: type, title, detail, status, instance) |
| `HealthCheckResponse` | `GET /api/health` |
| `LoginRequest` | `POST /api/auth/login` (display_name, min 1 max 200 chars) |
| `LoginResponse` | login response (user_id, display_name, token, expires_at) |
| `UserResponse` | `GET /api/auth/me` |
| `LogoutResponse` | `POST /api/auth/logout` |
| `ExperimentMetadata` | List endpoint (id, file_name, sample_name, etc., timestamps, version) |
| `ExperimentResponse` | Single experiment get (full: all JSON config fields, peaks list) |
| `ExperimentListResponse` | Paginated list (experiments[], total, page, limit, pages) |
| `PeakResponse` | Single peak (range, params, computed results) |
| `UploadResponse` | Upload result (experiment_id, file_name, file_size, file_hash, sample_name, message) |
| `DetectorInfo` | Detector metadata (code, name, enabled, angles, wavelengths, num_detectors, instrument_class) |
| `DetectorListResponse` | `GET /api/experiments/{id}/detectors` |
| `ChromatogramResponse` | `GET /api/experiments/{id}/chromatograms` (time[], detectors{}, downsampled, downsample_factor, point_count) |

All use `class Config: from_attributes = True` for ORM compatibility (Pydantic v2
style, equivalent to old `orm_mode = True`).

### 4.9 `app/schemas/__init__.py` (35 lines)

Re-exports all schemas.

### 4.10 `app/api/routes/auth.py` (146 lines)

`router = APIRouter(prefix="/api/auth", tags=["auth"])`

**Token model:** SHA-256-hashed random tokens stored in `sessions` table.
Raw token returned to client once at login. `get_current_user` resolves the
bearer token (from `Authorization: Bearer <token>` header or `?token=` query)
by hashing and looking up a non-revoked, non-expired `SessionRecord`.

**Endpoints:**
- `POST /api/auth/login` — find-or-create user by display_name, create session,
  return raw token + expiry.
- `POST /api/auth/logout` — revoke current session.
- `GET /api/auth/me` — return current user (401 if not authed).

**Dependencies:**
- `get_current_user(authorization, token, db)` → `User | None` (optional auth;
  returns None if no valid token — Phase 1 makes auth optional)
- `require_user(user)` → `User` (strict; raises 401 if None)

### 4.11 `app/api/routes/files.py` (310 lines)

`router = APIRouter(tags=["files"])` — note: no prefix, full paths on each route.

**Rate limiter:** In-memory `RateLimiter` class (per-IP sliding window,
`RATE_LIMIT_UPLOADS_PER_MINUTE` = 10). `_rate_limiter` module-level singleton.

**Endpoints:**
- `POST /api/files/upload` (201) — accepts `list[UploadFile]` (field name `files`).
  Rate-limited. Per-file pipeline (in `_process_single_upload`):
  1. Stream to `UPLOAD_DIR/{uuid}.afe8` in 64KB chunks, enforce size limit.
  2. `ImportService.validate_gzip_magic()` — check `1f 8b` header.
  3. `ImportService.health_check()` — decompress, open SQLite, check
     `WExperiment` table exists.
  4. `ImportService.compute_file_hash()` — SHA-256 for dedup. Reject duplicates
     (return error with existing experiment_id).
  5. `ImportService.import_file()` — parse into experiment dict via AstraReader.
  6. `ImportService.save_experiment()` — persist to DB (Experiment + Peak rows).
  - Returns single result for one file, list for multiple. Errors → HTTPException.
- `GET /api/files` — paginated list (`?page=&limit=&sample_name=&date_from=&date_to=`).
  Returns `ExperimentListResponse`.
- `GET /api/files/{experiment_id}` — full experiment metadata with parsed JSON
  configs and peaks. Uses local `_parse_json` helper.
- `DELETE /api/files/{experiment_id}` — deletes experiment row + raw .afe8 file.
- `POST /api/files/{experiment_id}/export` — **STUB** (501 Not Implemented).

### 4.12 `app/api/routes/chromatograms.py` (101 lines)

`router = APIRouter(tags=["chromatograms"])` — no prefix.

- `GET /api/experiments/{id}/chromatograms` → `ChromatogramResponse`. Calls
  `load_chromatograms(raw_data_path)`.
- `GET /api/experiments/{id}/chromatograms/{detector}` — single detector
  (MALS/RI/UV, case-insensitive). Calls `load_single_detector()`.
- `GET /api/experiments/{id}/detectors` → `DetectorListResponse`. Calls
  `list_detectors(raw_data_path)`.

All use `_get_experiment_or_404()` helper (checks experiment exists + has
`raw_data_path`).

### 4.13 `app/api/routes/experiments.py` (84 lines)

`router = APIRouter(tags=["experiments"])` — no prefix.

Metadata-only endpoints (no .afe8 re-parsing, reads from DB JSON columns):
- `GET /api/experiments/{id}/instruments` — mals, ri, uv, viscometer configs.
- `GET /api/experiments/{id}/solvent` — name, description.
- `GET /api/experiments/{id}/sample` — sample_name, sample_config.
- `GET /api/experiments/{id}/fluid-path` — fluid_path list.

All use `_get_experiment_or_404()` + `_safe_json()` (parse JSON text, return
None/raw on failure).

### 4.14 `app/services/file_import.py` (315 lines)

**`ImportService`** — static methods wrapping `AstraReader` for the app layer.

- `validate_gzip_magic(path)` — first 2 bytes == `0x1f 0x8b`.
- `compute_file_hash(path)` — SHA-256 in 64KB chunks.
- `health_check(path)` — gzip magic + AstraReader can list tables + `WExperiment`
  present.
- `import_file(path, original_filename)` — opens AstraReader, pulls all
  metadata properties, builds a dict with JSON-serialized config fields
  (mals_config, ri_config, uv_config, viscometer_config, sample_config,
  fluid_path) + a `peaks` list. Dates kept as strings. Returns dict via
  `_np_to_list()` (recursively converts numpy → plain Python for JSON safety).
- `save_experiment(db, experiment_dict, raw_data_path, file_hash, file_size)`
  — creates `Experiment` row, flushes for ID, creates `Peak` rows, commits.

**Downsampling helpers** (also used by chromatogram_service):
- `MAX_POINTS = 10_000` — threshold.
- `downsample(data, max_points)` — strided 1-D, returns `(list, stride)`.
- `downsample_2d(data, max_points)` — strided along axis 0.

`MALS_PROFILE_TABLES` list defined here (WHeleos8Profile, WHeleosNeon,
WMiniDawn, WTreos) for future generalization, but not yet used in parsing.

**Import note:** `astra_reader` is imported via `sys.path` manipulation
(`_backend_root` inserted) since it lives at `backend/astra_reader.py`, outside
the `app/` package.

### 4.15 `app/services/chromatogram_service.py` (194 lines)

Three functions, all open an `AstraReader` and close in `finally`:

- `load_chromatograms(raw_data_path)` → dict with `time`, `detectors` (keys:
  "MALS", "RI", "UV"), `downsampled`, `downsample_factor`. MALS/UV are matrices
  (time × angles/channels); RI is a vector. Each detector downsampled via
  `downsample`/`downsample_2d`. `time` taken from MALS first, else RI, else UV.
  Each detector dict includes `instrument_class`.
- `load_single_detector(raw_data_path, detector)` — calls `load_chromatograms`
  then extracts one detector (case-insensitive). Returns error dict if missing.
- `list_detectors(raw_data_path)` — returns list of dicts: code, name, enabled
  (whether chromatogram data exists), and detector-specific fields (angles for
  MALS, wavelengths for UV). Falls back to hardcoded instrument_class strings
  if chromatogram is None.

### 4.16 `app/tests/` (5 test files)

- `conftest.py` — inserts backend root onto `sys.path` so `astra_reader` and
  `app` are importable.
- `test_health.py` — `GET /api/health` returns 200 with status ok. Always runs.
- `test_upload.py` — upload valid + invalid + list. Skipped unless
  `ASTRA_TEST_FILE` env var points to a valid `.afe8`.
- `test_metadata.py` — get experiment, instruments, solvent, sample,
  fluid-path. Skipped unless `ASTRA_TEST_FILE` set. Caches experiment_id
  across tests in class var.
- `test_chromatogram.py` — get all chromatograms, detectors list, single
  detector. Skipped unless `ASTRA_TEST_FILE` set.

Run with: `cd backend && python -m pytest app/tests/ -v`
(or `python -m pytest app/tests/ -v --env=ASTRA_TEST_FILE=path.afe8` for full
suite). The health test runs without a sample file.

### 4.17 Top-level / ops files

- `backend/requirements.txt` — pinned deps (see §2).
- `backend/Dockerfile` — python:3.12-slim, installs gcc, pip install, copies
  code, creates `data/uploads`, exposes 8000, runs uvicorn.
- `docker-compose.yml` (project root) — `backend` service (builds `./backend`,
  ports 8000, mounts `./backend/data` + read-only `astra_reader.py`, env vars
  for DB/UPLOAD/CORS, restart unless-stopped) + `frontend` service (builds
  `./frontend`, port 5173, depends_on backend).
- `_start_backend.bat` — Windows dev launcher: ensures deps, runs uvicorn on
  127.0.0.1:8000 with --reload.
- `run.bat` — Windows dev launcher: starts both backend + frontend in separate
  windows, opens browser after 4s delay.
- `architecture.md` (project root, 1499 lines) — the master design doc. Read
  this for: full feature inventory, API endpoint spec, DB schema, development
  phases, technical decisions (fit models, band broadening, distributions),
  risk assessment, testing strategy, and appendices (procedure chain, data
  name codes, detector angles).
- `.gitignore` — ignores `data/`, `*.db`, `*.sqlite`, `__pycache__`, venvs,
  node_modules, etc.

---

## 5. Request Flow (Phase 1)

### 5.1 Upload
```
Client → POST /api/files/upload (multipart, files[])
  → files.py:upload_file
    → rate limit check (per IP)
    → for each file: _process_single_upload
        → stream to UPLOAD_DIR/{uuid}.afe8 (64KB chunks, size-limited)
        → validate_gzip_magic (0x1f 0x8b)
        → health_check (AstraReader: WExperiment table exists)
        → compute_file_hash (SHA-256) → dedup check
        → ImportService.import_file
            → AstraReader decompresses gzip → temp SQLite
            → reads all metadata properties → builds experiment dict
            → _np_to_list (numpy → plain Python)
        → ImportService.save_experiment
            → INSERT Experiment row, INSERT Peak rows, COMMIT
  → returns UploadResponse (or error per file)
```

### 5.2 View chromatogram
```
Client → GET /api/experiments/{id}/chromatograms
  → chromatograms.py:get_all_chromatograms
    → _get_experiment_or_404 (query Experiment by id, check raw_data_path)
    → chromatogram_service.load_chromatograms(raw_data_path)
        → AstraReader(path)
        → get_mals_chromatogram() → MatrixData (time × angles), downsample
        → get_ri_chromatogram() → VectorData (time series), downsample
        → get_uv_chromatogram() → MatrixData (time × channels), downsample
        → assemble {time, detectors:{MALS,RI,UV}, downsampled, factor}
    → ChromatogramResponse
```

### 5.3 View metadata
```
Client → GET /api/experiments/{id}/instruments (or /solvent, /sample, /fluid-path)
  → experiments.py
    → _get_experiment_or_404
    → _safe_json on the relevant JSON-text DB column
    → return dict
```

---

## 6. Database Design Notes

- **SQLite + WAL mode** enabled on every connection (see `session.py`).
  Allows concurrent reads; writes serialize. Fine for 2-3 users; migrate to
  PostgreSQL via SQLAlchemy if contention grows.
- **Foreign keys ON** on every connection (`PRAGMA foreign_keys=ON`). All child
  tables use `ON DELETE CASCADE` — deleting an experiment removes baselines,
  peaks, procedure states, computed data, audit logs.
- **Tables created on startup** via `Base.metadata.create_all`. No Alembic
  migrations yet. If models change, drop the DB or add migrations.
- **JSON columns** (mals_config, ri_config, etc.) stored as TEXT containing
  JSON. Parsed on read via `json.loads` / `_safe_json` / `_parse_json`.
- **Optimistic locking** via `version` column on experiments/baselines/peaks/
  procedure_states. Not yet enforced in routes (Phase 2+).
- **Dedup** via `file_hash` (SHA-256) — upload rejects duplicates.

---

## 7. Key Design Decisions & Conventions

1. **`astra_reader.py` is standalone** — no `app/` imports, only stdlib +
   numpy. It can be used as a CLI or imported anywhere. The `app/` services
   layer wraps it. This separation keeps file-format knowledge isolated.

2. **Routes have no prefix** on the router; full paths are on each `@router`
   decorator (e.g. `@router.get("/api/files/...")`). Exception: `auth.py` uses
   `prefix="/api/auth"`.

3. **Services are function-based / static methods**, not class instances.
   `ImportService` and the chromatogram functions are all `@staticmethod` or
   module-level functions. No DI of service objects — they take `db: Session`
   as a parameter.

4. **Auth is optional in Phase 1.** `get_current_user` returns `None` if no
   token; only `require_user` enforces. Upload/list/delete routes do NOT
   require auth currently. Wire up `require_user` when implementing Phase 2+
   ownership model.

5. **Downsampling** caps chromatogram arrays at 10,000 points (strided). The
   `downsampled` and `downsample_factor` fields in `ChromatogramResponse` tell
   the frontend. This keeps JSON responses small. Full-resolution data is
   available if needed later (not currently exposed).

6. **Temp SQLite files** — `AstraReader._load()` decompresses gzip to a temp
   file (`tempfile.NamedTemporaryFile`) and opens it. `close()` closes the
   connection; `__del__` also deletes the temp file. Always call `reader.close()`
   in a `finally` block (services do this).

7. **`.afe8` files stored as-is** in `data/uploads/{uuid}.afe8`. The DB stores
   the path in `experiments.raw_data_path`. Reading re-parses the file each
   time (no in-DB chromatogram caching yet — Phase 2+ will add `.npz`/Parquet
   caching per `architecture.md` §7.1).

8. **No migrations / no Alembic.** `init_db()` calls `create_all`. Changing
   models requires dropping the DB or adding migration tooling.

---

## 8. What's NOT Implemented (Phases 2-8)

These exist as planned features in `architecture.md` and/or as empty DB tables,
but have no routes/services yet:

- **Baselines** (interactive per-detector, auto-detect, blank subtraction)
- **Peaks** (interactive selection, auto-detect, per-peak params) — Peak rows
  are written at upload (from .afe8 WPeakRange) but no create/update/delete
  endpoints.
- **Procedure chain** (despiking, alignment, band broadening, normalization,
  concentration, molar mass, distributions, moments)
- **Analysis engine** (Zimm/Debye/Berry fits, KDE distributions, conformation,
  branching, viscometry, conjugate, calibration, particle, error analysis)
- **Reports** (Jinja2 + WeasyPrint PDF, HTML, CSV, Excel)
- **Batch processing** (one-to-many, method templates, EASI table)
- **.afe8 export/writing** (round-trip write — designed, proof-of-concept done,
  not exposed via API)
- **WebSocket progress** (`/api/experiments/{id}/progress`)
- **Audit logging** (table exists, not written)
- **Session expiry enforcement** on read (checked in `get_current_user` but
  expiry date set at login)
- **Ownership/permissions** (created_by stored, not enforced)

The `architecture.md` §3.3 module structure lists the planned service files
(baseline_engine, peak_engine, alignment_engine, band_broadening,
normalization, concentration, molar_mass, distributions, moments, conjugate,
branching, viscometry, column_calibration, particle, error_analysis,
report_engine, batch_processor) — none exist yet.

---

## 9. How to Run

### Local dev (Windows)
```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
Or use `run.bat` from the project root (starts backend + frontend).

### Docker
```bash
docker-compose up
```
Backend on :8000, frontend on :5173.

### Tests
```powershell
cd backend
python -m pytest app/tests/ -v
# Full suite needs a sample file:
$env:ASTRA_TEST_FILE="C:\Projects\Astra Reader\PS 30kDa 5mg-ml[PolyStyrene Calibration Check 5mg-ml].afe8"
python -m pytest app/tests/ -v
```
The health test runs without a sample file; upload/metadata/chromatogram tests
are skipped if `ASTRA_TEST_FILE` is unset.

### CLI exploration of a .afe8 file
```powershell
cd backend
python astra_reader.py "..\PS 30kDa 5mg-ml[PolyStyrene Calibration Check 5mg-ml].afe8" --summary --tables --results
```

### API docs
Once running, open `http://localhost:8000/docs` (FastAPI auto-generated
Swagger UI).

---

## 10. Validation Reference

The project ships with a PS 30kDa calibration file:
`PS 30kDa 5mg-ml[PolyStyrene Calibration Check 5mg-ml].afe8`.

Expected ASTRA results (from `architecture.md` §9.1) for validating future
analysis engines:
- Mn = 10,231
- Mw = 15,623
- Mz = 24,019
- Pd (Mw/Mn) = 1.527

Acceptance tolerances: Mn/Mw/Mz within ±2%, polydispersity within ±3%,
distribution peak position within ±5%.