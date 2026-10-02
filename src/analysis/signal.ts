import type { Baseline, DespikeLevel } from './method';
import { indexRange, lowerBound, median, movingAverage, noiseSigma, polyfit, type Num } from './math';

const DESPIKE: Record<DespikeLevel, { half: number; k: number }> = {
  Low: { half: 3, k: 6 },
  Normal: { half: 4, k: 4 },
  High: { half: 6, k: 3 },
};

/**
 * Remove isolated spikes (e.g. dust particles in the LS cell) with a Hampel
 * filter: a point further than k robust standard deviations from the median
 * of its neighbourhood is replaced by that median. Chromatographic peaks,
 * which span many samples, are left untouched.
 */
export function despike(values: Num, level: DespikeLevel): Float64Array {
  const { half, k } = DESPIKE[level];
  const n = values.length;
  const out = Float64Array.from(values as ArrayLike<number>);
  const sigmaG = noiseSigma(values);
  const win: number[] = [];
  for (let i = 0; i < n; i++) {
    win.length = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      const v = values[j];
      if (Number.isFinite(v)) win.push(v);
    }
    if (win.length < 3) continue;
    win.sort((a, b) => a - b);
    const m = win.length >> 1;
    const med = win.length % 2 ? win[m] : 0.5 * (win[m - 1] + win[m]);
    for (let j = 0; j < win.length; j++) win[j] = Math.abs(win[j] - med);
    win.sort((a, b) => a - b);
    const mad = 1.4826 * (win.length % 2 ? win[m] : 0.5 * (win[m - 1] + win[m]));
    const thr = k * Math.max(mad, sigmaG);
    if (Math.abs(values[i] - med) > thr) out[i] = med;
  }
  return out;
}

export function baselineAt(b: Baseline, t: number): number {
  if (b.x2 === b.x1) return b.y1;
  return b.y1 + ((b.y2 - b.y1) * (t - b.x1)) / (b.x2 - b.x1);
}

export function subtractBaseline(time: Num, values: Num, b: Baseline | undefined): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] - (b ? baselineAt(b, time[i]) : 0);
  return out;
}

/** Average of the data in a small window around time x (ASTRA "Snap-Y"). */
export function snapY(time: Num, values: Num, x: number, halfWidth = 3): number {
  const i = Math.min(time.length - 1, lowerBound(time, x));
  let s = 0;
  let c = 0;
  for (let j = Math.max(0, i - halfWidth); j <= Math.min(time.length - 1, i + halfWidth); j++) {
    if (Number.isFinite(values[j])) {
      s += values[j];
      c++;
    }
  }
  return c ? s / c : NaN;
}

export function snapBaseline(time: Num, values: Num, b: Baseline): Baseline {
  if (b.style !== 'Snap-Y') return b;
  return { ...b, y1: snapY(time, values, b.x1), y2: snapY(time, values, b.x2) };
}

/** Contiguous regions where the signal departs from its baseline. */
export interface SignalRegion {
  i0: number;
  i1: number;
  area: number;
  height: number;
  apex: number;
}

/**
 * Robust straight-line baseline of a whole trace: iterative fit with
 * rejection of points more than `widthInStd` standard deviations away
 * (ASTRA: "width in std dev" 1.75, 5 passes).
 */
export function robustLine(time: Num, values: Num, i0: number, i1: number, widthInStd = 1.75, passes = 5) {
  const idx: number[] = [];
  for (let i = i0; i <= i1; i++) if (Number.isFinite(values[i])) idx.push(i);
  let keep = idx;
  let p = [median(idx.map((i) => values[i])), 0];
  let sd = 0;
  for (let pass = 0; pass < passes; pass++) {
    const fit = polyfit(
      keep.map((i) => time[i] - time[i0]),
      keep.map((i) => values[i]),
      1,
    );
    if (!fit) break;
    p = fit.p;
    const res = idx.map((i) => values[i] - (p[0] + p[1] * (time[i] - time[i0])));
    sd = 1.4826 * median(res.map(Math.abs));
    keep = idx.filter((_, k) => Math.abs(res[k]) <= widthInStd * sd);
    if (keep.length < 10) break;
  }
  return { at: (t: number) => p[0] + p[1] * (t - time[i0]), sd };
}

