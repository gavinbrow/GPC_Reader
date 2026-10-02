import type { Experiment } from '../afe8/types';
import { indexRange, nelderMead, trapz } from './math';
import type { DelayKind, Method, Peak } from './method';
import { firstOrderP } from './ls';
import { process, type Processed } from './pipeline';
import { broaden } from './signal';

/** LS detector closest to 90°. */
export function ls90Id(p: Processed): string | null {
  if (!p.lsIds.length) return null;
  const angles = p.method.ls.angles;
  let best = 0;
  angles.forEach((a, i) => {
    if (Math.abs(a - 90) < Math.abs(angles[best] - 90)) best = i;
  });
  return p.lsIds[Math.min(best, p.lsIds.length - 1)];
}

export function seriesForKind(p: Processed, kind: DelayKind | 'LS'): string | null {
  if (kind === 'LS') return ls90Id(p);
  if (kind === 'RI') return p.series.dRI ? 'dRI' : null;
  if (kind === 'VIS') return p.series.VIS ? 'VIS' : null;
  const id = `UV ${p.method.uvChannel + 1}`;
  return p.series[id] ? id : null;
}

/** Centroid of the part of a peak above `frac` of its maximum. */
function topCentroid(t: ArrayLike<number>, y: ArrayLike<number>, i0: number, i1: number, frac = 0.5): number {
  let max = -Infinity;
  for (let i = i0; i <= i1; i++) if (Number.isFinite(y[i]) && y[i] > max) max = y[i];
  if (!(max > 0)) return NaN;
  let s = 0;
  let w = 0;
  for (let i = i0; i <= i1; i++) {
    const v = y[i];
    if (Number.isFinite(v) && v >= frac * max) {
      s += v * t[i];
      w += v;
    }
  }
  return w > 0 ? s / w : NaN;
}

/**
 * Alignment: interdetector volumes (mL) that bring each detector's peak onto
 * the LS 90° detector, measured on a narrow standard peak.
 */
export function determineDelays(e: Experiment, m: Method, peak: Peak): { delays: Record<DelayKind, number>; centers: Record<string, number> } {
  const base: Method = { ...m, delays: { UV: 0, RI: 0, VIS: 0 }, bandBroadening: { ...m.bandBroadening, enabled: false } };
  const p = process(e, base);
  const [i0, i1] = indexRange(p.t, peak.start, peak.end);
  const centers: Record<string, number> = {};
  const ref = seriesForKind(p, 'LS');
  const tRef = ref ? topCentroid(p.t, p.series[ref].aligned, i0, i1) : NaN;
  if (ref) centers.LS = tRef;
  const delays = { ...m.delays };
  (['UV', 'RI', 'VIS'] as DelayKind[]).forEach((k) => {
    const id = seriesForKind(p, k);
    if (!id) return;
    const tk = topCentroid(p.t, p.series[id].aligned, i0, i1);
    centers[k] = tk;
    if (Number.isFinite(tk) && Number.isFinite(tRef)) delays[k] = (tk - tRef) * m.flowRate;
  });
  return { delays, centers };
}

function normalisedWindow(y: ArrayLike<number>, i0: number, i1: number): Float64Array {
  const out = new Float64Array(i1 - i0 + 1);
  let s = 0;
  for (let i = i0; i <= i1; i++) {
    const v = Number.isFinite(y[i]) ? y[i] : 0;
    out[i - i0] = v;
    s += v;
  }
  if (s !== 0) for (let i = 0; i < out.length; i++) out[i] /= s;
  return out;
}

/**
 * Band broadening: find the Gaussian (instrumental) and exponential (mixing)
 * terms, in µL, which make each upstream detector's peak match the shape of
 * the downstream concentration (RI) peak. A small residual shift is folded
 * into the interdetector volume.
 */
