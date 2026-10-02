# MALS Fitting Theory

This document describes the mathematical foundations of the multi-angle light
scattering (MALS) fitting algorithms used in Astra Reader. It is intended as a
"bus factor" mitigation — ensuring the theory is documented separately from the
code.

## The Rayleigh Scattering Equation

When light passes through a solution of macromolecules, the excess scattering
at angle theta is described by the Rayleigh ratio R(theta):

    R(theta) = I(theta) * r^2 / (I_0 * V)

where I(theta) is the scattered intensity at angle theta, r is the distance to
the detector, I_0 is the incident intensity, and V is the scattering volume.

## The Optical Constant K

The optical constant K relates the measured Rayleigh ratio to the molar mass
and concentration:

    K = 4 * pi^2 * n_0^2 * (dn/dc)^2 / (N_A * lambda_0^4)

where:
- n_0 is the solvent refractive index
- dn/dc is the specific refractive index increment (mL/g)
- N_A is Avogadro's number (6.022 × 10^23 mol^-1)
- lambda_0 is the laser wavelength in vacuum (cm)

For UV-based concentration, replace (dn/dc)^2 with epsilon^2 (the molar
extinction coefficient, path-length-corrected).

## The Three Fit Models

### Zimm Model (fit_model = 0)

The Zimm equation is the most commonly used model:

    K*c / R(theta) = (1/M) * (1 + (16*pi^2 / (3*lambda_sol^2)) * <Rg^2> * sin^2(theta/2)) + 2*A2*c

With A2 = 0 (negligible at low concentrations used in GPC/SEC):

    y = a + b*x

where:
- y = K*c/R(theta)
- x = sin^2(theta/2)
- a = 1/M (intercept → M = 1/a)
- b = (16*pi^2 / (3*lambda_sol^2)) * Rg^2 / M (slope → Rg = sqrt(b*M * 3*lambda_sol^2 / (16*pi^2)))

### Debye Model (fit_model = 1)

The Debye model is the first-order expansion of the form factor P(theta):

    R(theta) / (K*c) = M * (1 - (16*pi^2 / (3*lambda_sol^2)) * <Rg^2> * sin^2(theta/2)) - 2*A2*c*M^2

With A2 = 0:

    y = a + b*x

where:
- y = R(theta)/(K*c)
- a = M (intercept → M = a)
- b = -M * (16*pi^2 / (3*lambda_sol^2)) * Rg^2 (slope is negative → Rg = sqrt((-b/a) * 3*lambda_sol^2 / (16*pi^2)))

The Debye approximation is valid for small particles (Rg < lambda/20).

### Berry Model (fit_model = 2)

The Berry model uses a square-root form that is more robust for large
particles:

    sqrt(K*c / R(theta)) = (1/sqrt(M)) * (1 + (8*pi^2 / (3*lambda_sol^2)) * <Rg^2> * sin^2(theta/2)) + A2*c*sqrt(M)

With A2 = 0:

    y = a + b*x

where:
- y = sqrt(K*c/R(theta))
- a = 1/sqrt(M) (intercept → M = 1/a^2)
- b = (8*pi^2 / (3*lambda_sol^2)) * Rg^2 / sqrt(M) (→ Rg = sqrt((b/a) * 3*lambda_sol^2 / (8*pi^2)))

## Wavelength in Solution

The angular term uses the wavelength **in solution**:

    lambda_sol = lambda_0 / n_0

For a DAWN 8 at 662.72 nm in THF (n_0 = 1.401):

    lambda_sol = 662.72 / 1.401 ≈ 473 nm

## Fit Degree

All three models support 1st-order (linear) and 2nd-order (quadratic) fits:

- **1st-order:** y = a + b*x (2 parameters, minimum 2 angles)
- **2nd-order:** y = a + b*x + c*x^2 (3 parameters, minimum 3 angles)

The 2nd-order coefficient c captures curvature / non-ideality. M is always
taken from the intercept a; Rg is always taken from the linear coefficient b.

## Angle Selection

Not all detector angles produce reliable data — extreme low and high angles
may be noisy or systematically deviating. Astra Reader uses an iterative
leave-one-out residual test at the peak center:

1. Fit all angles with a Zimm 1st-order model
2. For each angle, remove it and refit; compute the RMS residual
3. If removing an angle improves the RMS by more than 20% (ratio < 0.8), drop it
4. Repeat up to 3 times, keeping at least 5 angles

The selected angle mask is then applied to all slices for consistency.

## Condition Number Guard

Before each fit, the condition number of the design matrix is checked:

    cond(X) = sigma_max / sigma_min

If cond(X) > 10^10, the fit is numerically unstable and NaN is returned. This
prevents propagating garbage through the moments calculation.

## Per-Slice Molar Mass

For each slice ( time point ) within a peak:

1. Get R(theta) at each kept angle for this slice
2. Get concentration c at this slice
3. Compute y = K*c/R (Zimm) or R/(K*c) (Debye) or sqrt(K*c/R) (Berry)
4. Linear (or quadratic) fit of y vs x = sin^2(theta/2)
5. Extract M from intercept, Rg from slope

Slices with c <= 0 or non-finite values are skipped.

## Moments

From the per-slice M(v) and c(v):

- **Mn** = sum(c_i) / sum(c_i / M_i) — number-average
- **Mw** = sum(c_i * M_i) / sum(c_i) — weight-average
- **Mz** = sum(c_i * M_i^2) / sum(c_i * M_i) — z-average
- **Pd** = Mw / Mn — polydispersity

Slices with NaN M or c <= 0 are skipped.

## Second Virial Coefficient (A2)

### Online A2

In a GPC/SEC run, concentration varies across the peak, providing the spread
in c needed for a global fit. A 2-variable linear fit across all slices and
angles:

    K*c_i / R(theta_j, i) = a + b * sin^2(theta_j/2) + d * c_i

where d = 2*A2, a = 1/Mw, and b relates to Rg.

### Batch A2

From multiple injections at different concentrations:

    K*c / R(0) = 1/Mw + 2*A2*c

A linear fit of y = K*c/R(0) vs x = c gives:
- A2 = slope / 2
- Mw = 1 / intercept

## Absorption Correction

When a sample absorbs at the laser wavelength, the MALS signal is attenuated.
The forward monitor measures transmittance T:

    T(slice) = FM(slice) / FM_baseline

The corrected molar mass:

    M_corrected = M_uncorrected * T

Since M ~ 1/R and absorption reduces R by factor T, the uncorrected M is
overestimated by 1/T. The correction brings M back to its true value.

## References

1. Zimm, B.H. (1948). J. Chem. Phys. 16, 1093-1099.
2. Debye, P. (1947). J. Phys. Colloid Chem. 51, 18-32.
3. Berry, G.C. (1966). J. Polym. Sci. A-2 4, 1625-1643.
4. Wyatt, P.J. (1993). Anal. Chim. Acta 272, 1-40.
5. Wyatt Technology Corporation. ASTRA Software User's Guide.