import { describe, expect, it } from 'vitest';
import { loadSample } from './helpers';
import { defaultMethod } from '../src/analysis/method';
import { completeMethod, process, sliceFitAt } from '../src/analysis/pipeline';
import { determineBandBroadening, determineDelays, determineNormalization, determineUVExtinction } from '../src/analysis/calibration';

describe('analysis pipeline on the PS 30 kDa sample', () => {
  it('reproduces the stored baselines and peak areas', async () => {
    const e = await loadSample();
    const m = completeMethod(e, defaultMethod(e));
    const p = process(e, m);
    // Snap-Y baseline of dRI agrees with the value ASTRA stored.
    expect(p.series.dRI.baseline!.y1).toBeCloseTo(-0.00084980, 6);
    expect(p.series['LS 5'].baseline!.y1).toBeCloseTo(0.0315996, 5);
    const pr = p.peaks[0];
    // ASTRA peak areas (WResultData 2259): RI 3.966e-5, VIS 5.743e-3, UV1 5.444e-3
    expect(pr.stats.dRI.area).toBeCloseTo(3.966e-5, 7);
    expect(pr.stats.VIS.area / 5.743e-3).toBeCloseTo(1, 2);
    expect(Math.abs(pr.stats['UV 2'].area / 0.31006 - 1)).toBeLessThan(0.1);
    // dRI in RIU / dn/dc → 214 µg (86% of the 250 µg injected)
    expect(pr.moments.mass * 1e6).toBeGreaterThan(205);
    expect(pr.moments.mass * 1e6).toBeLessThan(222);
  });

  it('gives ~27 kDa for the PS 30 kDa standard after alignment and normalization', async () => {
    const e = await loadSample();
    let m = completeMethod(e, defaultMethod(e));
    const peak = m.peaks[0];
    const t0 = performance.now();
    const d = determineDelays(e, m, peak);
    m = { ...m, delays: d.delays };
    expect(d.delays.RI).toBeGreaterThan(0.1); // RI is downstream of LS
    expect(d.delays.RI).toBeLessThan(0.2);
    const N = determineNormalization(e, m, peak);
    m = { ...m, ls: { ...m.ls, normalization: N } };
    expect(N[4]).toBeCloseTo(1, 6);
    const p = process(e, m);
    const ms = performance.now() - t0;
    const mo = p.peaks[0].moments;
    console.log('Mn', mo.Mn, 'Mw', mo.Mw, 'Mz', mo.Mz, 'PDI', mo.MwMn, 'rz', mo.rz, 'Mavg', mo.Mavg, 'ravg', mo.ravg, 'recovery', mo.recovery, 'eta', mo.etaW, 'rh', mo.rhW, 'MH', mo.mhK, mo.mhA, 'time ms', ms);
    expect(mo.Mw.v).toBeGreaterThan(24000);
    expect(mo.Mw.v).toBeLessThan(32000);
    expect(mo.MwMn.v).toBeLessThan(1.15);
    const uvEps = determineUVExtinction(p, 0, 1);
    console.log('UV ext 254nm', uvEps);
    const s = sliceFitAt(p, 0, p.peaks[0].i0 + 250);
    expect(s?.fit.x.length).toBe(8);
  });

  it('band broadening determination runs', async () => {
    const e = await loadSample();
    let m = completeMethod(e, defaultMethod(e));
    const peak = m.peaks[0];
    m = { ...m, delays: determineDelays(e, m, peak).delays };
    const bb = determineBandBroadening(e, m, peak);
    console.log('band broadening', bb);
    m = { ...m, delays: bb.delays, bandBroadening: { enabled: true, terms: bb.terms } };
    m = { ...m, ls: { ...m.ls, normalization: determineNormalization(e, m, peak) } };
    const t0 = performance.now();
    const p = process(e, m);
    console.log('with BB: Mw', p.peaks[0].moments.Mw, 'Mn', p.peaks[0].moments.Mn, 'PDI', p.peaks[0].moments.MwMn, 'process ms', performance.now() - t0);
  });
});
