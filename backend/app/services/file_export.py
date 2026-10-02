"""AFE8 writer for Phase 7 advanced export.

Reads an existing gzip-compressed SQLite .afe8, writes our DB-stored baselines,
peak ranges, computed results, and procedure parameters back into the file's
tables, then re-compresses and atomically writes the result.

Tables written:
    - ``WBaseline`` — baseline parameters (Phase 2)
    - ``WPeakRange`` — peak range parameters (Phase 2)
    - ``WResultData`` — per-peak scalar results: Mn, Mw, Mz, Pd, Rg, etc. (Phase 7)
    - ``WScalarData`` — instrument-level scalar results (Phase 7)
    - ``WDefineBaselinesProcedure`` — has_been_run flag (Phase 7)
    - ``WNormalizationProcedure`` — has_been_run flag (Phase 7)
    - ``WDefinePeaksProcedure`` — has_been_run flag (Phase 7)
    - ``WBandBroadeningProcedure`` — has_been_run flag (Phase 7)
    - ``WDetermineInterDetectorDelayProcedure`` — has_been_run flag (Phase 7)
    - ``WDetermineDistributionsAndMomentsProcedure`` — has_been_run flag (Phase 7)
    - ``WBaselineSubtractionProcedure`` — has_been_run flag (Phase 7)

All other tables are preserved byte-for-byte (we modify the SQLite database in
place and only touch the named tables, then re-gzip the whole database).

See ``architecture.md`` §3.6 (atomic file writes) and §9.4 (round-trip test).
"""

from __future__ import annotations

import gzip
import logging
import os
import sqlite3
import tempfile
import uuid

logger = logging.getLogger(__name__)


_BASELINE_COLUMN_MAP = {
    "baseline_type": "m_nBaselineType",
    "x1": "m_dX1",
    "x2": "m_dX2",
    "y1": "m_dY1",
    "y2": "m_dY2",
    "slope": "slope",
    "intercept": "intercept",
    "std_dev": "baselineStdDev",
}

_PEAK_COLUMN_MAP = {
    "range_name": "rangeName",
    "range_start": "rangeStart",
    "range_end": "rangeEnd",
    "dn_dc": "m_dDNDC",
    "uv_extinction": "m_dUVExtinctionCoefficient",
    "concentration": "m_dConcentration",
    "injected_mass": "m_dInjectedMass",
    "ls_model": "m_nLSModel",
    "ls_fit_degree": "m_nLSFitDegree",
    "radius_type": "m_nRadiusType",
    "a2": "m_dA2",
    "real_ri": "m_dRealRI",
}

_RESULT_DATA_NAME_MAP = {
    "mn": 12120,
    "mw": 12121,
    "mz": 12122,
    "polydispersity": 12161,
    "rms_radius": 12128,
    "peak_area": 12189,
    "recovery": 12285,
}

_RESULT_DATA_CATEGORY = {
    "mn": 14,
    "mw": 14,
    "mz": 14,
    "polydispersity": 18,
    "rms_radius": 22,
    "peak_area": 4,
    "recovery": 4,
}

_RESULT_VALUE_UNITS = {
    "mn": 12069,
    "mw": 12069,
    "mz": 12069,
    "polydispersity": 12098,
    "rms_radius": 12070,
    "peak_area": 12408,
    "recovery": 12098,
}

_RESULT_VALUE_NAME = {
    "mn": 12020,
    "mw": 12020,
    "mz": 12020,
    "polydispersity": 12161,
    "rms_radius": 12123,
    "peak_area": 12189,
    "recovery": 12285,
}

_PROCEDURE_TABLES = [
    "WDefineBaselinesProcedure",
    "WNormalizationProcedure",
    "WDefinePeaksProcedure",
    "WBandBroadeningProcedure",
    "WDetermineInterDetectorDelayProcedure",
    "WDetermineDistributionsAndMomentsProcedure",
    "WBaselineSubtractionProcedure",
]


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    cur = conn.execute(f'PRAGMA table_info("{table}")')
    cols = [row[1] for row in cur.fetchall()]
    cur.close()
    return cols


