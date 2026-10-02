import { describe, expect, it } from 'vitest';
import { syntheticExperiment } from './synthetic';
import { defaultMethod, type Method } from '../src/analysis/method';
import { completeMethod, process } from '../src/analysis/pipeline';
import { indexRange } from '../src/analysis/math';

const gauss = (t: number, mu: number, s: number, h: number) => h * Math.exp(-0.5 * ((t - mu) / s) ** 2);

function truthMoments(t: Float64Array, c: Float64Array, M: Float64Array, a: number, b: number) {
  const [i0, i1] = indexRange(t, a, b);
  let s0 = 0, s1 = 0, s2 = 0, sm = 0;
  for (let i = i0; i <= i1; i++) {
    s0 += c[i]; s1 += c[i] * M[i]; s2 += c[i] * M[i] ** 2; sm += c[i] / M[i];
  }
  return { Mn: s0 / sm, Mw: s1 / s0, Mz: s2 / s1 };
}

describe('synthetic polydisperse sample (ground truth)', () => {
  const { e, truth } = syntheticExperiment({
    logM: (t) => 7.5 - 0.3 * (t - 10), // 3e7 … 3e4 g/mol across the peak
    rg: (M) => 0.0145 * M ** 0.588, // PS-like coil
    conc: (t) => gauss(t, 15, 1.2, 1e-3),
    eta: (M) => 0.0141 * M ** 0.7,
  });

  for (const model of ['Zimm', 'Debye', 'Berry'] as const) {
    it(`recovers M and rg with the ${model} model`, () => {
      let m: Method = completeMethod(e, defaultMethod(e));
      m = { ...m, peaks: m.peaks.map((p) => ({ ...p, lsModel: model, fitDegree: model === 'Zimm' ? 1 : 2 })) };
      const p = process(e, m);
      const pr = p.peaks[0];
      const k = pr.t.length >> 1;
      const i = pr.i0 + k;
      // The data follow the Zimm form exactly; Debye/Berry extrapolations of a
      // 50 nm coil carry a few % model error, as in practice.
      const tol = { Zimm: 0.002, Debye: 0.06, Berry: 0.03 }[model];
      const near = (a: number, b: number) => expect(Math.abs(a / b - 1)).toBeLessThan(tol);
      near(pr.M[k], truth.M[i]);
      near(pr.rg[k], truth.rg[i]);
      const tm = truthMoments(truth.t, truth.c, truth.M, 10, 20);
      near(pr.moments.Mw.v, tm.Mw);
      near(pr.moments.Mn.v, tm.Mn);
      if (model === 'Zimm') near(pr.moments.Mz.v, tm.Mz); // Mz is dominated by ~300 nm coils where Debye/Berry break down
      expect(pr.moments.recovery).toBeCloseTo(100 * (1e-3 * 1.2 * Math.sqrt(2 * Math.PI)) / 2e-4, 0);
      if (model !== 'Debye') expect(pr.moments.conformationSlope.v).toBeCloseTo(0.588, 1);
      if (model === 'Zimm') {
        expect(pr.moments.mhA).toBeCloseTo(0.7, 2);
        expect(pr.moments.mhK).toBeCloseTo(0.0141, 3);
      }
    });
  }

  it('results fitting smooths noisy data and keeps the moments', () => {
    const noisy = syntheticExperiment({
      logM: (t) => 7.5 - 0.3 * (t - 10),
      rg: (M) => 0.0145 * M ** 0.588,
      conc: (t) => gauss(t, 15, 1.2, 1e-3),
      noise: 2e-5,
    });
    let m = completeMethod(noisy.e, defaultMethod(noisy.e));
    const pid = m.peaks[0].id;
    m = { ...m, massFit: { [pid]: { model: 'Polynomial', order: 1, start: 12, end: 18 } } };
    const pr = process(noisy.e, m).peaks[0];
    expect(pr.massFit).not.toBeNull();
    const tm = truthMoments(noisy.truth.t, noisy.truth.c, noisy.truth.M, 10, 20);
    expect(pr.moments.Mw.v / tm.Mw).toBeCloseTo(1, 1);
    expect(pr.distribution.mass!.cumulative.at(-1)).toBeCloseTo(1, 6);
  });
});