/** Find signal regions above the noise in a trace. */
export function findRegions(time: Num, values: Num, opts: { nSigma?: number; minWidth?: number; smooth?: number } = {}): SignalRegion[] {
  const n = values.length;
  if (n < 20) return [];
  const skip = Math.floor(n * 0.02); // ignore the injection artefact at the very beginning
  const line = robustLine(time, values, skip, n - 1);
  const dt = (time[n - 1] - time[0]) / (n - 1);
  const sm = movingAverage(
    Array.from(values, (v, i) => v - line.at(time[i])),
    Math.max(1, Math.round((opts.smooth ?? 0.05) / dt)),
  );
  const noise = Math.max(noiseSigma(sm, skip, n - 1), line.sd / 3, 1e-30);
  const thr = (opts.nSigma ?? 8) * noise;
  const minWidth = opts.minWidth ?? 0.1;
  const regions: SignalRegion[] = [];
  let i = skip;
  while (i < n) {
    if (Math.abs(sm[i]) > thr) {
      const sign = Math.sign(sm[i]);
      let a = i;
      let b = i;
      while (b + 1 < n && sm[b + 1] * sign > thr * 0.5) b++;
      // extend to where the smoothed signal returns to ~1 noise sigma
      while (a > skip && sm[a - 1] * sign > noise) a--;
      while (b + 1 < n && sm[b + 1] * sign > noise) b++;
      if (time[b] - time[a] >= minWidth) {
        let area = 0;
        let height = 0;
        let apex = a;
        for (let k = a; k <= b; k++) {
          area += sm[k] * dt;
          if (Math.abs(sm[k]) > Math.abs(height)) {
            height = sm[k];
            apex = k;
          }
        }
        regions.push({ i0: a, i1: b, area, height, apex });
      }
      i = b + 1;
    } else i++;
  }
  // merge regions separated by tiny gaps
  const merged: SignalRegion[] = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && time[r.i0] - time[last.i1] < minWidth * 0.5) {
      last.i1 = r.i1;
      last.area += r.area;
      if (Math.abs(r.height) > Math.abs(last.height)) {
        last.height = r.height;
        last.apex = r.apex;
      }
    } else merged.push({ ...r });
  }
  return merged;
}

/**
 * Automatic baseline: locate the main positive signal region and place the
 * baseline end points in quiet data on both sides of it, never crossing a
 * neighbouring disturbance. Y values are snapped to the data.
 */
export function autoBaseline(seriesId: string, time: Num, values: Num, near?: [number, number]): Baseline | null {
  const n = time.length;
  if (n < 20) return null;
  const regions = findRegions(time, values);
  if (!regions.length) {
    const b: Baseline = { seriesId, x1: time[Math.floor(n * 0.05)], x2: time[n - 1], y1: 0, y2: 0, style: 'Snap-Y' };
    return snapBaseline(time, values, b);
  }
  let main: SignalRegion;
  if (near) {
    const [a, b] = near;
    const ov = regions.filter((r) => time[r.i1] >= a && time[r.i0] <= b);
    main = (ov.length ? ov : regions).reduce((m, r) => (Math.abs(r.area) > Math.abs(m.area) ? r : m));
  } else {
    main = regions.filter((r) => r.height > 0).reduce((m, r) => (r.area > m.area ? r : m), regions[0]);
  }
  // Merge overlapping-in-time neighbours that are part of the same elution (e.g. shoulders).
  let lo = main.i0;
  let hi = main.i1;
  const width = time[hi] - time[lo];
  const margin = Math.max(1.5, width * 1.5);
  const prev = regions.filter((r) => r.i1 < lo).pop();
  const next = regions.find((r) => r.i0 > hi);
  let x1 = time[lo] - margin;
  let x2 = time[hi] + margin;
  if (prev) x1 = Math.max(x1, 0.5 * (time[prev.i1] + time[lo]));
  if (next) x2 = Math.min(x2, 0.5 * (time[hi] + time[next.i0]));
  x1 = Math.max(x1, time[Math.floor(n * 0.02)]);
  x2 = Math.min(x2, time[n - 1]);
  const b: Baseline = { seriesId, x1, x2, y1: 0, y2: 0, style: 'Snap-Y' };
  return snapBaseline(time, values, b);
}

