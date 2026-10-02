/**
 * Pure tick generation / formatting helpers (ASTRA style).
 */

export interface TickResult {
  /** Major tick positions (ascending), all within [min, max]. */
  ticks: number[];
  /** Tick spacing (0 for pure decade log ticks). */
  step: number;
  /** Minor tick positions (ascending), never coinciding with a major tick. */
  minor: number[];
}

export interface LogTickResult extends TickResult {
  /**
   * True when the range is too narrow for decade labels and the ticks are
   * plain linear ticks (label with formatTick(v, step) instead of formatLogTick).
   */
  linear: boolean;
}

/** A tick label; when `exponent` is set draw it raised after the mantissa ("1.0x10" + "5"). */
export interface TickLabel {
  mantissa: string;
  exponent?: string;
}

/** Clean up floating-point noise (0.30000000000000004 -> 0.3). */
function clean(v: number): number {
  return Number(v.toPrecision(12));
}

/**
 * "Nice" tick positions (1, 2, 5 x 10^k steps) covering [min, max] with at most
 * `maxTicks` major ticks.
 */
export function niceTicks(min: number, max: number, maxTicks: number): TickResult {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [], step: 1, minor: [] };
  if (min > max) [min, max] = [max, min];
  const range = max - min;
  if (!(range > 0) || range < Math.abs(max) * 1e-14) {
    return { ticks: [clean(min)], step: 1, minor: [] };
  }
  const mt = Math.max(2, Math.floor(maxTicks));
  const raw = range / (mt - 1);
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  let mant = 10;
  for (const m of [1, 2, 5, 10]) {
    if (m * base >= raw * (1 - 1e-9)) {
      mant = m;
      break;
    }
  }
  const step = clean(mant * base);
  const eps = range * 1e-9;
  const first = Math.ceil((min - eps) / step);
  const last = Math.floor((max + eps) / step);
  const ticks: number[] = [];
  for (let i = first; i <= last; i++) ticks.push(clean(i * step));

  // Minor ticks.
  const sub = mant === 2 ? 4 : 5;
  const mstep = step / sub;
  const minor: number[] = [];
  const mfirst = Math.ceil((min - eps) / mstep);
  const mlast = Math.floor((max + eps) / mstep);
  if (mlast - mfirst < 2000) {
    for (let i = mfirst; i <= mlast; i++) {
      if (((i % sub) + sub) % sub === 0) continue;
      minor.push(clean(i * mstep));
    }
  }
  return { ticks, step, minor };
}

/**
 * Decade ticks for a log axis (min, max > 0), plus minor ticks 2..9 x 10^k.
 * `maxLabels` limits the number of decade labels (a stride is applied).
 */
export function logTicks(min: number, max: number, maxLabels = 12): LogTickResult {
  if (!(min > 0) || !(max > 0) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return { ticks: [], step: 0, minor: [], linear: false };
  }
  if (min > max) [min, max] = [max, min];
  const lmin = Math.log10(min);
  const lmax = Math.log10(max);
  const eps = 1e-9;
  const kFirst = Math.ceil(lmin - eps);
  const kLast = Math.floor(lmax + eps);
  const decades = kLast - kFirst + 1;

  if (decades >= 2) {
    const stride = Math.max(1, Math.ceil(decades / Math.max(2, maxLabels)));
    const ticks: number[] = [];
    for (let k = kFirst; k <= kLast; k++) {
      if ((k - kFirst) % stride === 0) ticks.push(Math.pow(10, k));
    }
    const minor: number[] = [];
    if (stride === 1) {
      for (let k = Math.floor(lmin) - 1; k <= kLast; k++) {
        for (let m = 2; m <= 9; m++) {
          const v = m * Math.pow(10, k);
          if (v >= min * (1 - 1e-12) && v <= max * (1 + 1e-12)) minor.push(clean(v));
        }
      }
    }
    return { ticks, step: 0, minor, linear: false };
  }

  // Narrow range (< 2 decades spanned by whole decades): label 1, 2, 5 x 10^k.
  const kLo = Math.floor(lmin) - 1;
  const kHi = Math.ceil(lmax);
  const ticks: number[] = [];
  const minor: number[] = [];
  for (let k = kLo; k <= kHi; k++) {
    for (let m = 1; m <= 9; m++) {
      const v = clean(m * Math.pow(10, k));
      if (v < min * (1 - 1e-12) || v > max * (1 + 1e-12)) continue;
      if (m === 1 || m === 2 || m === 5) ticks.push(v);
      else minor.push(v);
    }
  }
  if (ticks.length >= 2) return { ticks, step: 0, minor, linear: false };

  // Very narrow (e.g. 1.2 .. 1.8): fall back to linear ticks.
  const lin = niceTicks(min, max, 6);
  return { ...lin, linear: true };
}

