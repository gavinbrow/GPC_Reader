import type { Experiment, RawSeries } from '../afe8/types';
import { finiteMinMax, indexRange, resample, trapz } from './math';
import type { Baseline, DelayKind, Method, Peak } from './method';
import { fitSlice, opticalConstant, type SliceFit } from './ls';
import { autoBaseline, broaden, despike, snapBaseline, subtractBaseline } from './signal';
import { computeMoments, type Moments } from './moments';
import { fitResults, type ResultsFitCurve } from './resultsFit';
import { computeDistribution, type Distribution } from './distribution';
import { peakStatistics, type PeakStats } from './peakStats';

export interface ProcessedSeries {
  raw: RawSeries;
  /** Despiked data on the native time base. */
  despiked: Float64Array;
  baseline?: Baseline;
  /** Despiked, baseline-subtracted, native time base. */
  corrected: Float64Array;
  /** Corrected data aligned (interdetector delay) and broadened on the slice grid. */
  aligned: Float64Array;
  /** Time shift (min) applied: aligned(t) = corrected(t + shift). */
  shift: number;
}

export interface PeakResult {
  peak: Peak;
  index: number;
  i0: number;
  i1: number;
  /** Slice times within the peak. */
  t: Float64Array;
  /** Concentration (g/mL) per slice. */
  c: Float64Array;
  K: number;
  /** Rayleigh ratios per slice: R[slice][detector] (cm⁻¹). */
  R: Float64Array[];
  M: Float64Array;
  Merr: Float64Array;
  rg: Float64Array;
  rgErr: Float64Array;
  r2: Float64Array;
  massFit: ResultsFitCurve | null;
  radiusFit: ResultsFitCurve | null;
  /** M and rg actually used for moments/distributions (fitted when a fit model is active). */
  Mused: Float64Array;
  rgUsed: Float64Array;
  /** Intrinsic viscosity (mL/g) and hydrodynamic radius (nm) per slice, if a viscometer is present. */
  eta?: Float64Array;
  rh?: Float64Array;
  moments: Moments;
  distribution: Distribution;
  stats: Record<string, PeakStats>;
  /** Whole-peak ("average") fit. */
  average: SliceFit | null;
  warnings: string[];
}

export interface Processed {
  experiment: Experiment;
  method: Method;
  /** Slice grid (min). */
  t: Float64Array;
  dt: number;
  series: Record<string, ProcessedSeries>;
  /** Ids of LS detector series ordered by detector number. */
  lsIds: string[];
  lambdaSolvent: number;
  concSeriesId: string | null;
  peaks: PeakResult[];
  warnings: string[];
}

export function delayKindOf(s: RawSeries): DelayKind | 'LS' | null {
  if (s.kind === 'LS') return 'LS';
  if (s.kind === 'UV') return 'UV';
  if (s.kind === 'RI') return 'RI';
  if (s.kind === 'VIS') return 'VIS';
  return null;
}

/** Fill in auto baselines for analysable series that have none. */
export function completeMethod(e: Experiment, m: Method): Method {
  const baselines = { ...m.baselines };
  let changed = false;
  const lsPeak = m.peaks[0];
  for (const s of e.series) {
    if (!s.analysable || baselines[s.id]) continue;
    const b = autoBaseline(s.id, s.time, despiked(s, m), lsPeak ? [lsPeak.start, lsPeak.end] : undefined);
    if (b) {
      baselines[s.id] = b;
      changed = true;
    }
  }
  return changed ? { ...m, baselines } : m;
}

/** Stage 1: despike (cached per series & despike settings) then baseline subtraction. */
const despikeCache = new WeakMap<RawSeries, Map<string, Float64Array>>();

export function despiked(s: RawSeries, m: Method): Float64Array {
  if (!s.analysable || !m.despike.enabled) return s.values instanceof Float64Array ? s.values : Float64Array.from(s.values);
  const key = m.despike.level;
  let map = despikeCache.get(s);
  if (!map) {
    map = new Map();
    despikeCache.set(s, map);
  }
  let v = map.get(key);
  if (!v) {
    v = despike(s.values, m.despike.level);
    map.set(key, v);
  }
  return v;
}

function stage1(s: RawSeries, m: Method) {
  const d = despiked(s, m);
  let baseline = m.baselines[s.id];
  if (baseline) baseline = snapBaseline(s.time, d, baseline);
  const corrected = s.analysable ? subtractBaseline(s.time, d, baseline) : d;
  return { despiked: d, corrected, baseline };
}

export function sliceGrid(e: Experiment): Float64Array {
  const ls = e.series.find((s) => s.kind === 'LS' && s.detector);
  const ri = e.series.find((s) => s.id === 'dRI');
  const any = e.series.find((s) => s.analysable) ?? e.series[0];
  return (ls ?? ri ?? any)?.time ?? new Float64Array(0);
}

