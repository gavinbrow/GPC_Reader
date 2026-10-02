"""Service for reading chromatogram data from .afe8 files.

Uses a .npz disk cache ( :mod:`app.services.chromatogram_cache` ) to avoid
re-parsing the gzip-compressed SQLite on every request.  The cache stores the
full-resolution arrays; downsampling is applied after loading from cache ( or
after parsing from the .afe8 on a cache miss ).
"""

import logging
from typing import Any, Optional

import numpy as np

from app.services.chromatogram_cache import (
    get_cached_chromatograms,
    save_cached_chromatograms,
)
from app.services.file_import import (
    MAX_POINTS,
    downsample,
    downsample_2d,
)
from astra_reader import AstraReader

logger = logging.getLogger(__name__)


def load_chromatograms(raw_data_path: str, file_hash: Optional[str] = None) -> dict:
    """Load all detector chromatogram data from a stored .afe8 file.

    If *file_hash* is provided and a cache entry exists, the arrays are loaded
    from the .npz cache instead of re-parsing the .afe8.  On a cache miss the
    arrays are parsed from the .afe8 and then cached for future requests.

    Returns a dict with the following structure::

        {
            "time": [...],           # shared time axis in minutes
            "detectors": {
                "MALS": {"name", "angles", "data"},
                "RI":   {"name", "data"},
                "UV":   {"name", "wavelengths", "data"},
            },
            "downsampled": bool,
            "downsample_factor": int,
        }
    """
    cached = get_cached_chromatograms(file_hash) if file_hash else None
    if cached is not None:
        return _build_from_cache(cached)

    reader = AstraReader(raw_data_path)
    try:
        result: dict[str, Any] = {
            "time": None,
            "detectors": {},
            "downsampled": False,
            "downsample_factor": 1,
        }

        max_stride = 1

        # --- MALS ---
        mals_chrom = reader.get_mals_chromatogram()
        if mals_chrom is not None:
            time_values = mals_chrom.row_index
            angles = mals_chrom.column_index
            values = mals_chrom.values  # 2-D: time × angles

            time_list = time_values.tolist() if hasattr(time_values, "tolist") else list(time_values)
            angle_list = angles.tolist() if hasattr(angles, "tolist") else list(angles)

            # The matrix column index is stored as sequential detector numbers
            # (1, 2, 3, …) rather than real scattering angles.  Substitute the
            # real detector angles from the MALS profile so the legend reads
            # e.g. "90°" instead of "3".
            n_cols = values.shape[1] if hasattr(values, "shape") and values.ndim == 2 else len(angle_list)
            real_angles = reader.mals.detector_angles
            real_angles = real_angles.tolist() if hasattr(real_angles, "tolist") else list(real_angles)
            looks_sequential = all(
                abs(a - (i + 1)) < 1e-6 for i, a in enumerate(angle_list)
            ) if angle_list else False
            if looks_sequential and len(real_angles) >= n_cols:
                angle_list = real_angles[:n_cols]
            values_list = values.tolist() if hasattr(values, "tolist") else [list(r) for r in values]

            time_ds, stride_t = downsample(time_list, MAX_POINTS)
            values_ds, stride_v = downsample_2d(values_list, MAX_POINTS)
            stride = max(stride_t, stride_v)
            if stride > 1:
                result["downsampled"] = True
                result["downsample_factor"] = max(result["downsample_factor"], stride)

            result["time"] = time_ds
            result["detectors"]["MALS"] = {
                "name": mals_chrom.instrument_name or "MALS",
                "angles": angle_list,
                "data": values_ds,
                # Each detector is sampled on its own time base (MALS, RI and UV
                # typically differ in point count and rate).  Carry a per-detector
                # time axis so the frontend plots each trace against its own x
                # values instead of an unrelated shared axis (which truncated UV).
                "time": time_ds,
                "instrument_class": mals_chrom.instrument_class,
            }

        # --- RI ---
        ri_chrom = reader.get_ri_chromatogram()
        if ri_chrom is not None:
            time_values = ri_chrom.index_values
            data_values = ri_chrom.data_values

            time_list = time_values.tolist() if hasattr(time_values, "tolist") else list(time_values)
            data_list = data_values.tolist() if hasattr(data_values, "tolist") else list(data_values)

            time_ds, stride_t = downsample(time_list, MAX_POINTS)
            data_ds, stride_d = downsample(data_list, MAX_POINTS)
            stride = max(stride_t, stride_d)
            if stride > 1:
                result["downsampled"] = True
                result["downsample_factor"] = max(result["downsample_factor"], stride)

            if result["time"] is None:
                result["time"] = time_ds

            result["detectors"]["RI"] = {
                "name": ri_chrom.instrument_name or "RI",
                "data": data_ds,
                "time": time_ds,
                "instrument_class": ri_chrom.instrument_class,
            }

        # --- UV ---
        uv_chrom = reader.get_uv_chromatogram()
        if uv_chrom is not None:
            time_values = uv_chrom.row_index
            channels = uv_chrom.column_index
            values = uv_chrom.values  # 2-D: time × channels

            time_list = time_values.tolist() if hasattr(time_values, "tolist") else list(time_values)
            channel_list = channels.tolist() if hasattr(channels, "tolist") else list(channels)
            values_list = values.tolist() if hasattr(values, "tolist") else [list(r) for r in values]

            # UV column index is stored as channel numbers (1, 2, …); replace
            # with the real monitored wavelengths (e.g. 280 nm, 254 nm).
            n_uv_cols = values.shape[1] if hasattr(values, "shape") and values.ndim == 2 else len(channel_list)
            real_wls = reader.uv.wavelengths or []
            uv_looks_sequential = all(
                abs(w - (i + 1)) < 1e-6 for i, w in enumerate(channel_list)
            ) if channel_list else False
            if uv_looks_sequential and len(real_wls) >= n_uv_cols:
                channel_list = list(real_wls[:n_uv_cols])

            time_ds, stride_t = downsample(time_list, MAX_POINTS)
            values_ds, stride_v = downsample_2d(values_list, MAX_POINTS)
            stride = max(stride_t, stride_v)
            if stride > 1:
                result["downsampled"] = True
                result["downsample_factor"] = max(result["downsample_factor"], stride)

            if result["time"] is None:
                result["time"] = time_ds

            result["detectors"]["UV"] = {
                "name": uv_chrom.instrument_name or "UV",
                "wavelengths": channel_list,
                "data": values_ds,
                "time": time_ds,
                "instrument_class": uv_chrom.instrument_class,
            }

        if file_hash:
            _save_raw_arrays_to_cache(file_hash, result)
        return result
    finally:
        reader.close()


