import { polyfit, polyval } from './math';
import type { ResultsFit } from './method';

export interface ResultsFitCurve {
  /** Fitted values at every peak slice. */
  values: Float64Array;
  coefficients: number[]; // in powers of (t - t0)
  t0: number;
  r2: number;
  start: number;
  end: number;
  model: ResultsFit['model'];
  order: number;
}

/**
 * ASTRA "Results Fitting": fit log10(y) against elution time with a
 * polynomial (or a straight line for the exponential model), weighting each
 * slice by its concentration, over the chosen time range. The fitted curve
 * replaces the noisy per-slice values in distributions and moments.
 */
export function fitResults(t: Float64Array, y: Float64Array, c: Float64Array, cfg: ResultsFit): ResultsFitCurve | null {
  const start = cfg.start ?? t[0];
  const end = cfg.end ?? t[t.length - 1];
  const order = cfg.model === 'Exponential' ? 1 : Math.max(1, Math.min(9, Math.round(cfg.order)));
  const t0 = 0.5 * (start + end);
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  let cmax = 0;
  for (let i = 0; i < t.length; i++) if (c[i] > cmax) cmax = c[i];
  for (let i = 0; i < t.length; i++) {
    if (t[i] < start || t[i] > end) continue;
    if (!(y[i] > 0) || !(c[i] > 0)) continue;
    xs.push(t[i] - t0);
    ys.push(Math.log10(y[i]));
    ws.push(c[i] / cmax);
  }
  if (xs.length < order + 2) return null;
  const fit = polyfit(xs, ys, order, ws);
  if (!fit) return null;
  const values = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) values[i] = 10 ** polyval(fit.p, t[i] - t0);
  return { values, coefficients: fit.p, t0, r2: fit.r2, start, end, model: cfg.model, order };
}