def _write_baselines(conn: sqlite3.Connection, baselines: list[dict]) -> tuple[int, list[str]]:
    """Update WBaseline rows that match by m_sSeriesName. Returns (written, warnings)."""
    warnings: list[str] = []
    if not baselines:
        return 0, warnings

    cols = _table_columns(conn, "WBaseline")
    if "m_sSeriesName" not in cols:
        warnings.append("WBaseline table has no m_sSeriesName column; skipping baselines")
        return 0, warnings

    cur = conn.execute('SELECT m_sSeriesName FROM WBaseline')
    existing_names = {row[0] for row in cur.fetchall()}
    cur.close()

    set_cols = []
    for our_key, file_col in _BASELINE_COLUMN_MAP.items():
        if file_col in cols:
            set_cols.append(file_col)
    if not set_cols:
        warnings.append("WBaseline has none of the target columns; skipping baselines")
        return 0, warnings

    written = 0
    for b in baselines:
        detector_name = b.get("detector_name")
        if detector_name is None:
            warnings.append("baseline row missing detector_name; skipped")
            continue
        if detector_name not in existing_names:
            warnings.append(
                f"baseline detector_name '{detector_name}' not found in WBaseline.m_sSeriesName; skipped"
            )
            continue
        assignments = []
        values: list = []
        for our_key, file_col in _BASELINE_COLUMN_MAP.items():
            if file_col not in set_cols:
                continue
            if our_key not in b or b[our_key] is None:
                continue
            assignments.append(f'"{file_col}" = ?')
            values.append(b[our_key])
        if not assignments:
            warnings.append(
                f"baseline for '{detector_name}' had no settable fields; skipped"
            )
            continue
        values.append(detector_name)
        sql = (
            'UPDATE WBaseline SET '
            + ", ".join(assignments)
            + ' WHERE "m_sSeriesName" = ?'
        )
        cur = conn.execute(sql, values)
        if cur.rowcount > 0:
            written += 1
        cur.close()
    return written, warnings


def _write_peaks(conn: sqlite3.Connection, peaks: list[dict]) -> tuple[int, list[str]]:
    """Update or append WPeakRange rows matched by rangeNumber. Returns (written, warnings)."""
    warnings: list[str] = []
    if not peaks:
        return 0, warnings

    cols = _table_columns(conn, "WPeakRange")
    if "rangeNumber" not in cols:
        warnings.append("WPeakRange table has no rangeNumber column; skipping peaks")
        return 0, warnings

    cur = conn.execute("SELECT rangeNumber FROM WPeakRange")
    existing_numbers = {row[0] for row in cur.fetchall()}
    cur.close()

    template_row = None
    cur = conn.execute("SELECT * FROM WPeakRange LIMIT 1")
    row = cur.fetchone()
    if row is not None:
        template_row = dict(zip([d[0] for d in cur.description], row, strict=False))
    cur.close()

    written = 0
    for p in peaks:
        range_number = p.get("range_number")
        if range_number is None:
            warnings.append("peak row missing range_number; skipped")
            continue

        assignments = []
        values: list = []
        for our_key, file_col in _PEAK_COLUMN_MAP.items():
            if file_col not in cols:
                continue
            if our_key not in p or p[our_key] is None:
                continue
            assignments.append(f'"{file_col}" = ?')
            values.append(p[our_key])

        if range_number in existing_numbers:
            if not assignments:
                warnings.append(
                    f"peak range_number {range_number} had no settable fields; skipped"
                )
                continue
            values.append(range_number)
            sql = (
                'UPDATE WPeakRange SET '
                + ", ".join(assignments)
                + ' WHERE "rangeNumber" = ?'
            )
            cur = conn.execute(sql, values)
            if cur.rowcount > 0:
                written += 1
            cur.close()
        else:
            if template_row is None:
                warnings.append(
                    f"cannot append peak range_number {range_number}: WPeakRange has no template row"
                )
                continue
            new_row = dict(template_row)
            for our_key, file_col in _PEAK_COLUMN_MAP.items():
                if file_col not in cols:
                    continue
                if our_key in p and p[our_key] is not None:
                    new_row[file_col] = p[our_key]
            new_row["rangeNumber"] = range_number
            if "groupID" in cols:
                new_row["groupID"] = "{" + str(uuid.uuid4()).upper() + "}"
            if "objectID" in cols:
                new_row["objectID"] = "{" + str(uuid.uuid4()).upper() + "}"
            col_list = [c for c in cols if c in new_row]
            placeholders = ", ".join(["?"] * len(col_list))
            col_sql = ", ".join(f'"{c}"' for c in col_list)
            insert_values = [new_row[c] for c in col_list]
            sql = f'INSERT INTO WPeakRange ({col_sql}) VALUES ({placeholders})'
            try:
                cur = conn.execute(sql, insert_values)
                if cur.rowcount > 0:
                    written += 1
                    existing_numbers.add(range_number)
                cur.close()
            except sqlite3.IntegrityError as e:
                warnings.append(
                    f"failed to append peak range_number {range_number}: {e}"
                )
    return written, warnings


