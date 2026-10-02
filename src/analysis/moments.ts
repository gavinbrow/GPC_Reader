import { polyfit, trapz } from './math';
import type { Peak } from './method';
import type { SliceFit } from './ls';

export interface Value {
  v: number;
  e: number; // 1-σ uncertainty (NaN when unknown)
}

export interface Moments {
  Mn: Value;
  Mp: Value;
  Mv: Value;
  Mw: Value;
  Mz: Value;
  Mz1: Value;
  MwMn: Value;
  MzMn: Value;
  Mavg: Value;
  rn: Value;
  rw: Value;
  rz: Value;
  ravg: Value;
  /** Calculated mass (g). */
  mass: number;
  /** Mass recovery (%). */
  recovery: number;
  /** Fraction of the total mass found in all peaks (%). */
  massFraction: number;
  /** Peak elution volume range (mL). */
  volume: number;
  /** Weight-average intrinsic viscosity (mL/g) and hydrodynamic radius (nm). */
  etaW: Value;
  etaN: Value;
  rhW: Value;
  rhZ: Value;
  /** Mark–Houwink–Sakurada fit [η] = K M^a. */
  mhK: number;
  mhA: number;
  /** Conformation plot slope: rg ∝ M^ν. */
  conformationSlope: Value;
  validSlices: number;
}

const nan: Value = { v: NaN, e: NaN };

interface MomentInput {
  t: Float64Array;
  c: Float64Array;
  M: Float64Array;
  Merr: Float64Array;
  rg: Float64Array;
  rgErr: Float64Array;
  eta?: Float64Array;
  rh?: Float64Array;
  flow: number;
  peak: Peak;
  average: SliceFit | null;
}

/**
 * Molar mass and radius moments over the peak slices:
 *   Mn = Σc / Σ(c/M), Mw = ΣcM / Σc, Mz = ΣcM² / ΣcM, Mz+1 = ΣcM³ / ΣcM²
 * Mean-square radius moments (as ASTRA reports rms radius moments):
 *   rn² = Σ(c/M) r² / Σ(c/M), rw² = Σ c r² / Σc, rz² = Σ cM r² / Σ cM
 * Uncertainties are propagated from the per-slice fit uncertainties.
 */
