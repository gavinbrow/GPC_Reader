/** Small numeric toolkit (no dependencies). */

export type Num = ArrayLike<number>;

/** Linear interpolation of (xs, ys) at x; xs ascending. Returns NaN outside the range. */
export function interp1(xs: Num, ys: Num, x: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  if (x < xs[0] || x > xs[n - 1]) return NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo];
  const x1 = xs[hi];
  if (x1 === x0) return ys[lo];
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - x0)) / (x1 - x0);
}

/** Resample (xs, ys) at every point of `at` (both ascending), O(n+m). NaN outside range. */
export function resample(xs: Num, ys: Num, at: Num, shift = 0): Float64Array {
  const out = new Float64Array(at.length);
  const n = xs.length;
  let j = 0;
  for (let i = 0; i < at.length; i++) {
    const x = at[i] + shift;
    if (n === 0 || x < xs[0] || x > xs[n - 1]) {
      out[i] = NaN;
      continue;
    }
    while (j < n - 2 && xs[j + 1] < x) j++;
    while (j > 0 && xs[j] > x) j--;
    const x0 = xs[j];
    const x1 = xs[j + 1] ?? x0;
    out[i] = x1 === x0 ? ys[j] : ys[j] + ((ys[j + 1] - ys[j]) * (x - x0)) / (x1 - x0);
  }
  return out;
}

/** Index of the first element >= x in an ascending array. */
export function lowerBound(xs: Num, x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Inclusive index range [i0, i1] of xs within [a, b]. i1 < i0 when empty. */
export function indexRange(xs: Num, a: number, b: number): [number, number] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const i0 = lowerBound(xs, lo);
  let i1 = lowerBound(xs, hi);
  if (i1 >= xs.length || xs[i1] > hi) i1--;
  return [i0, i1];
}

export function median(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

/** Robust noise estimate (standard deviation) from first differences. */
export function noiseSigma(ys: Num, i0 = 0, i1 = ys.length - 1): number {
  const d: number[] = [];
  for (let i = Math.max(1, i0); i <= i1; i++) {
    const v = ys[i] - ys[i - 1];
    if (Number.isFinite(v)) d.push(Math.abs(v));
  }
  return (1.4826 * median(d)) / Math.SQRT2 || 0;
}

/** Trapezoidal integral of ys over xs between indices [i0, i1]. */
export function trapz(xs: Num, ys: Num, i0 = 0, i1 = xs.length - 1): number {
  let s = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    const a = ys[i - 1];
    const b = ys[i];
    if (Number.isFinite(a) && Number.isFinite(b)) s += 0.5 * (a + b) * (xs[i] - xs[i - 1]);
  }
  return s;
}

/** Centred moving average with half-width h (edges use shrinking windows). */
export function movingAverage(ys: Num, h: number): Float64Array {
  const n = ys.length;
  const out = new Float64Array(n);
  if (h <= 0) {
    for (let i = 0; i < n; i++) out[i] = ys[i];
    return out;
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++) {
      if (Number.isFinite(ys[k])) {
        s += ys[k];
        c++;
      }
    }
    out[i] = c ? s / c : NaN;
  }
  return out;
}

export interface LinearFit {
  /** Coefficients, lowest order first: y = p[0] + p[1] x + p[2] x^2 ... */
  p: number[];
  /** Covariance matrix of p. */
  cov: number[][];
  r2: number;
  /** Residual standard deviation. */
  s: number;
  n: number;
}

/** Solve a symmetric positive-definite system via Gauss-Jordan; returns inverse too. */
function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r) => r.slice(n));
}

/**
 * Weighted polynomial least squares. Non-finite points are skipped.
 * x is internally centred/scaled for conditioning; returned coefficients are
 * for the original x.
 */
export function polyfit(xs: Num, ys: Num, degree: number, weights?: Num): LinearFit | null {
  const X: number[] = [];
  const Y: number[] = [];
  const W: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const w = weights ? weights[i] : 1;
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i]) && Number.isFinite(w) && w > 0) {
      X.push(xs[i]);
      Y.push(ys[i]);
      W.push(w);
    }
  }
  const n = X.length;
  const p = degree + 1;
  if (n < p) return null;
  // Normal equations in the raw x (degrees are small and x is O(1) or centred by callers).
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const pw = [1];
    for (let k = 1; k < p; k++) pw.push(pw[k - 1] * X[i]);
    for (let r = 0; r < p; r++) {
      b[r] += W[i] * pw[r] * Y[i];
      for (let c = 0; c < p; c++) A[r][c] += W[i] * pw[r] * pw[c];
    }
  }
  const inv = invert(A);
  if (!inv) return null;
  const coef = inv.map((row) => row.reduce((s, v, k) => s + v * b[k], 0));
  let ssr = 0;
  let sst = 0;
  let wsum = 0;
  let ymean = 0;
  for (let i = 0; i < n; i++) {
    wsum += W[i];
    ymean += W[i] * Y[i];
  }
  ymean /= wsum;
  for (let i = 0; i < n; i++) {
    let f = 0;
    let xp = 1;
    for (let k = 0; k < p; k++) {
      f += coef[k] * xp;
      xp *= X[i];
    }
    ssr += W[i] * (Y[i] - f) ** 2;
    sst += W[i] * (Y[i] - ymean) ** 2;
  }
  const dof = n - p;
  const s2 = dof > 0 ? ssr / dof : 0;
  // For unit weights cov = s2 (X'X)^-1.
  const cov = inv.map((row) => row.map((v) => v * s2));
  return { p: coef, cov, r2: sst > 0 ? 1 - ssr / sst : 1, s: Math.sqrt(s2), n };
}

export function polyval(p: number[], x: number): number {
  let y = 0;
  for (let k = p.length - 1; k >= 0; k--) y = y * x + p[k];
  return y;
}

/** Nelder–Mead simplex minimiser. */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  step: number[],
  maxIter = 400,
  tol = 1e-10,
): { x: number[]; fx: number } {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += step[i];
    pts.push(p);
  }
  let vals = pts.map(f);
  for (let it = 0; it < maxIter; it++) {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) <= tol * (Math.abs(vals[0]) + 1e-30)) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) c[k] += pts[i][k] / n;
    const refl = c.map((v, k) => v + (v - pts[n][k]));
    const fr = f(refl);
    if (fr < vals[0]) {
      const exp = c.map((v, k) => v + 2 * (v - pts[n][k]));
      const fe = f(exp);
      if (fe < fr) {
        pts[n] = exp;
        vals[n] = fe;
      } else {
        pts[n] = refl;
        vals[n] = fr;
      }
    } else if (fr < vals[n - 1]) {
      pts[n] = refl;
      vals[n] = fr;
    } else {
      const con = c.map((v, k) => v + 0.5 * (pts[n][k] - v));
      const fc = f(con);
      if (fc < vals[n]) {
        pts[n] = con;
        vals[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, k) => pts[0][k] + 0.5 * (v - pts[0][k]));
          vals[i] = f(pts[i]);
        }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: pts[best], fx: vals[best] };
}

export function finiteMinMax(ys: Num): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < ys.length; i++) {
    const v = ys[i];
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo, hi];
}

export const AVOGADRO = 6.02214076e23;
