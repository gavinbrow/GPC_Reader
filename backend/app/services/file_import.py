"""File import service — wraps AstraReader to parse .afe8 files and persist to DB."""

import hashlib
import json
import logging
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np
from sqlalchemy.orm import Session

from app.models import Experiment, Peak

logger = logging.getLogger(__name__)

# Make the astra_reader module importable
_backend_root = Path(__file__).resolve().parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

from astra_reader import AstraReader  # noqa: E402

# MALS profile table names to try, in priority order.
MALS_PROFILE_TABLES = [
    "WHeleos8Profile",
    "WHeleosNeonProfile",
    "WMiniDawnProfile",
    "WTreosProfile",
]

MAX_POINTS = 10_000  # threshold for downsampling


def _np_to_list(arr: Any) -> Any:
    """Recursively convert numpy arrays/scalars to plain Python lists/values."""
    if isinstance(arr, np.ndarray):
        return arr.tolist()
    if isinstance(arr, (np.floating, np.integer)):
        return arr.item()
    if isinstance(arr, dict):
        return {k: _np_to_list(v) for k, v in arr.items()}
    if isinstance(arr, (list, tuple)):
        return [_np_to_list(v) for v in arr]
    return arr


def downsample(data: list, max_points: int = MAX_POINTS) -> tuple[list, int]:
    """Downsample a 1-D list to *max_points* by taking every N-th element.

    Returns (downsampled_list, stride).
    """
    n = len(data)
    if n <= max_points:
        return data, 1
    stride = max(1, n // max_points)
    return data[::stride], stride


def downsample_2d(data: list[list], max_points: int = MAX_POINTS) -> tuple[list[list], int]:
    """Downsample a 2-D list (time × detectors) along axis 0."""
    n = len(data)
    if n <= max_points:
        return data, 1
    stride = max(1, n // max_points)
    return data[::stride], stride


class ImportService:
    """Service for importing .afe8 files and extracting all metadata."""

    @staticmethod
    def validate_gzip_magic(file_path: str) -> bool:
        """Check that the first two bytes are 0x1f 0x8b (gzip magic)."""
        try:
            with open(file_path, "rb") as f:
                header = f.read(2)
            return header == b"\x1f\x8b"
        except OSError:
            return False

    @staticmethod
    def compute_file_hash(file_path: str) -> str:
        """Compute SHA-256 hash of a file."""
        h = hashlib.sha256()
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()

    @staticmethod
    def health_check(file_path: str) -> bool:
        """Validate gzip magic, SQLite integrity, and presence of WExperiment table."""
        # 1) gzip magic
        if not ImportService.validate_gzip_magic(file_path):
            return False
        # 2) Open with AstraReader (which decompresses to a temp SQLite)
        reader = AstraReader(file_path)
        try:
            tables = reader.list_tables()
            if "WExperiment" not in tables:
                return False
            return True
        except Exception:
            return False
        finally:
            reader.close()

    @staticmethod
    def import_file(file_path: str, original_filename: str) -> dict:
        """Parse an .afe8 file and return an experiment dict suitable for DB storage.

        Does NOT write to the database — caller is responsible for persistence.
        """
        reader = AstraReader(file_path)
        try:
            # --- Experiment / file info ---
            exp_info = reader.experiment
            file_info = reader.file_info
            solvent = reader.solvent
            mals = reader.mals
            ri = reader.ri
            uv = reader.uv
            viscometer = reader.viscometer
            sample = reader.sample
            peaks = reader.peaks
            fluid_connections = reader.fluid_connections

            # --- Build JSON configs ---
            mals_config = {
                "name": mals.name,
                "description": mals.description,
                "temperature": mals.temperature,
                "wavelength": mals.wavelength,
                "num_detectors": mals.num_detectors,
                "calibration_constant": mals.calibration_constant,
                "detector_angles": mals.detector_angles.tolist() if hasattr(mals.detector_angles, "tolist") else list(mals.detector_angles),
                "normalization_coefficients": mals.normalization_coefficients.tolist() if hasattr(mals.normalization_coefficients, "tolist") else list(mals.normalization_coefficients),
                "instrumental_term": mals.instrumental_term,
                "mixing_term": mals.mixing_term,
                "firmware_version": mals.firmware_version,
            }

            ri_config = {
                "name": ri.name,
                "temperature": ri.temperature,
                "wavelength": ri.wavelength,
                "calibration_constant": ri.calibration_constant,
            }

            uv_config = {
                "name": uv.name,
                "description": uv.description,
                "cell_length": uv.cell_length,
                "active_channel": uv.active_channel,
                "wavelengths": uv.wavelengths,
            }

            viscometer_config = {
                "name": viscometer.name,
                "temperature": viscometer.temperature,
                "dilution_factor": viscometer.dilution_factor,
                "use_specific_viscosity": viscometer.use_specific_viscosity,
                "enable_dilution_correction": viscometer.enable_dilution_correction,
            }

            sample_config = {
                "name": sample.name,
                "description": sample.description,
                "dn_dc": sample.dn_dc,
                "a2": sample.a2,
                "wavelength": sample.wavelength,
                "uv_extinction_coefficient": sample.uv_extinction_coefficient,
                "concentration": sample.concentration,
                "reference_temperature": sample.reference_temperature,
                "real_ri": sample.real_ri,
                "imaginary_ri": sample.imaginary_ri,
                "mhs_k": sample.mhs_k,
                "mhs_a": sample.mhs_a,
                "primary_uv_wavelength": sample.primary_uv_wavelength,
                "secondary_uv_wavelength": sample.secondary_uv_wavelength,
            }

            fluid_path = [
                {
                    "name": fc.name,
                    "description": fc.description,
                    "source_instrument": fc.source_instrument,
                    "destination_instrument": fc.destination_instrument,
                    "interdetector_volume": fc.interdetector_volume,
                    "temperature": fc.temperature,
                }
                for fc in fluid_connections
            ]

            # --- Parse dates (they are stored as strings in the .afe8) ---
            def _parse_dt(s: str | None) -> str | None:
                if not s:
                    return None
                return s

            collection_time = _parse_dt(file_info.time_collected)
            processing_time = _parse_dt(exp_info.processing_datetime)
            astra_version = str(exp_info.collection_astra_version)

            experiment_dict = {
                "file_name": original_filename,
                "original_path": file_info.directory,
                "file_size": file_info.size,
                "sample_name": sample.name,
                "solvent_name": solvent.name,
                "solvent_description": solvent.description,
                "operator_name": file_info.author,
                "collection_time": collection_time,
                "processing_time": processing_time,
                "astra_version": astra_version,
                "mals_config": json.dumps(mals_config),
                "ri_config": json.dumps(ri_config),
                "uv_config": json.dumps(uv_config),
                "viscometer_config": json.dumps(viscometer_config),
                "sample_config": json.dumps(sample_config),
                "fluid_path": json.dumps(fluid_path),
                "peaks": [
                    {
                        "range_number": p.range_number,
                        "range_name": p.range_name,
                        "range_start": p.range_start,
                        "range_end": p.range_end,
                        "dn_dc": p.dn_dc,
                        "uv_extinction": p.uv_extinction_coefficient,
                        "concentration": p.concentration,
                        "injected_mass": p.injected_mass,
                        "real_ri": p.real_ri,
                        "ls_model": p.ls_model,
                        "ls_fit_degree": p.ls_fit_degree,
                        "radius_type": p.radius_type,
                        "a2": p.a2,
                        "mn": p.mn,
                        "mw": p.mw,
                    }
                    for p in peaks
                ],
            }

            return _np_to_list(experiment_dict)
        finally:
            reader.close()

    @staticmethod
    def save_experiment(
        db: Session,
        experiment_dict: dict,
        raw_data_path: str,
        file_hash: str,
        file_size: int,
        created_by: Optional[int] = None,
    ) -> Experiment:
        """Persist an experiment dict to the database."""
        exp = Experiment(
            file_name=experiment_dict["file_name"],
            original_path=experiment_dict.get("original_path"),
            file_size=file_size,
            file_hash=file_hash,
            sample_name=experiment_dict.get("sample_name"),
            solvent_name=experiment_dict.get("solvent_name"),
            solvent_description=experiment_dict.get("solvent_description"),
            operator_name=experiment_dict.get("operator_name"),
            collection_time=experiment_dict.get("collection_time"),
            processing_time=experiment_dict.get("processing_time"),
            astra_version=experiment_dict.get("astra_version"),
            mals_config=experiment_dict.get("mals_config"),
            ri_config=experiment_dict.get("ri_config"),
            uv_config=experiment_dict.get("uv_config"),
            viscometer_config=experiment_dict.get("viscometer_config"),
            sample_config=experiment_dict.get("sample_config"),
            fluid_path=experiment_dict.get("fluid_path"),
            raw_data_path=raw_data_path,
            created_by=created_by,
        )
        db.add(exp)
        db.flush()  # get exp.id

        # Store peaks
        for peak_dict in experiment_dict.get("peaks", []):
            peak = Peak(
                experiment_id=exp.id,
                range_number=peak_dict.get("range_number"),
                range_name=peak_dict.get("range_name"),
                range_start=peak_dict.get("range_start"),
                range_end=peak_dict.get("range_end"),
                dn_dc=peak_dict.get("dn_dc"),
                uv_extinction=peak_dict.get("uv_extinction"),
                concentration=peak_dict.get("concentration"),
                injected_mass=peak_dict.get("injected_mass"),
                real_ri=peak_dict.get("real_ri"),
                ls_model=peak_dict.get("ls_model"),
                ls_fit_degree=peak_dict.get("ls_fit_degree"),
                radius_type=peak_dict.get("radius_type"),
                a2=peak_dict.get("a2"),
                mn=peak_dict.get("mn"),
                mw=peak_dict.get("mw"),
            )
            db.add(peak)

        db.commit()
        db.refresh(exp)
        return exp
