"""
example_usage.py
=================
Example script demonstrating how to use the AstraReader class
to extract data from Wyatt ASTRA .afe8 files.

Usage:
    python example_usage.py "PS 30kDa 5mg-ml[PolyStyrene Calibration Check 5mg-ml].afe8"
"""

import sys
import numpy as np

# Fix Windows console encoding
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass
from astra_reader import AstraReader, lookup_data_name, lookup_instrument


def main():
    # == 1. Open the file ==================================================
    file_path = sys.argv[1] if len(sys.argv) > 1 else \
        "PS 30kDa 5mg-ml[PolyStyrene Calibration Check 5mg-ml].afe8"

    print(f"Opening: {file_path}")
    print("=" * 70)

    reader = AstraReader(file_path)

    # == 2. Print experiment summary =======================================
    print("\n== EXPERIMENT INFO ==")
    exp = reader.experiment
    print(f"  Path: {exp.path}")
    print(f"  Sample set file: {exp.sample_set_file}")
    print(f"  Processing date: {exp.processing_datetime}")

    print("\n== FILE INFO ==")
    fi = reader.file_info
    print(f"  File name: {fi.file_name}{fi.file_extension}")
    print(f"  Directory: {fi.directory}")
    print(f"  Created: {fi.time_created}")
    print(f"  Modified: {fi.time_modified}")
    print(f"  Collected: {fi.time_collected}")

    # == 3. Print solvent info =============================================
    print("\n== SOLVENT ==")
    sol = reader.solvent
    print(f"  Name: {sol.name}")
    print(f"  Description: {sol.description}")
    print(f"  Reference temperature: {sol.reference_temperature} °C")
    print(f"  Reference wavelength: {sol.reference_wavelength} nm")
    print(f"  Boiling point: {sol.boiling_point} °C")

    # == 4. Print instrument info ==========================================
    print("\n== MALS DETECTOR (DAWN 8) ==")
    mals = reader.mals
    print(f"  Name: {mals.name}")
    print(f"  Temperature: {mals.temperature} °C")
    print(f"  Laser wavelength: {mals.wavelength} nm")
    print(f"  Number of detectors: {mals.num_detectors}")
    if len(mals.detector_angles) > 0:
        print(f"  Detector angles: {mals.detector_angles}")
    if len(mals.normalization_coefficients) > 0:
        print(f"  Normalization coefficients: {mals.normalization_coefficients}")
    print(f"  Calibration constant: {mals.calibration_constant:.4e}")
    print(f"  Firmware: {mals.firmware_version}")

    print("\n== RI DETECTOR (Optilab) ==")
    ri = reader.ri
    print(f"  Name: {ri.name}")
    print(f"  Temperature: {ri.temperature} °C")
    print(f"  Wavelength: {ri.wavelength} nm")

    print("\n== UV DETECTOR ==")
    uv = reader.uv
    print(f"  Name: {uv.name}")
    print(f"  Cell length: {uv.cell_length} mm")
    if uv.wavelengths:
        print(f"  Wavelengths: {uv.wavelengths} nm")
    print(f"  Active channel: {uv.active_channel}")

    print("\n== VISCOMETER ==")
    visco = reader.viscometer
    print(f"  Name: {visco.name}")
    print(f"  Temperature: {visco.temperature} °C")

    # == 5. Print sample info ==============================================
    print("\n== SAMPLE ==")
    samp = reader.sample
    print(f"  Name: {samp.name}")
    print(f"  dn/dc: {samp.dn_dc}")
    print(f"  Concentration: {samp.concentration} g/mL")
    print(f"  Real RI: {samp.real_ri}")
    print(f"  Primary UV wavelength: {samp.primary_uv_wavelength} nm")
    print(f"  Secondary UV wavelength: {samp.secondary_uv_wavelength} nm")

    # == 6. Print fluid flow path ==========================================
    print("\n== FLUID FLOW PATH ==")
    for conn in reader.fluid_connections:
        print(f"  {conn.source_instrument:35s} -> {conn.destination_instrument}")

    # == 7. Print peak ranges ==============================================
    print("\n== PEAK RANGES ==")
    for peak in reader.peaks:
        print(f"  Peak {peak.range_number} ({peak.range_name}): "
              f"{peak.range_start:.3f} – {peak.range_end:.3f} min, "
              f"dn/dc={peak.dn_dc}, conc={peak.concentration}")

    # == 8. Print molar mass results =======================================
    print("\n== MOLAR MASS RESULTS ==")
    mm = reader.get_molar_mass_results()
    if mm:
        for key, val in mm.items():
            print(f"  {key}: {val:.4g}")
    else:
        print("  (no molar mass results found)")

    # == 9. Extract chromatograms =========================================
    print("\n== CHROMATOGRAMS ==")

    # MALS
    mals_chrom = reader.get_mals_chromatogram()
    if mals_chrom is not None:
        print(f"  MALS: {mals_chrom.values.shape[0]} time points × "
              f"{mals_chrom.values.shape[1]} detectors")
        print(f"    Time range: {mals_chrom.row_index[0]:.4f} – "
              f"{mals_chrom.row_index[-1]:.4f} min")
        print(f"    Column indices (detector #): {mals_chrom.column_index}")
        # Show peak region for detector 5 (90°)
        if mals_chrom.values.shape[1] >= 5:
            det5 = mals_chrom.values[:, 4]  # 0-indexed, detector 5 = 90°
            peak_start = 19.66  # from peak range
            peak_end = 23.87
            mask = (mals_chrom.row_index >= peak_start) & (mals_chrom.row_index <= peak_end)
            if mask.any():
                print(f"    90° detector peak region: max = {det5[mask].max():.6f}")
    else:
        print("  MALS: (not found)")

    # RI
    ri_chrom = reader.get_ri_chromatogram()
    if ri_chrom is not None:
        print(f"  RI: {len(ri_chrom.data_values)} data points")
        print(f"    Time range: {ri_chrom.index_values[0]:.4f} – "
              f"{ri_chrom.index_values[-1]:.4f} min")
        print(f"    Signal range: {ri_chrom.data_values.min():.6f} – "
              f"{ri_chrom.data_values.max():.6f} V")
    else:
        print("  RI: (not found)")

    # UV
    uv_chrom = reader.get_uv_chromatogram()
    if uv_chrom is not None:
        print(f"  UV: {uv_chrom.values.shape[0]} time points × "
              f"{uv_chrom.values.shape[1]} channels")
        print(f"    Time range: {uv_chrom.row_index[0]:.4f} – "
              f"{uv_chrom.row_index[-1]:.4f} min")
        print(f"    Column indices (channel #): {uv_chrom.column_index}")
    else:
        print("  UV: (not found)")

    # == 10. List all vector data series ==================================
    print("\n== ALL VECTOR DATA SERIES ==")
    for v in reader.vector_data:
        if len(v.data_values) > 0:
            print(f"  {v.instrument_name:25s} | DN={v.data_name_code:5d} "
                  f"({v.data_name:35s}) | {len(v.data_values):6d} points | "
                  f"peak={v.peak}")

    # == 11. List all matrix data series ==================================
    print("\n== ALL MATRIX DATA SERIES ==")
    for m in reader.matrix_data:
        if m.values.size > 0:
            shape_str = f"{m.values.shape[0]}×{m.values.shape[1]}" if m.values.ndim == 2 else str(m.values.shape)
            print(f"  {m.instrument_name:25s} | DN={m.data_name_code:5d} "
                  f"({m.data_name:35s}) | {shape_str} | peak={m.peak}")

    # == 12. List all computed results ===================================
    print("\n== ALL COMPUTED RESULTS ==")
    for r in reader.results:
        print(f"  Peak {r.peak} | {r.instrument_name:25s} | {r.data_name:40s} "
              f"| {r.value:.6g}")

    # == 13. Export data to CSV (example) =================================
    print("\n== EXPORT EXAMPLE ==")
    if mals_chrom is not None and ri_chrom is not None:
        # Align MALS 90° detector and RI on the same time axis
        mals_time = mals_chrom.row_index
        ri_time = ri_chrom.index_values

        # Interpolate RI onto MALS time axis
        ri_interp = np.interp(mals_time, ri_time, ri_chrom.data_values)

        # Save to CSV
        output_csv = "export_chromatogram.csv"
        header = "time_min, MALS_90deg, RI_signal"
        data = np.column_stack([mals_time, mals_chrom.values[:, 4] if mals_chrom.values.shape[1] >= 5 else mals_chrom.values[:, 0], ri_interp])
        np.savetxt(output_csv, data, delimiter=",", header=header, comments="")
        print(f"  Saved: {output_csv}")

    # == 14. Access raw database (advanced) ===============================
    print("\n== DATABASE INFO ==")
    tables = reader.list_populated_tables()
    print(f"  Total populated tables: {len(tables)}")
    print(f"  Key tables:")
    for key_table in ["WExperiment", "WVectorData", "WMatrixData", "WResultData",
                       "WPeakRange", "WHeleos8Profile", "WNGOInstrumentProfile",
                       "WHplcUVDeviceProfile", "WSolventProfile", "WInjectedSampleProfile"]:
        if key_table in tables:
            print(f"    {key_table}: {tables[key_table]} rows")

    print("\n" + "=" * 70)
    print("Done!")

    reader.close()


if __name__ == "__main__":
    main()