def _write_results(conn: sqlite3.Connection, results: list[dict]) -> tuple[int, list[str]]:
    """Update or insert WResultData rows for per-peak computed results.

    Each dict in *results* should have:
        - ``peak`` (int): the peak number (1-based)
        - Any of: ``mn``, ``mw``, ``mz``, ``polydispersity``, ``rms_radius``,
          ``peak_area``, ``recovery`` (float values)

    Matching is done by ``(m_nPeak, m_nDataName, m_sInstrumentClassName)``.
    The instrument class is set to an empty string (ASTRA uses this for
    "Combined" results).

    Returns (written, warnings).
    """
    warnings: list[str] = []
    if not results:
        return 0, warnings

    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    if "WResultData" not in tables:
        warnings.append("WResultData table not found; skipping results")
        return 0, warnings

    cols = _table_columns(conn, "WResultData")
    written = 0

    for r in results:
        peak = r.get("peak")
        if peak is None:
            warnings.append("result row missing peak; skipped")
            continue

        for our_key, data_name_code in _RESULT_DATA_NAME_MAP.items():
            value = r.get(our_key)
            if value is None:
                continue

            category = _RESULT_DATA_CATEGORY.get(our_key, 0)
            value_units = _RESULT_VALUE_UNITS.get(our_key, 0)
            value_name = _RESULT_VALUE_NAME.get(our_key, 0)

            cur = conn.execute(
                'SELECT COUNT(*) FROM WResultData WHERE "m_nPeak" = ? AND "m_nDataName" = ? AND "m_sInstrumentClassName" = ?',
                [peak, data_name_code, ""],
            )
            exists = cur.fetchone()[0] > 0
            cur.close()

            if exists:
                assignments: list[str] = []
                values: list = []
                if "m_dValue" in cols:
                    assignments.append('"m_dValue" = ?')
                    values.append(float(value))
                if "dataCategory" in cols:
                    assignments.append('"dataCategory" = ?')
                    values.append(category)
                if "m_nValueUnits" in cols:
                    assignments.append('"m_nValueUnits" = ?')
                    values.append(value_units)
                if "m_nValueName" in cols:
                    assignments.append('"m_nValueName" = ?')
                    values.append(value_name)
                if not assignments:
                    continue
                values.extend([peak, data_name_code, ""])
                sql = (
                    'UPDATE WResultData SET '
                    + ", ".join(assignments)
                    + ' WHERE "m_nPeak" = ? AND "m_nDataName" = ? AND "m_sInstrumentClassName" = ?'
                )
                cur = conn.execute(sql, values)
                if cur.rowcount > 0:
                    written += 1
                cur.close()
            else:
                new_row: dict = {}
                if "m_nDataName" in cols:
                    new_row["m_nDataName"] = data_name_code
                if "m_nValueUnits" in cols:
                    new_row["m_nValueUnits"] = value_units
                if "m_nValueName" in cols:
                    new_row["m_nValueName"] = value_name
                if "m_nPeak" in cols:
                    new_row["m_nPeak"] = peak
                if "m_sInstrumentClassName" in cols:
                    new_row["m_sInstrumentClassName"] = ""
                if "dataCategory" in cols:
                    new_row["dataCategory"] = category
                if "m_dValue" in cols:
                    new_row["m_dValue"] = float(value)
                if "m_dHighUncertainty" in cols:
                    new_row["m_dHighUncertainty"] = 0.0
                if "m_dLowUncertainty" in cols:
                    new_row["m_dLowUncertainty"] = 0.0
                if "m_bUncertainties" in cols:
                    new_row["m_bUncertainties"] = 0
                if "m_bSymmetricUncertainties" in cols:
                    new_row["m_bSymmetricUncertainties"] = 1
                if "m_bUnableToCalculate" in cols:
                    new_row["m_bUnableToCalculate"] = 0
                if "indexValue" in cols:
                    new_row["indexValue"] = 0.0
                if "indexName" in cols:
                    new_row["indexName"] = 0
                if "indexUnits" in cols:
                    new_row["indexUnits"] = 0
                if "m_nSecondaryValueUnit" in cols:
                    new_row["m_nSecondaryValueUnit"] = 0
                if "groupID" in cols:
                    new_row["groupID"] = "{" + str(uuid.uuid4()).upper() + "}"
                if "objectID" in cols:
                    new_row["objectID"] = "{" + str(uuid.uuid4()).upper() + "}"
                if "version" in cols:
                    new_row["version"] = 1
                if "checkSum" in cols:
                    new_row["checkSum"] = ""

                col_list = [c for c in cols if c in new_row]
                placeholders = ", ".join(["?"] * len(col_list))
                col_sql = ", ".join(f'"{c}"' for c in col_list)
                insert_values = [new_row[c] for c in col_list]
                sql = f'INSERT INTO WResultData ({col_sql}) VALUES ({placeholders})'
                try:
                    cur = conn.execute(sql, insert_values)
                    if cur.rowcount > 0:
                        written += 1
                    cur.close()
                except sqlite3.IntegrityError as e:
                    warnings.append(
                        f"failed to insert WResultData for peak {peak}, {our_key}: {e}"
                    )
    return written, warnings


