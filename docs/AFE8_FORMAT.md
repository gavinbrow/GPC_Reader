# The ASTRA `.afe8` experiment format

This is what OpenMALS knows about Wyatt ASTRA 7/8 experiment files. It was
worked out from real files, mainly the sample in `Astra Examples/`, which came from ASTRA 8.2.2.119
with a DAWN 8, an Optilab, a Waters UV detector and a viscometer on a DAWN
auxiliary input. The implementation is in `src/afe8/`.

## Container

An `.afe8` file is a **gzip-compressed SQLite 3 database**. It decompresses to
about 1.8 MB for a 50-minute run and contains about 150 tables. Each object type
has its own table, named after its C++ class (`WExperiment`, `WHeleos8Profile`,
`WPeakRange`, …). Every table has the columns `timestamp`, `groupID`,
`objectID` (a GUID string), `version` and `checkSum`.

## BLOB encoding

Every array-valued column is a BLOB with a 16-byte header:

| offset | type | meaning                                                   |
| -----: | ---- | --------------------------------------------------------- |
|      0 | u32  | total BLOB size in bytes, header included                 |
|      4 | u32  | checksum (non-zero only for compressed payloads)          |
|      8 | u32  | payload size after decompression                          |
|     12 | u32  | payload size after decompression (repeated)               |

The payload follows. Large payloads are zlib streams starting with `0x78 0x9c`;
small ones are stored as is. The element type depends on the column:

* Signal and index arrays hold little-endian float64 values. A few
  matrices (UV) hold float32. Infer the element size as
  `payloadSize / (rows × columns)`; the `m_bTrueDouble` flag is not reliable.
* Booleans (`m_vPeakEnabled`, `m_vDetectorEnabled`) are one byte each.
* Integers (`m_vPeakNumber`, `m_vDetectorNumber`) are int32.
* GUID lists (`primaryDataIDs`, `objectIDs`) are 16-byte Windows GUID structs.
* String lists (`m_vClassNames`) are a single string separated by U+8779 (蝹).

## Signals

Time series are stored in two tables:

* **`WVectorData`**: one row per 1-D signal. The time axis is `m_vIndex`, the
  values are `m_vValue`, and `m_sInstrumentClassName` names the instrument
  profile.
* **`WMatrixData`**: multi-channel signals. Time is in `m_vIndex`, the channel
  numbers are in `m_vColumnIndex`, and `m_vvValue` holds the values
  row-major (time × channel). `m_vvValueR` is the row count.

If `m_bEvenlySpacedIndex` is set, the time axis is `m_dIndexStart` +
k·`m_dIndexSpacing` instead. Every instrument has its own time base. The DAWN
records every ~0.51 s, the Optilab every ~0.53 s and the HPLC UV every 5 s.

`m_nDataName` identifies the signal:

| code  | table  | instrument | meaning                                                   |
| ----- | ------ | ---------- | --------------------------------------------------------- |
| 12022 | matrix | LS         | LS detector voltages (V), columns = detector numbers       |
| 12021 | matrix | LS         | LS auxiliary analog inputs (V), columns = AUX channel 1…4  |
| 12018 | vector | LS         | laser monitor                                             |
| 12305 | vector | LS         | forward monitor ("FM")                                    |
| 12303 | vector | LS         | laser current                                             |
| 12395 | vector | LS         | laser voltage                                             |
| 12306 | vector | LS         | laser temperature (°C)                                    |
| 12307 | vector | LS         | cell temperature (°C)                                     |
| 12025 | vector | RI         | differential refractive index (RIU)                       |
| 12489 | vector | RI         | absolute refractive index of the eluent                   |
| 12021 | vector | RI         | raw instrument voltage                                    |
| 12190 | vector | RI         | RI cell temperature (°C)                                  |
| 12110 | matrix | UV         | absorbance (AU), columns = UV channel 1…n (float32)        |
| 12112 | vector | VIS        | specific viscosity (native viscometers)                    |
| 12581 | vector | HPLC       | pump ripple (%)                                           |
| 12583 | vector | HPLC       | pressure (bar)                                            |
| 12585 | vector | HPLC       | flow rate (mL/min)                                        |
| 12485 | vector | any        | empty placeholder                                         |

A viscometer connected to a DAWN auxiliary input does not get a vector of its
own. `WAuxConnectionProfile` says which AUX column carries it, and its
`m_dCalibrationConstant` turns volts into specific viscosity. In the sample the
viscometer is AUX 2 with a constant of 1.0.

## Instruments and configuration