export function computeMoments(inp: MomentInput): Moments {
  const { t, c, M, Merr, rg, rgErr, flow, peak } = inp;
  const n = t.length;
  let S0 = 0;
  let Sm1 = 0;
  let S1 = 0;
  let S2 = 0;
  let S3 = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    const ci = c[i];
    const Mi = M[i];
    if (!(ci > 0) || !(Mi > 0)) continue;
    valid++;
    S0 += ci;
    Sm1 += ci / Mi;
    S1 += ci * Mi;
    S2 += ci * Mi * Mi;
    S3 += ci * Mi * Mi * Mi;
  }
  const out: Moments = {
    Mn: { ...nan },
    Mp: { ...nan },
    Mv: { ...nan },
    Mw: { ...nan },
    Mz: { ...nan },
    Mz1: { ...nan },
    MwMn: { ...nan },
    MzMn: { ...nan },
    Mavg: { ...nan },
    rn: { ...nan },
    rw: { ...nan },
    rz: { ...nan },
    ravg: { ...nan },
    mass: NaN,
    recovery: NaN,
    massFraction: NaN,
    volume: n > 1 ? (t[n - 1] - t[0]) * flow : 0,
    etaW: { ...nan },
    etaN: { ...nan },
    rhW: { ...nan },
    rhZ: { ...nan },
    mhK: NaN,
    mhA: NaN,
    conformationSlope: { ...nan },
    validSlices: valid,
  };

  // Mass & recovery.
  const mass = flow * trapz(t, c);
  out.mass = mass;
  if (peak.injectedMass > 0 && Number.isFinite(mass)) out.recovery = (100 * mass) / peak.injectedMass;

  if (valid > 0) {
    const Mn = S0 / Sm1;
    const Mw = S1 / S0;
    const Mz = S2 / S1;
    const Mz1 = S3 / S2;
    let vMn = 0;
    let vMw = 0;
    let vMz = 0;
    let vMz1 = 0;
    let cmax = -Infinity;
    let ip = -1;
    for (let i = 0; i < n; i++) {
      const ci = c[i];
      const Mi = M[i];
      if (!(ci > 0) || !(Mi > 0)) continue;
      if (ci > cmax) {
        cmax = ci;
        ip = i;
      }
      const s = Number.isFinite(Merr[i]) ? Merr[i] : 0;
      vMn += ((Mn * Mn * ci) / (S0 * Mi * Mi)) ** 2 * s * s;
      vMw += (ci / S0) ** 2 * s * s;
      vMz += ((2 * ci * Mi * S1 - ci * S2) / (S1 * S1)) ** 2 * s * s;
      vMz1 += ((3 * ci * Mi * Mi * S2 - 2 * ci * Mi * S3) / (S2 * S2)) ** 2 * s * s;
    }
    out.Mn = { v: Mn, e: Math.sqrt(vMn) };
    out.Mw = { v: Mw, e: Math.sqrt(vMw) };
    out.Mz = { v: Mz, e: Math.sqrt(vMz) };
    out.Mz1 = { v: Mz1, e: Math.sqrt(vMz1) };
    if (ip >= 0) out.Mp = { v: M[ip], e: Merr[ip] };
    const rel = (a: Value) => (a.e / a.v) ** 2;
    out.MwMn = { v: Mw / Mn, e: (Mw / Mn) * Math.sqrt(rel(out.Mw) + rel(out.Mn)) };
    out.MzMn = { v: Mz / Mn, e: (Mz / Mn) * Math.sqrt(rel(out.Mz) + rel(out.Mn)) };
    if (peak.mhsA > 0) {
      let s = 0;
      for (let i = 0; i < n; i++) if (c[i] > 0 && M[i] > 0) s += c[i] * M[i] ** peak.mhsA;
      out.Mv = { v: (s / S0) ** (1 / peak.mhsA), e: NaN };
    }
  }

  // Radius moments (mean-square averages).
  {
    let wn = 0;
    let ww = 0;
    let wz = 0;
    let an = 0;
    let aw = 0;
    let az = 0;
    let vn = 0;
    let vw = 0;
    let vz = 0;
    for (let i = 0; i < n; i++) {
      const ci = c[i];
      const Mi = M[i];
      const r = rg[i];
      if (!(ci > 0) || !(Mi > 0) || !(r >= 0)) continue;
      const er = Number.isFinite(rgErr[i]) ? rgErr[i] : 0;
      const r2 = r * r;
      const dr2 = 2 * r * er;
      wn += ci / Mi;
      an += (ci / Mi) * r2;
      vn += ((ci / Mi) * dr2) ** 2;
      ww += ci;
      aw += ci * r2;
      vw += (ci * dr2) ** 2;
      wz += ci * Mi;
      az += ci * Mi * r2;
      vz += (ci * Mi * dr2) ** 2;
    }
    const mk = (a: number, w: number, v: number): Value => {
      if (!(w > 0) || !(a >= 0)) return { ...nan };
      const ms = a / w;
      const r = Math.sqrt(ms);
      return { v: r, e: r > 0 ? Math.sqrt(v) / w / (2 * r) : NaN };
    };
    out.rn = mk(an, wn, vn);
    out.rw = mk(aw, ww, vw);
    out.rz = mk(az, wz, vz);
  }

  if (inp.average) {
    out.Mavg = { v: inp.average.M, e: inp.average.Merr };
    out.ravg = { v: inp.average.rg, e: inp.average.rgErr };
  }

  // Viscometry.
  if (inp.eta) {
    let sw = 0;
    let se = 0;
    let sn = 0;
    let snw = 0;
    for (let i = 0; i < n; i++) {
      const e = inp.eta[i];
      if (!(c[i] > 0) || !Number.isFinite(e)) continue;
      sw += c[i];
      se += c[i] * e;
      if (M[i] > 0) {
        sn += (c[i] / M[i]) * e;
        snw += c[i] / M[i];
      }
    }
    if (sw > 0) out.etaW = { v: se / sw, e: NaN };
    if (snw > 0) out.etaN = { v: sn / snw, e: NaN };
  }
  if (inp.rh) {
    let a = 0;
    let w = 0;
    let az = 0;
    let wz = 0;
    for (let i = 0; i < n; i++) {
      const r = inp.rh[i];
      if (!(c[i] > 0) || !(r > 0)) continue;
      a += c[i] * r;
      w += c[i];
      if (M[i] > 0) {
        az += c[i] * M[i] * r;
        wz += c[i] * M[i];
      }
    }
    if (w > 0) out.rhW = { v: a / w, e: NaN };
    if (wz > 0) out.rhZ = { v: az / wz, e: NaN };
  }

  // Log-log fits over the main part of the peak (c >= 10% of max) weighted by c.
  {
    let cmax = 0;
    for (let i = 0; i < n; i++) if (c[i] > cmax) cmax = c[i];
    const sel = (i: number) => c[i] >= 0.1 * cmax && M[i] > 0;
    if (inp.eta) {
      const xs: number[] = [];
      const ys: number[] = [];
      const ws: number[] = [];
      for (let i = 0; i < n; i++)
        if (sel(i) && inp.eta[i] > 0) {
          xs.push(Math.log10(M[i]));
          ys.push(Math.log10(inp.eta[i]));
          ws.push(c[i]);
        }
      const f = xs.length >= 3 ? polyfit(xs, ys, 1, ws) : null;
      if (f) {
        out.mhA = f.p[1];
        out.mhK = 10 ** f.p[0];
      }
    }
    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    for (let i = 0; i < n; i++)
      if (sel(i) && rg[i] > 0) {
        xs.push(Math.log10(M[i]));
        ys.push(Math.log10(rg[i]));
        ws.push(c[i]);
      }
    const f = xs.length >= 3 ? polyfit(xs, ys, 1, ws) : null;
    if (f) out.conformationSlope = { v: f.p[1], e: Math.sqrt(Math.max(0, f.cov[1][1])) };
  }
  return out;
}