def _write_procedures(conn: sqlite3.Connection, procedures: list[dict]) -> tuple[int, list[str]]:
    """Update has_been_run and procedure parameters in procedure tables.

    Each dict in *procedures* should have:
        - ``procedure_name`` (str): the app-DB procedure name
        - ``has_been_run`` (bool, optional): set m_bHasBeenRun
        - ``is_enabled`` (bool, optional): set m_bStopProcedure (inverted)
        - ``parameters`` (dict, optional): parameter-specific updates

    The procedure_name is mapped to the .afe8 table name. Only scalar columns
    are updated; BLOB columns (like baselineEntries, m_vPeakRangeEntries) are
    left untouched.

    Returns (written, warnings).
    """
    warnings: list[str] = []
    if not procedures:
        return 0, warnings

    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}

    name_to_table = {
        "define_baselines": "WDefineBaselinesProcedure",
        "normalization": "WNormalizationProcedure",
        "define_peaks": "WDefinePeaksProcedure",
        "band_broadening": "WBandBroadeningProcedure",
        "inter_detector_delay": "WDetermineInterDetectorDelayProcedure",
        "distributions_and_moments": "WDetermineDistributionsAndMomentsProcedure",
        "baseline_subtraction": "WBaselineSubtractionProcedure",
    }

    written = 0
    for proc in procedures:
        proc_name = proc.get("procedure_name")
        if proc_name is None:
            continue
        table_name = name_to_table.get(proc_name)
        if table_name is None:
            continue
        if table_name not in tables:
            continue

        cols = _table_columns(conn, table_name)
        assignments: list[str] = []
        values: list = []

        if "m_bHasBeenRun" in cols and proc.get("has_been_run") is not None:
            assignments.append('"m_bHasBeenRun" = ?')
            values.append(1 if proc["has_been_run"] else 0)

        if "m_bStopProcedure" in cols and proc.get("is_enabled") is not None:
            assignments.append('"m_bStopProcedure" = ?')
            values.append(0 if proc["is_enabled"] else 1)

        params = proc.get("parameters", {})
        if isinstance(params, str):
            import json
            try:
                params = json.loads(params)
            except (json.JSONDecodeError, TypeError):
                params = {}

        scalar_param_map = {
            "WDefineBaselinesProcedure": {
                "window_width": "m_nWindowWidth",
                "active_series": "m_sActiveSeries",
                "auto_baseline_default": "m_sAutoBaselineDefault",
            },
            "WNormalizationProcedure": {
                "normalization_peak": "m_nNormalizationPeak",
                "percent_to_keep": "m_dPercentToKeep",
                "rint_normalization": "m_bRIntNormalization",
            },
            "WDefinePeaksProcedure": {
                "peak_threshold": "peakThreshold",
                "peak_baseline": "peakBaseline",
                "sub_peak_threshold": "subPeakThreshold",
                "min_peak_width": "minPeakWidth",
            },
            "WBandBroadeningProcedure": {
                "broadening_form": "broadeningForm",
            },
            "WDetermineInterDetectorDelayProcedure": {
                "slice": "m_nSlice",
            },
            "WDetermineDistributionsAndMomentsProcedure": {
                "slice": "m_nSlice",
                "data_analysis_range": "m_dDataAnalysisRange",
                "smoothing": "smoothing",
                "bin_size": "binSize",
            },
        }

        col_map = scalar_param_map.get(table_name, {})
        for param_key, file_col in col_map.items():
            if file_col not in cols:
                continue
            if param_key not in params or params[param_key] is None:
                continue
            assignments.append(f'"{file_col}" = ?')
            values.append(params[param_key])

        if not assignments:
            continue

        cur = conn.execute(f'SELECT COUNT(*) FROM "{table_name}"')
        row_count = cur.fetchone()[0]
        cur.close()

        if row_count > 0:
            sql = f'UPDATE "{table_name}" SET ' + ", ".join(assignments)
            cur = conn.execute(sql, values)
            if cur.rowcount > 0:
                written += 1
            cur.close()
        else:
            new_row: dict = {}
            for our_key, file_col in col_map.items():
                if file_col in cols and our_key in params and params[our_key] is not None:
                    new_row[file_col] = params[our_key]
            if "m_bHasBeenRun" in cols and proc.get("has_been_run") is not None:
                new_row["m_bHasBeenRun"] = 1 if proc["has_been_run"] else 0
            if "m_bStopProcedure" in cols and proc.get("is_enabled") is not None:
                new_row["m_bStopProcedure"] = 0 if proc["is_enabled"] else 1
            if "groupID" in cols:
                new_row["groupID"] = "{" + str(uuid.uuid4()).upper() + "}"
            if "objectID" in cols:
                new_row["objectID"] = "{" + str(uuid.uuid4()).upper() + "}"
            if "version" in cols:
                new_row["version"] = 1
            if "checkSum" in cols:
                new_row["checkSum"] = ""
            if "m_nProcedureName" in cols:
                new_row["m_nProcedureName"] = 0
            if "m_nProcedureID" in cols:
                new_row["m_nProcedureID"] = 0
            if "m_nPeakIndex" in cols:
                new_row["m_nPeakIndex"] = -1
            if "m_nPeakNumber" in cols:
                new_row["m_nPeakNumber"] = -1
            if "m_nDataSetDefinitionID" in cols:
                new_row["m_nDataSetDefinitionID"] = 0

            all_cols = _table_columns(conn, table_name)
            col_list = [c for c in all_cols if c in new_row]
            placeholders = ", ".join(["?"] * len(col_list))
            col_sql = ", ".join(f'"{c}"' for c in col_list)
            insert_values = [new_row[c] for c in col_list]
            sql = f'INSERT INTO "{table_name}" ({col_sql}) VALUES ({placeholders})'
            try:
                cur = conn.execute(sql, insert_values)
                if cur.rowcount > 0:
                    written += 1
                cur.close()
            except sqlite3.IntegrityError as e:
                warnings.append(
                    f"failed to insert into {table_name}: {e}"
                )
    return written, warnings