| table                             | content                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `WExperimentConfigurationProfile` | configuration name (e.g. `HPLC+LS+VS+RI`)                  |
| `WHeleos8Profile` / `WHeleosNeonProfile` / `WMiniDawnProfile` / `WTreosProfile` | MALS instrument (see below) |
| `WNGOInstrumentProfile` / `WOptilab…Profile` | refractometer: name, `m_dWavelength`, `m_dCalibrationConstant`, temperature |
| `WHplcUVDeviceProfile`            | UV detector: `cellLength` (cm), `activeChannel`, `numberUVChannels` |
| `WGenericViscometerProfile`       | viscometer                                                 |
| `WFluidConnectionProfile`         | flow path: source → destination with `m_dInterdetectorVolume` (mL) |
| `WSolventProfile`                 | solvent name and refractive index / viscosity models       |
| `WInjectedSampleProfile`          | sample: dn/dc, A2, UV extinction, concentration (g/mL), Mark–Houwink |
| `WBasicCollectionProcedure`       | operator, duration, collection interval, injection volume (µL), vial, pump flow rate |

### MALS profile

The MALS profile tables (`WHeleos8Profile` and the others above) have these
columns:

* `m_dWavelength` (nm), `m_dCalibrationConstant` (1/(V·cm)), `m_dTemperature`
* `m_vDetectorAngles`: the nominal angles, one per detector. The array can
  have one spare trailing entry.
* `m_vNormalizationCoefficients`

The angles in the solvent are stored separately, in
`WDetermineMassAndRadiusFromLSProcedure.m_vDetectorAngle`, together with
`m_vDetectorEnabled`. These are the angles ASTRA actually uses. They follow
`cos θₛ = k · cos θ_nominal`, where the constant `k` depends on the solvent
(1.0498 for THF in the sample).

### Solvent refractive index

With `m_nRefractiveIndexModel = 9`, `m_vRefractiveIndexModelParameters` holds
`[n₀, B, C, D, dn/dT, T₀]`. These describe a Cauchy dispersion around the
reference wavelength `m_dReferenceWavelength`:

    n(λ, T) = n₀ + B (1/λ² − 1/λ₀²) + C (1/λ⁴ − 1/λ₀⁴) − dn/dT (T − T₀)      (λ in µm)

## Processing state

| table                                 | content                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `WBaseline`                           | one row per signal: `m_sSeriesName`, `m_nBaselineType` (2 = manual X, auto Y "Snap-Y"), `m_dX1`, `m_dX2`, `m_dY1`, `m_dY2` |
| `WPeakRange`                          | `rangeNumber` (−1 = template), `rangeName`, `rangeStart`, `rangeEnd`, `m_dDNDC`, `m_dA2`, `m_dUVExtinctionCoefficient`, `m_dConcentration` (g/mL), `m_dInjectedMass` (g), `m_nLSModel` (0 Zimm, 1 Debye, 2 Berry), `m_nLSFitDegree`, `m_dRadius` (nm) |
| `WDespikingProcedure`                 | `m_eDespikingLevel`                                                        |
| `WConvertToConcentrationProcedure`    | `m_sConcentrationSource` ("RI" / "UV")                                     |
| `WNormalizationProcedure`             | `m_nNormalizationPeak`, `m_dPercentToKeep`                                 |
| `WDetermineDistributionsAndMomentsProcedure`, `WFitMassOrRadiusProcedure`, `WDistributionAnalysisProcedure` | settings of the corresponding procedures |
| `W…Procedure.m_bHasBeenRun`           | whether the procedure ran                                                  |

`WBaseline` names its series like this:

* `detector N` for LS detector N
* `channel N` for UV channel N
* `differential refractive index data` for dRI
* `Specific Viscosity Data` for the viscometer

## Stored results

`WResultData` holds the results of ASTRA's last processing run. Each row has a
code (`m_nDataName`), a peak (`m_nPeak`), an instrument class, `m_dValue` and
`m_dHighUncertainty`. These codes are confirmed:

| code  | meaning                         | code  | meaning                      |
| ----- | ------------------------------- | ----- | ---------------------------- |
| 12120 | Mn                              | 12123 | rn (nm)                      |
| 12121 | Mw                              | 12124 | rw (nm)                      |
| 12122 | Mz                              | 12125 | rz (nm)                      |
| 12403 | Mz+1                            | 12161 | Mw/Mn                        |
| 12343 | Mp                              | 12162 | Mz/Mn                        |
| 12345 | Mv                              | 2130  | calculated mass (µg)         |
| 2370  | mass recovery (%)               | 2371  | mass fraction (%)            |
| 2259  | peak area (signal·min)          | 2382  | peak height                  |
| 2383  | retention time at maximum (min) | 2410  | peak centroid (min)          |
| 12472 | theoretical plates              | 12558 | width at half height (min)   |
| 12054 | UV extinction ch 1 (mL/(mg cm)) | 12566 | UV extinction ch 2           |

The experiment log (`WLogEntry`) records every user action. Its `data` column
holds XML describing the change, for example new baseline end points.

## Writing

OpenMALS opens files read-only. Each object carries a `checkSum`, and files can
also hold 21 CFR Part 11 signatures (`signatureIDs`). For both reasons,
round-tripping edits back into `.afe8` is deliberately not attempted. The
processing parameters can be saved as an OpenMALS method file (JSON) instead.
