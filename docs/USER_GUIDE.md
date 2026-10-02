# Astra Reader — User Guide

## Overview

Astra Reader is a web-based tool for analyzing GPC/SEC (Gel Permeation
Chromatography / Size Exclusion Chromatography) data from Wyatt ASTRA `.afe8`
files. It computes molar mass, radius of gyration, polydispersity, and
distributions using multi-angle light scattering (MALS), refractive index (RI),
and UV detector data.

## Getting Started

1. Open your web browser to `http://localhost:5173`
2. Click "Upload" or drag-and-drop one or more `.afe8` files
3. Select an experiment from the sidebar to begin analysis

## Interface Layout

The application has three panes:

- **Left sidebar:** Experiment list, file upload, batch upload
- **Center pane:** Plots (chromatogram, molar mass, radius, distributions, etc.)
- **Right pane:** Metadata, peak parameters, analysis procedures, results, reports

### Center Pane Tabs

| Tab | Description |
|---|---|
| Chromatogram | Raw detector signals (MALS, RI, UV) with zoom/pan |
| Molar Mass | M(v) — molar mass vs. elution volume |
| Radius | Rg(v) — radius of gyration vs. elution volume |
| Distribution | Differential and cumulative molar mass distributions |
| Angular Fit | Per-slice angular fit quality (chi-squared) |
| Conformation | log(Rg) vs log(M) conformation plot |
| Mark-Houwink | log([eta]) vs log(M) Mark-Houwink plot |
| Calibration | Column calibration curve |
| Number Density | Number fraction vs molar mass |
| Zimm Plot | Classic Zimm plot (K*c/R vs sin^2(theta/2) + k*c) |
| Report Preview | Live HTML report preview |
| EASI Graph | Overlay multiple experiment chromatograms |

### Right Pane Tabs

| Tab | Description |
|---|---|
| Metadata | Experiment, instrument, solvent, sample info |
| Peaks | Peak selection and per-peak parameters (dn/dc, ls_model, etc.) |
| Analysis | Procedure chain — enable/disable and configure each step |
| Results | Summary table (Mn, Mw, Mz, Pd, Rg, Area, Recovery) |
| Advanced | Conjugate, branching, viscometry, calibration, particle, dn/dc determination, absorption correction, peak statistics |
| Reports | Report designer and quick export (PDF/HTML/CSV/Excel) |
| Batch | Batch upload, batch processing, method templates, EASI table |

## One-Click Analysis

1. Upload an `.afe8` file and select it in the sidebar
2. Click **"One-Click Analysis"** in the header
3. The procedure chain runs automatically (despiking, baseline, alignment,
   normalization, molar mass, moments, distributions)
4. Progress is shown in the header; results auto-refresh on completion

## Setting Baselines

1. Go to the **Chromatogram** tab
2. Use the **Baseline Editor** toolbar to select a detector
3. Choose baseline type: constant, linear, or point-pair
4. Drag the handles on the plot to position the baseline
5. Click **"Auto-Baseline"** for automatic detection

## Selecting Peaks

1. Go to the **Chromatogram** tab
2. Click **"Draw"** mode in the Peak Selector toolbar
3. Drag on the plot to define a peak region
4. Or click **"Auto-Detect"** for automatic peak detection
5. Adjust peak parameters in the **Peaks** right tab

## Per-Peak Parameters

In the **Peaks** right tab:

- **dn/dc:** Specific refractive index increment (mL/g). Typical: 0.05-0.30
- **uv_extinction:** UV molar extinction coefficient
- **concentration:** Sample concentration (g/mL)
- **injected_mass:** Total injected mass (g)
- **ls_model:** Zimm (0), Debye (1), or Berry (2)
- **ls_fit_degree:** 1st or 2nd order angular fit
- **radius_type:** RMS, Rg, or hydrodynamic

## Procedure Chain

The **Analysis** right tab shows the full procedure chain:

1. **Despiking** — median filter, MAD threshold (off/light/medium/heavy)
2. **Baseline** — subtract per-detector baselines
3. **Alignment** — cross-correlation interdetector delay
4. **Normalization** — MALS angle normalization
5. **Physical Units** — convert raw volts to Rayleigh ratio
6. **Band Broadening** — van Cittert deconvolution (disabled by default)
7. **Concentration** — RI/UV to concentration
8. **Molar Mass** — Zimm/Debye/Berry per-slice fit
9. **Moments** — Mn, Mw, Mz, Pd
10. **Peak Areas** — trapezoidal area, recovery fraction
11. **Distributions** — KDE/binned differential and cumulative

Toggle each procedure on/off and adjust parameters inline.

## Saving & Export

### Save .afe8

Click **"Save .afe8"** to export the experiment with all modifications
(baselines, peaks, results, procedures) written back to the file.

### Save As

Click **"Save As"** to create a copy with a new filename. You can choose which
data categories to include (baselines, peaks, results, procedures).

### Reports

In the **Reports** right tab:
- Choose format: PDF, HTML, CSV, or Excel
- Add a title and notes
- Include or exclude per-slice data
- Click "Generate Report" — async generation with progress bar

## Unsaved Changes

An amber "Unsaved changes" indicator appears in the header when you have
modifications that haven't been saved. Click "Save .afe8" to persist changes
and clear the indicator.

## Batch Processing

1. **Batch Upload:** Upload multiple `.afe8` files at once
2. **Batch Processor:** Apply settings (baselines, peaks, procedures) from a
   source experiment to multiple target experiments
3. **Method Templates:** Save current analysis settings as a reusable template
4. **EASI Table:** Compare results across multiple experiments in a table

## Keyboard Shortcuts

- **Tab:** Navigate between UI elements
- **Enter:** Activate selected button/control

## Troubleshooting

### Upload Fails

- Ensure the file is a valid `.afe8` (gzip-compressed SQLite)
- Check file size is under 500 MB
- Rate limit: 10 uploads per minute per IP

### Analysis Results Don't Match ASTRA

- Verify dn/dc is correct for your polymer/solvent system
- Check that the correct fit model is selected (Zimm 1st-order is the default)
- Ensure band broadening is disabled (it can affect results)
- Check baseline placement — a poor baseline affects concentration and molar mass

### No Data in Plots

- Run "One-Click Analysis" first
- Check that the correct peak is selected
- Verify the detector data exists in the `.afe8` file