export function process(e: Experiment, m: Method): Processed {
  const warnings: string[] = [];
  const t = sliceGrid(e);
  const n = t.length;
  const dt = n > 1 ? (t[n - 1] - t[0]) / (n - 1) : 1;
  const flow = m.flowRate > 0 ? m.flowRate : 1;

  const series: Record<string, ProcessedSeries> = {};
  for (const s of e.series) {
    const st = stage1(s, m);
    const kind = delayKindOf(s);
    const shift = kind && kind !== 'LS' ? (m.delays[kind] ?? 0) / flow : 0;
    let aligned = resample(s.time, st.corrected, t, shift);
    if (m.bandBroadening.enabled && s.analysable && (kind === 'LS' || kind === 'UV' || kind === 'VIS')) {
      const term = m.bandBroadening.terms[kind];
      const sigma = term.instrumental / 1000 / flow;
      const tau = term.mixing / 1000 / flow;
      if (sigma > 0 || tau > 0) aligned = broaden(aligned, dt, sigma, tau);
    }
    series[s.id] = { raw: s, despiked: st.despiked, corrected: st.corrected, baseline: st.baseline, aligned, shift };
  }

  const lsIds = e.series
    .filter((s) => s.kind === 'LS' && s.detector)
    .sort((a, b) => (a.detector ?? 0) - (b.detector ?? 0))
    .map((s) => s.id);
  const n0 = m.solventRI;
  const lambdaSolvent = m.ls.wavelength / n0;

  const uvId = `UV ${m.uvChannel + 1}`;
  const concSeriesId = m.concentrationSource === 'UV' ? (series[uvId] ? uvId : null) : series.dRI ? 'dRI' : null;
  if (!concSeriesId) warnings.push(`No ${m.concentrationSource} data: concentration cannot be computed.`);

  const peaks: PeakResult[] = [];
  const masses: number[] = [];
  m.peaks.forEach((peak, index) => {
    const pr = processPeak(e, m, t, series, lsIds, lambdaSolvent, concSeriesId, peak, index, flow);
    peaks.push(pr);
    masses.push(pr.moments.mass);
  });
  const totalMass = masses.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0);
  for (const p of peaks) p.moments.massFraction = totalMass > 0 && p.moments.mass > 0 ? (100 * p.moments.mass) / totalMass : NaN;

  return { experiment: e, method: m, t, dt, series, lsIds, lambdaSolvent, concSeriesId, peaks, warnings };
}

/** Concentration (g/mL) on the slice grid for a peak's parameters. */
export function concentrationTrace(m: Method, series: Record<string, ProcessedSeries>, concSeriesId: string | null, peak: Peak): Float64Array | null {
  if (!concSeriesId) return null;
  const s = series[concSeriesId];
  if (!s) return null;
  if (s.raw.kind === 'RI') {
    if (!(peak.dndc > 0)) return null;
    return s.aligned.map((v) => (v * m.riScale) / peak.dndc);
  }
  if (!(peak.uvExtinction > 0)) return null;
  // A = ε l c  with ε in mL/(mg cm) → c in mg/mL → g/mL
  return s.aligned.map((v) => v / (peak.uvExtinction * m.uvCellLength) / 1000);
}

/** Rayleigh ratios of one slice (cm⁻¹). */
export function rayleighRatios(m: Method, series: Record<string, ProcessedSeries>, lsIds: string[], i: number, out?: Float64Array): Float64Array {
  const R = out ?? new Float64Array(lsIds.length);
  const f = m.ls.calibrationConstant * m.solventRI ** 2;
  for (let j = 0; j < lsIds.length; j++) {
    const v = series[lsIds[j]].aligned[i];
    R[j] = f * (m.ls.normalization[j] ?? 1) * v;
  }
  return R;
}