def _save_raw_arrays_to_cache(file_hash: str, result: dict[str, Any]) -> None:
    """Extract full-resolution arrays from the parsed result and cache them."""
    arrays: dict[str, np.ndarray] = {}
    time_axis = result.get("time")
    if time_axis is not None:
        arrays["time"] = np.asarray(time_axis, dtype=float)
    detectors = result.get("detectors", {})
    mals = detectors.get("MALS")
    if mals is not None:
        if mals.get("angles") is not None:
            arrays["mals_angles"] = np.asarray(mals["angles"], dtype=float)
        if mals.get("data") is not None:
            arrays["mals_data"] = np.asarray(mals["data"], dtype=float)
        if mals.get("time") is not None:
            arrays["mals_time"] = np.asarray(mals["time"], dtype=float)
    ri = detectors.get("RI")
    if ri is not None and ri.get("data") is not None:
        arrays["ri_data"] = np.asarray(ri["data"], dtype=float)
        if ri.get("time") is not None:
            arrays["ri_time"] = np.asarray(ri["time"], dtype=float)
    uv = detectors.get("UV")
    if uv is not None:
        if uv.get("wavelengths") is not None:
            arrays["uv_wavelengths"] = np.asarray(uv["wavelengths"], dtype=float)
        if uv.get("data") is not None:
            arrays["uv_data"] = np.asarray(uv["data"], dtype=float)
        if uv.get("time") is not None:
            arrays["uv_time"] = np.asarray(uv["time"], dtype=float)
    if arrays:
        save_cached_chromatograms(file_hash, arrays)