/**
 * Automatic peak finding on a baseline-subtracted concentration trace:
 * returns [start, end] intervals (minutes).
 */
export function autoPeaks(time: Num, signal: Num, opts: { minWidth?: number; thresholdPct?: number } = {}): [number, number][] {
  const n = time.length;
  if (n < 20) return [];
  const dt = (time[n - 1] - time[0]) / (n - 1);
  const sm = movingAverage(signal, Math.max(1, Math.round(0.03 / dt)));
  const skip = Math.floor(n * 0.02);
  let max = 0;
  for (let i = skip; i < n; i++) if (sm[i] > max) max = sm[i];
  if (max <= 0) return [];
  const noise = noiseSigma(sm, skip, n - 1);
  const thr = Math.max(max * (opts.thresholdPct ?? 5) / 100, 10 * noise);
  const edge = Math.max(max * 0.005, 3 * noise);
  const out: [number, number][] = [];
  let i = skip;
  while (i < n) {
    if (sm[i] > thr) {
      let a = i;
      let b = i;
      while (b + 1 < n && sm[b + 1] > thr) b++;
      while (a > skip && sm[a - 1] > edge) a--;
      while (b + 1 < n && sm[b + 1] > edge) b++;
      if (time[b] - time[a] >= (opts.minWidth ?? 0.25)) out.push([time[a], time[b]]);
      i = b + 1;
    } else i++;
  }
  // merge overlaps
  return out.reduce<[number, number][]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else acc.push([...r]);
    return acc;
  }, []);
}

/** Convolve a uniformly sampled signal with an (unnormalised) causal kernel description. */
export function broaden(values: Num, dt: number, sigma: number, tau: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (!(sigma > 0) && !(tau > 0)) {
    for (let i = 0; i < n; i++) out[i] = values[i];
    return out;
  }
  // Kernel = Gaussian(σ) ⊗ exponential(τ), built on the sample grid.
  const half = Math.ceil((4 * Math.max(sigma, 0) + 8 * Math.max(tau, 0)) / dt) + 1;
  const kernel: number[] = [];
  for (let k = -half; k <= half; k++) {
    const t = k * dt;
    let v: number;
    if (sigma > 0 && tau > 0) {
      // exponentially modified Gaussian (unit area)
      const z = sigma / tau - t / sigma;
      v = (1 / (2 * tau)) * Math.exp(sigma ** 2 / (2 * tau ** 2) - t / tau) * erfc(z / Math.SQRT2);
    } else if (sigma > 0) v = Math.exp(-0.5 * (t / sigma) ** 2);
    else v = t >= 0 ? Math.exp(-t / tau) : 0;
    kernel.push(Number.isFinite(v) ? v : 0);
  }
  const sum = kernel.reduce((a, b) => a + b, 0) || 1;
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let w = 0;
    for (let k = 0; k < kernel.length; k++) {
      const j = i - (k - half);
      if (j < 0 || j >= n) continue;
      const v = values[j];
      if (!Number.isFinite(v)) continue;
      s += kernel[k] * v;
      w += kernel[k];
    }
    out[i] = w > 0 ? s / w : NaN;
  }
  return out;
}

/** Complementary error function (Numerical Recipes erfcc, |error| < 1.2e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

export { indexRange };