function processPeak(
  _e: Experiment,
  m: Method,
  tAll: Float64Array,
  series: Record<string, ProcessedSeries>,
  lsIds: string[],
  lambdaSolvent: number,
  concSeriesId: string | null,
  peak: Peak,
  index: number,
  flow: number,
): PeakResult {
  const warnings: string[] = [];
  const [i0, i1] = indexRange(tAll, peak.start, peak.end);
  const ns = Math.max(0, i1 - i0 + 1);
  const t = tAll.slice(i0, i1 + 1);
  const cAll = concentrationTrace(m, series, concSeriesId, peak);
  const c = cAll ? cAll.slice(i0, i1 + 1) : new Float64Array(ns).fill(NaN);
  if (!cAll) {
    warnings.push(
      m.concentrationSource === 'RI'
        ? 'dn/dc is not specified for this peak. Molar mass cannot be computed without the concentration.'
        : 'UV extinction coefficient is not specified for this peak. Molar mass cannot be computed without the concentration.',
    );
  }

  // 100% mass recovery: rescale c so that the integrated mass equals the injected mass.
  if (m.hundredPercentRecovery && cAll && peak.injectedMass > 0) {
    const mass = flow * trapz(t, c);
    if (mass > 0) {
      const f = peak.injectedMass / mass;
      for (let k = 0; k < ns; k++) c[k] *= f;
    }
  }

  const K = opticalConstant(m.solventRI, peak.dndc, m.ls.wavelength);
  const R: Float64Array[] = [];
  const M = new Float64Array(ns).fill(NaN);
  const Merr = new Float64Array(ns).fill(NaN);
  const rg = new Float64Array(ns).fill(NaN);
  const rgErr = new Float64Array(ns).fill(NaN);
  const r2 = new Float64Array(ns).fill(NaN);
  const hasLS = lsIds.length > 0;
  if (!hasLS) warnings.push('No light scattering data in this experiment.');
  for (let k = 0; k < ns; k++) {
    const Ri = hasLS ? rayleighRatios(m, series, lsIds, i0 + k) : new Float64Array(0);
    R.push(Ri);
    if (!hasLS) continue;
    const f = fitSlice(Ri, m.ls.angles, m.ls.enabled, c[k], K, lambdaSolvent, peak.lsModel, peak.fitDegree, peak.a2);
    M[k] = f.M;
    Merr[k] = f.Merr;
    rg[k] = f.rg;
    rgErr[k] = f.rgErr;
    r2[k] = f.r2;
  }

  // Whole-peak average fit.
  let average: SliceFit | null = null;
  if (hasLS && ns > 0) {
    const Rsum = new Float64Array(lsIds.length);
    let csum = 0;
    for (let k = 0; k < ns; k++) {
      if (!Number.isFinite(c[k])) continue;
      csum += c[k];
      for (let j = 0; j < lsIds.length; j++) Rsum[j] += R[k][j];
    }
    average = fitSlice(Rsum, m.ls.angles, m.ls.enabled, csum, K, lambdaSolvent, peak.lsModel, peak.fitDegree, 0);
  }

  // Results fitting.
  const mf = m.massFit[peak.id];
  const rf = m.radiusFit[peak.id];
  const massFit = mf && mf.model !== 'None' ? fitResults(t, M, c, mf) : null;
  const radiusFit = rf && rf.model !== 'None' ? fitResults(t, rg, c, rf) : null;
  const Mused = massFit ? massFit.values : M;
  const rgUsed = radiusFit ? radiusFit.values : rg;

  // Viscometry.
  let eta: Float64Array | undefined;
  let rh: Float64Array | undefined;
  const vis = series.VIS;
  if (vis) {
    eta = new Float64Array(ns);
    rh = new Float64Array(ns);
    for (let k = 0; k < ns; k++) {
      const sp = vis.aligned[i0 + k];
      const ck = c[k];
      let v = NaN;
      if (ck > 0 && Number.isFinite(sp)) {
        if (m.viscosity.solomonCiuta && sp > 0) v = Math.sqrt(2 * (sp - Math.log(1 + sp))) / ck;
        else v = sp / ck;
      }
      eta[k] = v;
      const Mk = Mused[k];
      rh[k] = v > 0 && Mk > 0 ? Math.cbrt((3 * v * Mk) / (10 * Math.PI * 6.02214076e23)) * 1e7 : NaN;
    }
  }

  const moments = computeMoments({ t, c, M: Mused, Merr, rg: rgUsed, rgErr, eta, rh, flow, peak, average });
  const distribution = computeDistribution(t, c, Mused, rgUsed, !!massFit);

  const stats: Record<string, PeakStats> = {};
  for (const id of Object.keys(series)) {
    const s = series[id];
    if (!s.raw.analysable) continue;
    stats[id] = peakStatistics(tAll, s.aligned, i0, i1, flow);
  }

  if (cAll) {
    const [, cmax] = finiteMinMax(c);
    if (!(cmax > 0)) warnings.push('The concentration is not positive anywhere in this peak.');
  }

  return {
    peak,
    index,
    i0,
    i1,
    t,
    c,
    K,
    R,
    M,
    Merr,
    rg,
    rgErr,
    r2,
    massFit,
    radiusFit,
    Mused,
    rgUsed,
    eta,
    rh,
    moments,
    distribution,
    stats,
    average,
    warnings,
  };
}

/** Detailed fit of one slice (for the Molar Mass & Radius view). */
export function sliceFitAt(p: Processed, peakIndex: number, sliceIndex: number): { fit: SliceFit; c: number; t: number } | null {
  const pr = p.peaks[peakIndex];
  if (!pr || !p.lsIds.length) return null;
  const k = Math.max(0, Math.min(pr.t.length - 1, sliceIndex - pr.i0));
  const fit = fitSlice(pr.R[k], p.method.ls.angles, p.method.ls.enabled, pr.c[k], pr.K, p.lambdaSolvent, pr.peak.lsModel, pr.peak.fitDegree, pr.peak.a2);
  return { fit, c: pr.c[k], t: pr.t[k] };
}
