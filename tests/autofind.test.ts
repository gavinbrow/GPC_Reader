import { describe, expect, it } from 'vitest';
import { loadSample } from './helpers';
import { defaultMethod } from '../src/analysis/method';
import { completeMethod, process } from '../src/analysis/pipeline';
import { autoPeaks } from '../src/analysis/signal';

describe('autofind', () => {
  it('places baselines around the main peak when the file has none', async () => {
    const e = await loadSample();
    const m0 = defaultMethod(e);
    const m = completeMethod(e, { ...m0, baselines: {} });
    for (const id of ['LS 5', 'dRI', 'UV 2', 'VIS']) {
      const b = m.baselines[id];
      console.log(id, b.x1.toFixed(2), b.x2.toFixed(2));
      expect(b.x1).toBeLessThan(20.5);
      expect(b.x2).toBeGreaterThan(23);
    }
    const auto = process(e, m).peaks[0].moments;
    const file = process(e, completeMethod(e, m0)).peaks[0].moments;
    console.log('Mw auto', auto.Mw.v, 'file', file.Mw.v, 'mass', auto.mass, file.mass);
    expect(Math.abs(auto.mass / file.mass - 1)).toBeLessThan(0.03);
    expect(Math.abs(auto.Mw.v / file.Mw.v - 1)).toBeLessThan(0.05);
  });

  it('finds the polymer peak in the dRI trace', async () => {
    const e = await loadSample();
    const p = process(e, completeMethod(e, defaultMethod(e)));
    const peaks = autoPeaks(p.t, p.series.dRI.aligned);
    console.log('peaks', peaks);
    const main = peaks.find(([a, b]) => a < 21.8 && b > 21.8);
    expect(main).toBeDefined();
    expect(main![0]).toBeGreaterThan(19.5);
    expect(main![1]).toBeLessThan(24);
  });
});
