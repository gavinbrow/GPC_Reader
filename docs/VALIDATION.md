# Validation

Run `npm test` to reproduce all of these checks.

## 1. Synthetic ground truth (`tests/synthetic.test.ts`)

The test builds an experiment from first principles:

* eight angles from 22° to 150°
* M from 3×10⁷ down to 3×10⁴ g/mol across the peak
* a PS-like coil, rg = 0.0145 M^0.588 nm
* a Gaussian concentration profile
* Zimm-form scattering
* an optional viscometer with [η] = 0.0141 M^0.7 mL/g

The pipeline recovers the ground truth:

| quantity                          | Zimm           | Debye (deg 2) | Berry (deg 2) |
| --------------------------------- | -------------- | ------------- | ------------- |
| per-slice M, rg                   | exact (< 0.2%) | < 6%          | < 3%          |
| Mn, Mw                            | exact          | < 6%          | < 3%          |
| Mz                                | exact          | (large-coil model error) | (large-coil model error) |
| mass recovery                     | exact          | exact         | exact         |
| conformation slope ν (0.588)      | ±0.05          | n/a           | ±0.05         |
| Mark–Houwink K, a (0.0141, 0.70)  | exact          | –             | –             |

The data are generated with the Zimm equation, so the Debye and Berry
extrapolations carry their usual model error for coils of 50–350 nm. That
behaviour is expected.

A noisy variant checks that **Results Fitting** smooths per-slice noise while
keeping Mw within 5%. It also checks that the cumulative distribution ends at
exactly 1.

## 2. The ASTRA example experiment (`tests/pipeline.test.ts`, `tests/afe8.test.ts`)

The example in `Astra Examples/` is *PS 30 kDa, 5 mg/mL, 50 µL* in THF. It
was collected on a DAWN 8 with an Optilab, a Waters UV detector and a
viscometer, using ASTRA 8.2.2.119.

### Things that match ASTRA exactly

* **Instrument configuration.**
  * angles in the solvent: 27.09° … 144.67°
  * calibration constant 4.881×10⁻⁵ 1/(V cm)
  * wavelength 662.72 nm
  * flow path UV → LS → VS → RI
* **Baselines.** Snap-Y end points reproduce the Y values ASTRA stored, for
  example dRI Y1 = −8.4980×10⁻⁴ and LS 5 Y1 = 0.031600.
* **Peak areas.** ASTRA stores per-detector peak areas; OpenMALS gets the same values.

  | detector | ASTRA      | OpenMALS     |
  | -------- | ---------- | ------------ |
  | dRI      | 3.9660×10⁻⁵ | 3.9664×10⁻⁵ |
  | VIS      | 5.743×10⁻³  | 5.745×10⁻³  |

* **The molar-mass slice plot.** The ASTRA screenshot at slice 2306
  (19.670 min) shows the same scale and pattern of K*c/R(θ) values.

### Physical sanity after calibration

Align, then Normalize. The results are:

| quantity              | OpenMALS              | expectation for PS 30k in THF        |
| --------------------- | --------------------- | ------------------------------------ |
| Mw                    | 26.4 kDa              | ≈ 27–31 kDa (nominal "30 kDa")       |
| Mw/Mn                 | 1.01                  | ≤ 1.05 (narrow standard)             |
| rz                    | 4.4 nm                | ≈ 5 nm, at the MALS detection limit  |
| [η]w                  | 26.8 mL/g             | 19–27 mL/g (Mark–Houwink PS/THF)     |
| Rh (viscometric)      | 4.8 nm                | ≈ 4.5–5 nm                           |
| mass recovery         | 86%                   | 80–100%                              |
| ε(254 nm)             | 1.55 mL/(mg cm)       | ≈ 1.5–2 for polystyrene              |

### A known difference from the numbers stored in this file

ASTRA saved these results in the file: Mw = 15.6 kDa, mass recovery = 171%,
ε(254 nm) = 0.72 mL/(mg·cm).

The stored per-slice concentration is exactly **twice** Δn/(dn/dc) of the
stored dRI data: −1.090×10⁻³ mg/mL against −0.541×10⁻³ at slice 2306. The
same factor 2.00 appears in the calculated mass (428.75 µg against 214.40 µg)
and in the UV extinction coefficients.

OpenMALS uses the dRI data as stored, in refractive index units. That gives
the physically consistent results in the table above. Using twice the dRI
would give 171% recovery and roughly half the expected molar mass for this
standard.

The cause is most likely a refractometer setting in the ASTRA installation
that produced the file. If you need to match such an installation, set
**Configuration → RI data scale** to 2.

ASTRA's stored results are always shown in **Results → Stored ASTRA Results**
next to OpenMALS's current values, so differences stay visible.
