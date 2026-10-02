# Astra Reader — Deployment Guide

## Overview

Astra Reader is a self-hosted web application for analyzing Wyatt ASTRA `.afe8`
files. It runs on a local lab machine (not cloud) using Docker.

## Prerequisites

- Docker Engine 24+
- Docker Compose v2+
- 2 GB RAM minimum (4 GB recommended for large files)
- 10 GB disk space (uploads + database + backups)

## Quick Start (Docker)

```bash
git clone <repo-url> /opt/astra-reader
cd /opt/astra-reader
docker compose up -d --build
```

The application is now available at:
- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8000
- **Health check:** http://localhost:8000/api/health

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///data/astra.db` | SQLite database path |
| `UPLOAD_DIR` | `/app/data/uploads` | Upload directory |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed CORS origins (comma-separated) |
| `BACKUP_RETENTION_DAYS` | `30` | Nightly backup retention period |
| `MAX_UPLOAD_SIZE_BYTES` | `524288000` | Max upload size (500 MB) |
| `RATE_LIMIT_UPLOADS_PER_MINUTE` | `10` | Upload rate limit per IP |

Set these in `docker-compose.yml` under the `backend.environment` section.

### CORS for Production

For production, set `CORS_ORIGINS` to the lab subnet explicitly:

```yaml
- CORS_ORIGINS=http://10.0.0.5:5173,http://10.0.0.6:5173
```

Do **not** use wildcard (`*`) in production.

## Process Supervision

Docker Compose is configured with `restart: always` for both services, ensuring
they restart automatically after crashes or reboots.

### Non-Docker Deployment (Windows / NSSM)

For Windows without Docker, use [NSSM](https://nssm.cc/):

```powershell
nssm install AstraReaderBackend "C:\Python312\python.exe" "-m uvicorn app.main:app --host 0.0.0.0 --port 8000"
nssm set AstraReaderBackend AppDirectory "C:\AstraReader\backend"
nssm set AstraReaderBackend AppEnvironmentExtra "PYTHONUNBUFFERED=1"
nssm set AstraReaderBackend Start SERVICE_AUTO_START
nssm start AstraReaderBackend
```

### Non-Docker Deployment (Linux / systemd)

```ini
[Unit]
Description=Astra Reader Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/astra-reader/backend
ExecStart=/usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Backup & Recovery

### Automatic Nightly Backups

The system creates nightly `VACUUM INTO` backups in `data/backups/`. Backups
older than 30 days are automatically deleted.

Trigger a manual backup:

```bash
curl -X POST http://localhost:8000/api/system/backup
```

List available backups:

```bash
curl http://localhost:8000/api/system/backups
```

### Recovery Procedure

1. Stop the application: `docker compose down`
2. Copy the most recent valid backup:
   ```bash
   cp data/backups/astra_backup_YYYYMMDD_HHMMSS.sqlite data/astra.db
   ```
3. Restart: `docker compose up -d`

### Database Integrity Check

The application runs `PRAGMA integrity_check` on startup. To check manually:

```bash
curl http://localhost:8000/api/system/health/db
```

## Health Monitoring

The health check endpoint is available at `GET /api/health`:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": "connected"
}
```

Docker Compose is configured to poll this endpoint every 30 seconds.

## Updating

```bash
cd /opt/astra-reader
git pull
docker compose up -d --build
```

The database is preserved across updates (it lives in the `data/` volume).