import { AVOGADRO, polyfit, type LinearFit } from './math';
import type { LSModel } from './method';

/**
 * Multi-angle light scattering theory.
 *
 *   K* = 4π² n0² (dn/dc)² / (N_A λ0⁴)
 *   R(θ) = A · N(θ) · ΔV(θ) · n0²       (A = calibration constant, N = normalisation)
 *
 * The n0² factor in R(θ) accounts for the refraction of the scattered light
 * at the flow-cell window (the calibration constant is determined in
 * toluene); it cancels the n0² in K* so molar masses do not depend on the
 * solvent refractive index, while radii do (through λ = λ0 / n0).
 */
export function opticalConstant(n0: number, dndc: number, lambdaNm: number): number {
  const lambdaCm = lambdaNm * 1e-7;
  return (4 * Math.PI ** 2 * n0 ** 2 * dndc ** 2) / (AVOGADRO * lambdaCm ** 4);
}

export interface SliceFit {
  /** sin²(θ/2) of the detectors used */
  x: number[];
  /** Plotted ordinate (Kc/R, R/Kc or sqrt(Kc/R) depending on model) */
  y: number[];
  /** Detector numbers (1-based) corresponding to x/y */
  detectors: number[];
  fit: LinearFit | null;
  M: number;
  Merr: number;
  rg: number; // nm (NaN when the slope gives a negative mean-square radius)
  rgErr: number;
  r2: number;
  model: LSModel;
  degree: number;
  /** Ordinate label for the Debye plot. */
  yLabel: string;
}

const YLABEL: Record<LSModel, string> = {
  Zimm: 'K*c/R(θ)',
  Debye: 'R(θ)/K*c',
  Berry: 'sqrt(K*c/R(θ))',
};

/**
 * Fit one slice.
 * @param R    Rayleigh ratios (cm⁻¹) for each detector
 * @param angles scattering angles in the solvent (degrees)
 * @param enabled detector mask
 * @param c    concentration (g/mL)
 * @param K    optical constant K*
 * @param lambdaSolvent wavelength in the solvent (nm)
 */
export function fitSlice(
  R: ArrayLike<number>,
  angles: number[],
  enabled: boolean[],
  c: number,
  K: number,
  lambdaSolvent: number,
  model: LSModel,
  degree: number,
  a2 = 0,
): SliceFit {
  const x: number[] = [];
  const y: number[] = [];
  const detectors: number[] = [];
  for (let i = 0; i < angles.length; i++) {
    if (!enabled[i]) continue;
    const r = R[i];
    if (!Number.isFinite(r)) continue;
    const xi = Math.sin(((angles[i] * Math.PI) / 180) / 2) ** 2;
    let yi: number;
    if (model === 'Zimm') yi = (K * c) / r;
    else if (model === 'Debye') yi = r / (K * c);
    else {
      const q = (K * c) / r;
      yi = q >= 0 ? Math.sqrt(q) : NaN;
    }
    if (!Number.isFinite(yi)) continue;
    x.push(xi);
    y.push(yi);
    detectors.push(i + 1);
  }
  const deg = Math.max(1, Math.min(degree, x.length - 1));
  const base: SliceFit = { x, y, detectors, fit: null, M: NaN, Merr: NaN, rg: NaN, rgErr: NaN, r2: NaN, model, degree: deg, yLabel: YLABEL[model] };
  if (!(c > 0) || x.length < 2) return base;
  const fit = polyfit(x, y, deg);
  if (!fit) return base;
  const k = (16 * Math.PI ** 2) / (3 * lambdaSolvent ** 2); // nm^-2
  const [a, b] = fit.p;
  const va = fit.cov[0][0];
  const vb = fit.cov[1][1];
  const vab = fit.cov[0][1];

  let M = NaN;
  let dMda = NaN;
  let rg2 = NaN;
  // gradient of rg2 wrt (a, b)
  let ga = NaN;
  let gb = NaN;
  if (model === 'Zimm') {
    const d = a - 2 * a2 * c;
    M = 1 / d;
    dMda = -1 / d ** 2;
    rg2 = (b * M) / k;
    ga = (b * dMda) / k;
    gb = M / k;
  } else if (model === 'Debye') {
    if (a2 !== 0) {
      const disc = 1 - 8 * a2 * c * a;
      M = disc >= 0 ? (1 - Math.sqrt(disc)) / (4 * a2 * c) : NaN;
      dMda = disc > 0 ? 1 / Math.sqrt(disc) : NaN;
    } else {
      M = a;
      dMda = 1;
    }
    const f = M * (1 - 4 * a2 * c * M);
    rg2 = -b / f / k;
    ga = (b / f ** 2 / k) * (1 - 8 * a2 * c * M) * dMda;
    gb = -1 / f / k;
  } else {
    const d = a * a - 2 * a2 * c;
    M = 1 / d;
    dMda = (-2 * a) / d ** 2;
    rg2 = (2 * b) / a / k;
    ga = (-2 * b) / (a * a) / k;
    gb = 2 / a / k;
  }
  const Merr = Math.abs(dMda) * Math.sqrt(Math.max(va, 0));
  const vrg2 = ga * ga * va + gb * gb * vb + 2 * ga * gb * vab;
  const rg = rg2 >= 0 ? Math.sqrt(rg2) : NaN;
  const rgErr = rg > 0 ? Math.sqrt(Math.max(vrg2, 0)) / (2 * rg) : NaN;
  return { ...base, fit, M: M > 0 ? M : NaN, Merr, rg, rgErr, r2: fit.r2 };
}

/** Particle scattering function for a random coil/sphere at first order (used by normalisation). */
export function firstOrderP(rgNm: number, angleDeg: number, lambdaSolvent: number): number {
  const x = Math.sin(((angleDeg * Math.PI) / 180) / 2) ** 2;
  return 1 - ((16 * Math.PI ** 2) / (3 * lambdaSolvent ** 2)) * rgNm ** 2 * x;
}