def export_afe8(
    source_path: str,
    dest_path: str,
    baselines: list[dict] | None = None,
    peaks: list[dict] | None = None,
    results: list[dict] | None = None,
    procedures: list[dict] | None = None,
) -> dict:
    """Export a modified .afe8 file.

    Parameters
    ----------
    source_path : str
        Path to the original gzip-compressed .afe8 to read.
    dest_path : str
        Path to write the modified .afe8 to (atomically).
    baselines : list[dict]
        Baseline dicts (keys matching our ``baselines`` table columns).
    peaks : list[dict]
        Peak dicts (keys matching our ``peaks`` table columns).
    results : list[dict]
        Per-peak result dicts with keys: peak, mn, mw, mz, polydispersity,
        rms_radius, peak_area, recovery.
    procedures : list[dict]
        Procedure dicts with keys: procedure_name, has_been_run, is_enabled,
        parameters.

    Returns
    -------
    dict
        ``{"path": dest_path, "baselines_written": int,
           "peaks_written": int, "results_written": int,
           "procedures_written": int, "warnings": list[str]}``
    """
    baselines = baselines or []
    peaks = peaks or []
    results = results or []
    procedures = procedures or []

    with gzip.open(source_path, "rb") as f:
        db_bytes = f.read()

    tmp_db = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    tmp_db_path = tmp_db.name
    tmp_db.write(db_bytes)
    tmp_db.close()

    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(tmp_db_path)
        conn.execute("PRAGMA query_only=OFF;")
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if "WBaseline" not in tables:
            raise ValueError("source .afe8 has no WBaseline table")
        if "WPeakRange" not in tables:
            raise ValueError("source .afe8 has no WPeakRange table")

        baselines_written, baseline_warnings = _write_baselines(conn, baselines)
        peaks_written, peak_warnings = _write_peaks(conn, peaks)
        results_written, result_warnings = _write_results(conn, results)
        procedures_written, procedure_warnings = _write_procedures(conn, procedures)
        conn.commit()
        conn.close()
        conn = None

        with open(tmp_db_path, "rb") as f:
            new_db_bytes = f.read()

        dest_dir = os.path.dirname(dest_path)
        if dest_dir and not os.path.isdir(dest_dir):
            os.makedirs(dest_dir, exist_ok=True)

        tmp_out = dest_path + ".tmp"
        with gzip.open(tmp_out, "wb") as f:
            f.write(new_db_bytes)
        os.replace(tmp_out, dest_path)

        return {
            "path": dest_path,
            "baselines_written": baselines_written,
            "peaks_written": peaks_written,
            "results_written": results_written,
            "procedures_written": procedures_written,
            "warnings": (
                baseline_warnings
                + peak_warnings
                + result_warnings
                + procedure_warnings
            ),
        }
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        try:
            os.unlink(tmp_db_path)
        except OSError:
            pass
