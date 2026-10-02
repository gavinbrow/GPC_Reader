# ASTRA Web App – Phase 1

Phase 1 of the architecture plan: **MVP – Core Import & View**.

## Quick Start

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on http://localhost:5173 and proxies API calls to http://localhost:8000.

## Features

- Upload `.afe8` files (drag-and-drop or file picker)
- View experiment metadata (sample, solvent, instruments, peaks)
- Interactive chromatogram plot (all detectors, Plotly.js)
- Detector toggle / selection
- Zoom / pan on chromatogram
- `.afe8` health check (validate gzip + SQLite + required tables)
- SQLite database for experiment storage
- CORS + rate limiting
- Docker support