export function determineBandBroadening(
  e: Experiment,
  m: Method,
  peak: Peak,
): { terms: Method['bandBroadening']['terms']; delays: Record<DelayKind, number>; residuals: Record<string, number> } {
  const p = process(e, { ...m, bandBroadening: { ...m.bandBroadening, enabled: false } });
  const refId = seriesForKind(p, 'RI');
  const terms = structuredClone(m.bandBroadening.terms);
  const delays = { ...m.delays };
  const residuals: Record<string, number> = {};
  if (!refId) return { terms, delays, residuals };
  const width = peak.end - peak.start;
  const [i0, i1] = indexRange(p.t, peak.start - 0.25 * width, peak.end + 0.25 * width);
  const ref = normalisedWindow(p.series[refId].aligned, i0, i1);
  const flow = m.flowRate;
  let dLS = 0; // shift found for LS (applied to RI, since LS is the alignment reference)
  (['LS', 'UV', 'VIS'] as const).forEach((k) => {
    const id = seriesForKind(p, k);
    if (!id) return;
    const sig = p.series[id].aligned;
    const shiftOf = k === 'LS' ? 0 : delays[k] / flow;
    const obj = (x: number[]) => {
      const sigma = Math.abs(x[0]);
      const tau = Math.abs(x[1]);
      const delta = x[2];
      const b = broaden(sig, p.dt, sigma, tau);
      // shift by delta (min): value at t comes from t + delta
      const shifted = new Float64Array(b.length);
      const di = delta / p.dt;
      for (let i = 0; i < b.length; i++) {
        const xi = i + di;
        const j = Math.floor(xi);
        const f = xi - j;
        shifted[i] = j >= 0 && j + 1 < b.length ? b[j] * (1 - f) + b[j + 1] * f : 0;
      }
      const w = normalisedWindow(shifted, i0, i1);
      let s = 0;
      for (let i = 0; i < w.length; i++) s += (w[i] - ref[i]) ** 2;
      return s;
    };
    const r = nelderMead(obj, [0.01, 0.02, 0], [0.01, 0.02, 0.01], 600);
    const sigma = Math.abs(r.x[0]);
    const tau = Math.abs(r.x[1]);
    terms[k] = { instrumental: sigma * flow * 1000, mixing: tau * flow * 1000 };
    // Positive delta means the reference is later: the RI sits further downstream.
    if (k === 'LS') {
      dLS = r.x[2];
      delays.RI -= dLS * flow;
    } else delays[k] = (shiftOf + r.x[2] - dLS) * flow;
    residuals[k] = Math.sqrt(r.fx / ref.length) / (Math.max(...ref) || 1);
  });
  return { terms, delays, residuals };
}

/**
 * Normalisation coefficients N_i = (V90/P90) / (V_i/P_i), averaged over the
 * top of an (ideally isotropic) standard peak; P(θ) uses the peak radius.
 */
export function determineNormalization(e: Experiment, m: Method, peak: Peak): number[] {
  const p = process(e, { ...m, ls: { ...m.ls, normalization: m.ls.angles.map(() => 1) } });
  const id90 = ls90Id(p);
  if (!id90) return m.ls.normalization;
  const k90 = p.lsIds.indexOf(id90);
  const [i0, i1] = indexRange(p.t, peak.start, peak.end);
  const v90 = p.series[id90].aligned;
  let max = -Infinity;
  for (let i = i0; i <= i1; i++) if (v90[i] > max) max = v90[i];
  const keep = Math.max(1, Math.min(100, m.normalization.percentToKeep));
  const thr = (1 - keep / 100) * max;
  const P = m.ls.angles.map((a) => firstOrderP(peak.radius, a, p.lambdaSolvent));
  return p.lsIds.map((id, j) => {
    const v = p.series[id].aligned;
    let s90 = 0;
    let sj = 0;
    for (let i = i0; i <= i1; i++) {
      if (!(v90[i] >= thr) || !Number.isFinite(v[i])) continue;
      s90 += v90[i] / P[k90];
      sj += v[i] / P[j];
    }
    return sj !== 0 ? s90 / sj : 1;
  });
}

/** UV extinction coefficient (mL/(mg·cm)) from the RI-derived concentration. */
export function determineUVExtinction(p: Processed, peakIndex: number, channel: number): number {
  const pr = p.peaks[peakIndex];
  const uv = p.series[`UV ${channel + 1}`];
  if (!pr || !uv || p.concSeriesId !== 'dRI') return NaN;
  const area = trapz(p.t, uv.aligned, pr.i0, pr.i1);
  const cArea = trapz(pr.t, pr.c);
  return area / (cArea * p.method.uvCellLength) / 1000;
}

/** dn/dc (mL/g) assuming 100% mass recovery of the injected mass. */
export function determineDndc(p: Processed, peakIndex: number): number {
  const pr = p.peaks[peakIndex];
  const ri = p.series.dRI;
  if (!pr || !ri || !(pr.peak.injectedMass > 0)) return NaN;
  const area = trapz(p.t, ri.aligned, pr.i0, pr.i1) * p.method.riScale * p.method.flowRate;
  return area / pr.peak.injectedMass;
}