/** Number of decimals needed to show multiples of `step` (at least 1). */
export function decimalsForStep(step: number): number {
  const s = Math.abs(step);
  if (!(s > 0) || !Number.isFinite(s)) return 1;
  for (let d = 0; d <= 15; d++) {
    const scaled = s * Math.pow(10, d);
    if (Math.abs(scaled - Math.round(scaled)) <= 1e-7 * Math.max(1, scaled)) return Math.max(1, d);
  }
  return 6;
}

function stripNegZero(s: string): string {
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** True when the value is drawn in mantissa x 10^exponent form. */
export function usesScientific(v: number): boolean {
  const a = Math.abs(v);
  return a >= 1e5 || (a < 1e-3 && a !== 0);
}

/**
 * ASTRA style tick label. Fixed decimals derived from the tick step (at least
 * one: "0.0", "0.5", "10.0", "0.035"); very large / small numbers use the
 * mantissa form `{mantissa: "2.5x10", exponent: "-4"}`.
 */
export function formatTick(v: number, step: number): TickLabel {
  if (!Number.isFinite(v)) return { mantissa: String(v) };
  const s = Math.abs(step);
  if (s > 0 && Math.abs(v) < s * 1e-9) v = 0;
  if (v === 0) return { mantissa: '0.0' };

  if (usesScientific(v)) {
    let e = Math.floor(Math.log10(Math.abs(v)));
    let dm = s > 0 ? Math.min(6, decimalsForStep(s / Math.pow(10, e))) : 1;
    let m = v / Math.pow(10, e);
    let ms = m.toFixed(dm);
    if (Math.abs(Number(ms)) >= 10) {
      e += 1;
      m = v / Math.pow(10, e);
      dm = s > 0 ? Math.min(6, decimalsForStep(s / Math.pow(10, e))) : 1;
      ms = m.toFixed(dm);
    }
    return { mantissa: stripNegZero(ms) + 'x10', exponent: String(e) };
  }
  const d = s > 0 ? Math.min(10, decimalsForStep(s)) : 1;
  return { mantissa: stripNegZero(v.toFixed(d)) };
}

/** Log-axis label: "1.0x10" with exponent (decades) or "2.0x10" for 2 x 10^k. */
export function formatLogTick(v: number): TickLabel {
  if (!(v > 0) || !Number.isFinite(v)) return { mantissa: String(v) };
  let e = Math.floor(Math.log10(v) + 1e-12);
  let m = v / Math.pow(10, e);
  if (m >= 10 - 1e-9) {
    e += 1;
    m = v / Math.pow(10, e);
  }
  return { mantissa: m.toFixed(1) + 'x10', exponent: String(e) };
}

/** Plain-text rendering of a tick label ("2.5x10^-4"). */
export function tickLabelText(l: TickLabel): string {
  return l.exponent !== undefined ? `${l.mantissa}^${l.exponent}` : l.mantissa;
}

/** Compact number for the hover read-out. */
export function formatReadout(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(3);
  return String(Number(v.toPrecision(6)));
}