def _build_from_cache(cached: dict[str, np.ndarray]) -> dict[str, Any]:
    """Build the standard chromatogram result dict from cached arrays.

    Applies downsampling just like the fresh-parse path.
    """
    result: dict[str, Any] = {
        "time": None,
        "detectors": {},
        "downsampled": False,
        "downsample_factor": 1,
    }
    max_stride = 1

    time_arr = cached.get("time")
    if time_arr is not None:
        time_list = time_arr.tolist()
        time_ds, stride_t = downsample(time_list, MAX_POINTS)
        if stride_t > 1:
            result["downsampled"] = True
            max_stride = max(max_stride, stride_t)
        result["time"] = time_ds

    def _detector_time(key: str, n: int) -> list:
        """Downsample a detector's own cached time axis, or synthesize one."""
        arr = cached.get(key)
        if arr is not None:
            t_ds, stride = downsample(arr.tolist(), MAX_POINTS)
            nonlocal_stride[0] = max(nonlocal_stride[0], stride)
            return t_ds
        # Fall back to the shared axis (legacy caches without per-detector time),
        # or a synthetic index if that too is absent.
        shared = result.get("time")
        if shared is not None:
            return shared
        return list(range(n))

    nonlocal_stride = [max_stride]

    mals_data = cached.get("mals_data")
    if mals_data is not None:
        angles = cached.get("mals_angles")
        values_list = mals_data.tolist()
        mals_time = _detector_time("mals_time", len(values_list))
        if result.get("time") is None:
            result["time"] = mals_time
        _, stride_v = downsample_2d(values_list, MAX_POINTS)
        if stride_v > 1:
            result["downsampled"] = True
            nonlocal_stride[0] = max(nonlocal_stride[0], stride_v)
        values_ds, _ = downsample_2d(values_list, MAX_POINTS)
        angle_list = angles.tolist() if angles is not None else []
        result["detectors"]["MALS"] = {
            "name": "MALS",
            "angles": angle_list,
            "data": values_ds,
            "time": mals_time,
            "instrument_class": "cached",
        }

    ri_data = cached.get("ri_data")
    if ri_data is not None:
        data_list = ri_data.tolist()
        ri_time = _detector_time("ri_time", len(data_list))
        if result.get("time") is None:
            result["time"] = ri_time
        data_ds, stride_d = downsample(data_list, MAX_POINTS)
        if stride_d > 1:
            result["downsampled"] = True
            nonlocal_stride[0] = max(nonlocal_stride[0], stride_d)
        result["detectors"]["RI"] = {
            "name": "RI",
            "data": data_ds,
            "time": ri_time,
            "instrument_class": "cached",
        }

    uv_data = cached.get("uv_data")
    if uv_data is not None:
        wavelengths = cached.get("uv_wavelengths")
        values_list = uv_data.tolist()
        uv_time = _detector_time("uv_time", len(values_list))
        if result.get("time") is None:
            result["time"] = uv_time
        _, stride_v = downsample_2d(values_list, MAX_POINTS)
        if stride_v > 1:
            result["downsampled"] = True
            nonlocal_stride[0] = max(nonlocal_stride[0], stride_v)
        values_ds, _ = downsample_2d(values_list, MAX_POINTS)
        channel_list = wavelengths.tolist() if wavelengths is not None else []
        result["detectors"]["UV"] = {
            "name": "UV",
            "wavelengths": channel_list,
            "data": values_ds,
            "time": uv_time,
            "instrument_class": "cached",
        }

    max_stride = nonlocal_stride[0]

    result["downsample_factor"] = max_stride
    return result


def load_single_detector(raw_data_path: str, detector: str, file_hash: Optional[str] = None) -> dict:
    """Load chromatogram data for a single detector.

    *detector* should be one of "MALS", "RI", "UV" (case-insensitive).
    """
    detector = detector.upper()
    all_data = load_chromatograms(raw_data_path, file_hash=file_hash)
    if detector not in all_data["detectors"]:
        return {
            "detector": detector,
            "time": None,
            "data": None,
            "downsampled": all_data["downsampled"],
            "downsample_factor": all_data["downsample_factor"],
            "error": f"Detector {detector} not found in this experiment",
        }
    det_data = all_data["detectors"][detector]
    # Use the detector's own time axis (falls back to the shared axis for
    # legacy caches that predate per-detector time).
    det_time = det_data.get("time") if isinstance(det_data, dict) else None
    return {
        "detector": detector,
        "time": det_time if det_time is not None else all_data["time"],
        "data": det_data,
        "downsampled": all_data["downsampled"],
        "downsample_factor": all_data["downsample_factor"],
    }


def list_detectors(raw_data_path: str) -> list[dict]:
    """List all detectors present in the .afe8 file with their info."""
    reader = AstraReader(raw_data_path)
    try:
        detectors = []

        # MALS
        mals = reader.mals
        mals_chrom = reader.get_mals_chromatogram()
        detectors.append({
            "code": "MALS",
            "name": mals.name or "MALS",
            "enabled": mals_chrom is not None,
            "angles": mals.detector_angles.tolist() if hasattr(mals.detector_angles, "tolist") else list(mals.detector_angles) if len(mals.detector_angles) > 0 else None,
            "num_detectors": mals.num_detectors,
            "instrument_class": mals_chrom.instrument_class if mals_chrom else "WHeleos8Profile",
        })

        # RI
        ri = reader.ri
        ri_chrom = reader.get_ri_chromatogram()
        detectors.append({
            "code": "RI",
            "name": ri.name or "RI",
            "enabled": ri_chrom is not None,
            "instrument_class": ri_chrom.instrument_class if ri_chrom else "WNGOInstrumentProfile",
        })

        # UV
        uv = reader.uv
        uv_chrom = reader.get_uv_chromatogram()
        detectors.append({
            "code": "UV",
            "name": uv.name or "UV",
            "enabled": uv_chrom is not None,
            "wavelengths": uv.wavelengths if uv.wavelengths else None,
            "instrument_class": uv_chrom.instrument_class if uv_chrom else "WHplcUVDeviceProfile",
        })

        return detectors
    finally:
        reader.close()
