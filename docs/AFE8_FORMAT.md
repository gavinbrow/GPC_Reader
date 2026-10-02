# .afe8 File Format Specification

## Overview

The `.afe8` file is Wyatt ASTRA's native experiment file format. It contains
all raw detector data, metadata, analysis parameters, and computed results
for a single GPC/SEC experiment.

## File Structure

An `.afe8` file is a **gzip-compressed SQLite database**:

```
.afe8 file
  └── gzip compression
       └── SQLite database
            ├── WExperiment           — experiment metadata
            ├── WFileEntry            — file/directory info
            ├── WSolventProfile       — solvent properties
            ├── WHeleos8Profile       — MALS instrument config (DAWN 8)
            ├── WHeleosNeonProfile    — MALS instrument config (HELEOS Neon)
            ├── WMiniDawnProfile      — MALS instrument config (miniDAWN)
            ├── WTreosProfile         — MALS instrument config (TREOS)
            ├── WNGOInstrumentProfile — RI instrument config
            ├── WHplcUVDeviceProfile  — UV instrument config
            ├── WGenericViscometerProfile — viscometer config
            ├── WInjectedSampleProfile — sample info (dn/dc, etc.)
            ├── WFluidConnectionPath  — fluid path / tubing delays
            ├── WPeakRange            — peak integration windows
            ├── WBaseline             — per-detector baselines
            ├── WResultData           — computed results (Mn, Mw, Mz, etc.)
            └── W*Procedure tables    — analysis procedure parameters
```

## BLOB Encoding

Detector data (MALS, RI, UV, viscometer) is stored as BLOBs in SQLite columns.
The BLOB format is:

```
Header (16 bytes):
  - uint32 blob_size        — total BLOB size in bytes (including header)
  - uint32 uncompressed_size — size of the decompressed payload
  - uint32 count             — number of elements in the array
  - uint32 element_size      — bytes per element (4=float, 8=double)

Payload:
  - zlib-compressed array of count × element_size bytes
```

### Decoding

```python
import struct, zlib, numpy as np

def decode_blob(blob: bytes, is_double: bool = True) -> np.ndarray:
    if len(blob) < 16:
        return np.array([])
    blob_size, uncomp_size, count, elem_size = struct.unpack("<IIII", blob[:16])
    payload = zlib.decompress(blob[16:])
    dtype = np.float64 if is_double else np.float32
    return np.frombuffer(payload, dtype=dtype).copy()
```

### Encoding

```python
def encode_blob(arr: np.ndarray, is_double: bool = True) -> bytes:
    dtype = np.float64 if is_double else np.float32
    arr_bytes = arr.astype(dtype).tobytes()
    compressed = zlib.compress(arr_bytes)
    count = len(arr)
    elem_size = 8 if is_double else 4
    header = struct.pack("<IIII", 16 + len(compressed), len(arr_bytes), count, elem_size)
    return header + compressed
```

## Key Tables

### WExperiment

Contains top-level experiment metadata: sample set name, operator, collection
time, processing time, ASTRA version, etc.

### WHeleos8Profile (MALS)

MALS instrument configuration:
- `m_sName` — instrument name (e.g. "DAWN HELEOS 8")
- `m_dWavelength` — laser wavelength in nm (e.g. 662.72)
- `m_vDetectorAngles` — BLOB of detector angles in degrees
- `m_vNormalizationCoefficients` — BLOB of per-angle normalization coefficients
- `m_dCalibrationConstant` — instrument calibration constant

### WNGOInstrumentProfile (RI)

RI detector configuration:
- `m_sName` — instrument name (e.g. "Optilab rEX")
- `m_dTemperature` — cell temperature

### WHplcUVDeviceProfile (UV)

UV detector configuration:
- `m_sName` — instrument name
- `m_vWavelengths` — BLOB of UV wavelengths

### WPeakRange

Peak integration windows:
- `rangeNumber` — peak number (1-based)
- `rangeStart` — start time in minutes
- `rangeEnd` — end time in minutes
- `rangeName` — user-defined peak name

### WBaseline

Per-detector baseline definitions:
- `m_sDetectorName` — detector name (e.g. "MALS", "RI")
- `m_nBaselineType` — 0=constant, 1=linear, 2=point-pair
- `m_dX1`, `m_dX2`, `m_dY1`, `m_dY2` — baseline endpoint coordinates

### WResultData

Computed results keyed by `(m_nPeak, m_nDataName, m_sInstrumentClassName)`:
- `m_nPeak` — peak number
- `m_nDataName` — integer code identifying the result type
- `m_sInstrumentClassName` — instrument class
- `m_dValue` — the computed value

#### Data Name Codes

| Code | Description |
|------|-------------|
| 12120 | Mn (number-average molar mass) |
| 12121 | Mw (weight-average molar mass) |
| 12122 | Mz (z-average molar mass) |
| 12161 | Pd (polydispersity, Mw/Mn) |
| 12128 | Rg (radius of gyration) |
| 12189 | Peak area |

### Procedure Tables

Each analysis procedure has its own table storing parameters and run state:

| Table | Procedure |
|-------|-----------|
| `WDefineBaselinesProcedure` | Baseline definition |
| `WNormalizationProcedure` | MALS normalization |
| `WDefinePeaksProcedure` | Peak definition |
| `WBandBroadeningProcedure` | Band broadening correction |
| `WDetermineInterDetectorDelayProcedure` | Interdetector alignment |
| `WDetermineDistributionsAndMomentsProcedure` | Distributions and moments |
| `WBaselineSubtractionProcedure` | Baseline subtraction |

Common columns:
- `m_bHasBeenRun` — bool, whether the procedure has been executed
- `m_bStopProcedure` — bool, whether the procedure is disabled (inverted logic)

## MALS Detector Data

MALS data is stored as a 2-D array (time × angles) in a BLOB column. The time
axis is typically in minutes, and angles are in degrees (e.g. 15°, 25°, 35°,
45°, 55°, 65°, 75°, 90°, 105°, 115°, 125°, 135°, 145°, 155°, 165° for an
18-angle DAWN instrument).

## RI Detector Data

RI data is stored as a 1-D array (signal vs time). The raw signal is
dimensionless (delta RI units); concentration is derived as:

    c = (RI - baseline) / dn_dc

## UV Detector Data

UV data is stored as a 2-D array (time × wavelengths). Concentration from UV:

    c = A / (epsilon * l)

where A is absorbance, epsilon is the molar extinction coefficient, and l is
the path length.

## Round-Trip Integrity

When writing modifications back to `.afe8`:
1. Only the modified tables are updated
2. All other tables are preserved byte-for-byte
3. The file is written atomically (temp file + rename) to prevent corruption
4. The gzip + SQLite structure is maintained

## Versioning

The ASTRA version is stored in `WExperiment.m_sAstraVersion`. The file format
is stable across ASTRA 7.x versions. Future ASTRA versions may add new tables
or columns — the parser handles missing tables gracefully.