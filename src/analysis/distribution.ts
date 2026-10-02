export interface DistributionCurve {
  /** Abscissa (molar mass g/mol or radius nm), ascending. */
  x: Float64Array;
  /** Cumulative weight fraction W(x) in [0, 1]. */
  cumulative: Float64Array;
  /** Differential weight fraction dW/dx (linear). */
  differential: Float64Array;
  /** Differential weight fraction dW/dlog10(x). */
  differentialLog: Float64Array;
}

export interface Distribution {
  mass: DistributionCurve | null;
  radius: DistributionCurve | null;
}

/**
 * Weight-fraction distributions. With monotonic (fitted) data each slice maps
 * to one abscissa value and dW/dlogM = w / |dlogM/dt| is evaluated directly;
 * with raw, noisy data a concentration-weighted histogram in log space is
 * used instead.
 */
export function distributionOf(t: Float64Array, c: Float64Array, y: Float64Array, smooth: boolean): DistributionCurve | null {
  const pts: { x: number; w: number; t: number }[] = [];
  for (let i = 0; i < t.length; i++) if (c[i] > 0 && y[i] > 0 && Number.isFinite(y[i])) pts.push({ x: y[i], w: c[i], t: t[i] });
  if (pts.length < 3) return null;
  if (smooth) {
    // Each slice carries the weight fraction w = cΔt / Σ cΔt and maps to one
    // abscissa value; dW/dlog x = c / (Σ cΔt) / |dlog x/dt|.
    const m = pts.length;
    const dtArr = pts.map((_, i) => {
      const a = Math.max(0, i - 1);
      const b = Math.min(m - 1, i + 1);
      return (pts[b].t - pts[a].t) / (b - a);
    });
    const norm = pts.reduce((s, p, i) => s + p.w * dtArr[i], 0);
    const lx = pts.map((p) => Math.log10(p.x));
    const order = pts.map((_, i) => i).sort((i, j) => pts[i].x - pts[j].x);
    const x = new Float64Array(m);
    const cum = new Float64Array(m);
    const dlog = new Float64Array(m);
    const dlin = new Float64Array(m);
    let acc = 0;
    order.forEach((i, k) => {
      const a = Math.max(0, i - 1);
      const b = Math.min(m - 1, i + 1);
      const slope = Math.abs((lx[b] - lx[a]) / (pts[b].t - pts[a].t));
      acc += (pts[i].w * dtArr[i]) / norm;
      x[k] = pts[i].x;
      cum[k] = acc;
      dlog[k] = slope > 0 ? pts[i].w / norm / slope : NaN;
      dlin[k] = dlog[k] / (pts[i].x * Math.LN10);
    });
    return { x, cumulative: cum, differential: dlin, differentialLog: dlog };
  }
  // Histogram in log space.
  const total = pts.reduce((a, p) => a + p.w, 0);
  const lx = pts.map((p) => Math.log10(p.x));
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of lx) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 1e-6) hi = lo + 0.1;
  const nb = Math.max(10, Math.min(80, Math.round(Math.sqrt(pts.length) * 2)));
  const bw = (hi - lo) / nb;
  const hist = new Float64Array(nb);
  lx.forEach((v, i) => {
    const b = Math.min(nb - 1, Math.max(0, Math.floor((v - lo) / bw)));
    hist[b] += pts[i].w / total;
  });
  const x = new Float64Array(nb);
  const cum = new Float64Array(nb);
  const dlog = new Float64Array(nb);
  const dlin = new Float64Array(nb);
  let acc = 0;
  for (let b = 0; b < nb; b++) {
    const lc = lo + (b + 0.5) * bw;
    x[b] = 10 ** lc;
    acc += hist[b];
    cum[b] = acc;
    dlog[b] = hist[b] / bw;
    dlin[b] = dlog[b] / (x[b] * Math.LN10);
  }
  return { x, cumulative: cum, differential: dlin, differentialLog: dlog };
}

export function computeDistribution(t: Float64Array, c: Float64Array, M: Float64Array, rg: Float64Array, smooth: boolean): Distribution {
  return { mass: distributionOf(t, c, M, smooth), radius: distributionOf(t, c, rg, smooth) };
}

/** Weight percent of a distribution between x1 and x2 (inclusive), plus below/above. */
export function rangeFractions(d: DistributionCurve, x1: number, x2: number) {
  const at = (x: number) => {
    if (x <= d.x[0]) return 0;
    if (x >= d.x[d.x.length - 1]) return 1;
    let i = 1;
    while (i < d.x.length && d.x[i] < x) i++;
    const f = (x - d.x[i - 1]) / (d.x[i] - d.x[i - 1]);
    return d.cumulative[i - 1] + f * (d.cumulative[i] - d.cumulative[i - 1]);
  };
  const lo = at(Math.min(x1, x2));
  const hi = at(Math.max(x1, x2));
  return { below: 100 * lo, within: 100 * (hi - lo), above: 100 * (1 - hi) };
}
