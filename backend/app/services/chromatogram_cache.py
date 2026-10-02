"""Chromatogram caching layer — .npz disk cache for parsed .afe8 arrays.

Caches extracted chromatogram arrays (MALS, RI, UV, time axis, angles) as
NumPy ``.npz`` files keyed by ``(experiment_id, file_hash)``.  This avoids
re-opening and re-parsing the gzip-compressed SQLite .afe8 on every
chromatogram request.

Cache files are stored under ``data/cache/`` and are invalidated when the
experiment's baselines, peaks, or procedure parameters change (by deleting the
cache file — the next read will re-parse from the .afe8 and re-cache).

The cache is keyed by file_hash rather than experiment_id alone so that
re-uploads of the same file ( which get a new experiment_id but the same hash )
can reuse the cache.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Optional

import numpy as np

from app.config import settings

logger = logging.getLogger(__name__)

_CACHE_DIR: Optional[Path] = None


def _get_cache_dir() -> Path:
    global _CACHE_DIR
    if _CACHE_DIR is not None:
        return _CACHE_DIR
    data_path = Path(settings.DATABASE_PATH).parent
    cache_dir = data_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    _CACHE_DIR = cache_dir
    return cache_dir


def _cache_path(file_hash: str) -> Path:
    safe_hash = file_hash.replace("/", "_").replace("\\", "_") if file_hash else "unknown"
    return _get_cache_dir() / f"{safe_hash}.npz"


def get_cached_chromatograms(file_hash: str) -> Optional[dict[str, Any]]:
    """Load cached chromatogram arrays from disk.

    Returns None if no cache exists or if loading fails.
    """
    if not file_hash:
        return None
    path = _cache_path(file_hash)
    if not path.exists():
        return None
    try:
        with np.load(path, allow_pickle=False) as data:
            result: dict[str, Any] = {}
            for key in data.files:
                result[key] = data[key]
            return result
    except Exception as e:
        logger.warning("Failed to load chromatogram cache %s: %s", path, e)
        return None


def save_cached_chromatograms(file_hash: str, chrom_data: dict[str, Any]) -> None:
    """Save chromatogram arrays to disk as .npz.

    Only NumPy arrays are stored; metadata strings are skipped.
    """
    if not file_hash:
        return
    path = _cache_path(file_hash)
    arrays: dict[str, np.ndarray] = {}
    for key, val in chrom_data.items():
        if isinstance(val, np.ndarray):
            arrays[key] = val
        elif isinstance(val, list) and len(val) > 0 and isinstance(val[0], (int, float)):
            arrays[key] = np.asarray(val, dtype=float)
    if not arrays:
        return
    try:
        tmp_path = str(path) + ".tmp"
        np.savez(tmp_path, **arrays)
        saved_path = tmp_path if tmp_path.endswith(".npz") else tmp_path + ".npz"
        os.replace(saved_path, str(path))
    except Exception as e:
        logger.warning("Failed to save chromatogram cache %s: %s", path, e)


def invalidate_cache(file_hash: str) -> None:
    """Delete the cache file for the given hash (if it exists)."""
    if not file_hash:
        return
    path = _cache_path(file_hash)
    try:
        if path.exists():
            path.unlink()
    except Exception as e:
        logger.warning("Failed to invalidate cache %s: %s", path, e)


def clear_all_cache() -> int:
    """Delete all cache files. Returns the number of files deleted."""
    cache_dir = _get_cache_dir()
    count = 0
    for f in cache_dir.glob("*.npz"):
        try:
            f.unlink()
            count += 1
        except Exception:
            pass
    return count


def get_cache_size_bytes() -> int:
    """Return the total size of all cache files in bytes."""
    cache_dir = _get_cache_dir()
    total = 0
    for f in cache_dir.glob("*.npz"):
        try:
            total += f.stat().st_size
        except Exception:
            pass
    return total
