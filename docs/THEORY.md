# Theory and algorithms

This document covers the equations and numerical choices behind every
procedure. The code lives in `src/analysis/`.

## Slices and signals

All signals are placed on one slice grid: the light-scattering time base, or
the dRI time base when there is no LS detector. For every analysable signal,
the processing chain is:

1. **Despiking** (`signal.ts`). A Hampel filter replaces any point that
   lies more than *k* robust standard deviations from the median of a ±*h*
   window with that median. Low uses h = 3, k = 6; Normal uses h = 4, k = 4;
   High uses h = 6, k = 3. The noise floor is the larger of the local MAD and
   the global first-difference noise.
2. **Baseline subtraction.** A straight line through (X1, Y1)–(X2, Y2) is
   subtracted. In *Snap-Y* style, Y1 and Y2 are the mean of the data in
   ±3 samples around X1 and X2. *Autofind* fits a robust line (1.75 σ
   rejection, 5 passes), finds the main signal region, and places the end
   points in quiet data on both sides without crossing neighbouring
   disturbances.
3. **Alignment.** A detector with interdetector volume *V* (mL, positive
   downstream of LS) at flow rate *F* is read at `t + V/F`. *Align* matches
   the centroid of the top half of each detector's peak to the LS 90°
   detector.
4. **Band broadening.** Detectors upstream of the concentration detector are
   convolved with an exponentially modified Gaussian:
   σ = instrumental term / F and τ = mixing term / F (terms in µL).
   *Determine* fits σ, τ and a residual shift by minimising the squared
   difference between each normalised upstream peak and the dRI peak
   (Nelder–Mead).

## Concentration

* RI: `c = Δn / (dn/dc)`, where Δn is the dRI signal times the RI data scale
  (1 by default).
* UV: `c = A / (ε · l)`, with ε in mL/(mg·cm) and l the cell length in cm.
* Optional 100% mass recovery: c is rescaled so that `F ∫ c dt` equals the
  injected mass.

## Light scattering

    R(θ) = A · N(θ) · ΔV(θ) · n₀²            Rayleigh ratio (cm⁻¹)
    K*   = 4π² n₀² (dn/dc)² / (N_A λ₀⁴)

* *A* is the calibration constant.
* *N* is the normalization coefficient (1 for the 90° detector).
* The n₀² factor corrects for refraction at the flow-cell wall.

Because of that n₀² factor, molar masses do not depend on the solvent index,
but radii do, through λ = λ₀/n₀.

Each slice is fitted as a polynomial of degree 1–3 in x = sin²(θ/2). With
k = 16π²/(3λ²):

| model | ordinate y   | M from intercept a        | ⟨r²⟩ from slope b              |
| ----- | ------------ | ------------------------- | ------------------------------ |
| Zimm  | K*c/R        | 1/(a − 2A₂c)              | b·M/k                          |
| Debye | R/(K*c)      | root of a = M − 2A₂cM²    | −b/(k·M(1 − 4A₂cM))            |
| Berry | √(K*c/R)     | 1/(a² − 2A₂c)             | 2b/(a·k)                       |

Uncertainties of M and r come from the least-squares covariance, scaled by the
residual variance and propagated through the expressions above. A negative
⟨r²⟩ is reported as "n/a".

The **average** fit ("M (avg)", "r (avg)") applies the same fit to the sum of
R(θ) and c over the whole peak.

### Normalization

    N_i = Σ(V₉₀ / P₉₀) / Σ(V_i / P_i)

The sums run over the top *percent-to-keep* of the standard peak, with
`P(θ) = 1 − k r² sin²(θ/2)` for the radius entered on the peak.

### Detector angles

The angles in the solvent are read from the file (ASTRA stores them in the LS
procedure). They can be edited in Configuration.

## Moments

The sums run over the slices in the peak where c > 0 and M > 0:

    Mn = Σc / Σ(c/M)        Mw = ΣcM / Σc
    Mz = ΣcM² / ΣcM         Mz+1 = ΣcM³ / ΣcM²
    Mp = M at the concentration maximum
    Mv = (ΣcM^a / Σc)^(1/a)    (when a Mark–Houwink exponent is given)

The rms radius moments average ⟨r²⟩:

    rn² = Σ(c/M)r² / Σ(c/M)    rw² = Σcr² / Σc    rz² = ΣcMr² / ΣcM

* Uncertainties propagate the per-slice uncertainties.
* Calculated mass = `F ∫ c dt`; recovery = calculated / injected mass.
* Mass fraction is each peak's share of the total mass in all peaks.

## Results fitting

`log10 y` (molar mass or rms radius) is fitted against time with a
concentration-weighted polynomial of order 1–9. *Exponential* is a straight
line in log space. The fitted values replace the per-slice values in the
moments and distributions.

## Distributions

* **Fitted (monotonic) data.** Each slice carries the weight fraction
  `w = cΔt / ΣcΔt`, and `dW/dlog M = c / (ΣcΔt) / |dlog M/dt|`.
* **Raw data.** A concentration-weighted histogram in log M is used instead.
* **Linear axis.** `dW/dM = (dW/dlog M) / (M ln 10)`.
* **Ranges.** Ranges report the weight percent below, inside and above the
  range, plus the moments within it.

## Viscometry

Specific viscosity comes from the viscometer signal (an LS auxiliary input
times its calibration constant).

* `[η] = η_sp/c`, or the Solomon–Ciuta form `[η] = √(2(η_sp − ln(1 + η_sp)))/c`.
* `R_h = (3[η]M / (10π N_A))^(1/3)`.
* Mark–Houwink K and a, and the conformation slope ν (rg ∝ M^ν), come from
  concentration-weighted log–log fits over the slices above 10% of the peak
  maximum. They are only reported when log M spans at least 0.3 decades.

## Peak statistics

Each baseline-corrected, aligned signal inside the peak limits gives:

* retention time and volume at the maximum, height, area
* centroid and σ (first and second moments)
* widths at 50%, 10% and 5% of the height
* plates `N = 5.545 (t_R/W½)²`
* asymmetry (b/a at 10%) and USP tailing ((a+b)/2a at 5%)
