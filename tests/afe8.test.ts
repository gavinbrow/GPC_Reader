import { describe, expect, it } from 'vitest';
import { loadSample } from './helpers';

describe('afe8 reader', () => {
  it('reads instruments and configuration', async () => {
    const e = await loadSample();
    expect(e.configurationName).toBe('HPLC+LS+VS+RI');
    expect(e.ls?.name).toBe('DAWN 8');
    expect(e.ls?.wavelength).toBeCloseTo(662.72, 2);
    expect(e.ls?.calibrationConstant).toBeCloseTo(4.881e-5, 9);
    expect(e.ls?.nominalAngles).toEqual([32, 44, 57, 72, 90, 108, 126, 141]);
    expect(e.ls?.solventAngles?.[0]).toBeCloseTo(27.0935, 3);
    expect(e.ri?.name).toBe('Optilab');
    expect(e.uv?.channelCount).toBe(2);
    expect(e.vis?.auxChannel).toBe(2);
    expect(e.solvent.name).toBe('THF');
    expect(e.collection.flowRate).toBe(1);
    expect(e.collection.injectionVolume).toBe(50);
    expect(e.flowPath.map((p) => p.split(' ')[0])).toEqual([
      'WHplcDeviceProfile',
      'WHplcDeviceProfile',
      'WHplcUVDeviceProfile',
      'WHeleos8Profile',
      'WGenericViscometerProfile',
      'WNGOInstrumentProfile',
    ]);
    expect(e.astraVersion).toMatch(/^8\.2/);
  });

  it('reads the signals', async () => {
    const e = await loadSample();
    const ids = e.series.map((s) => s.id);
    expect(ids.slice(0, 13)).toEqual(['LS 1', 'LS 2', 'LS 3', 'LS 4', 'LS 5', 'LS 6', 'LS 7', 'LS 8', 'UV 1', 'UV 2', 'dRI', 'VIS', 'FM']);
    const ls5 = e.series.find((s) => s.id === 'LS 5')!;
    expect(ls5.time.length).toBe(5860);
    expect(ls5.values[0]).toBeGreaterThan(0.03);
    const uv2 = e.series.find((s) => s.id === 'UV 2')!;
    expect(uv2.time.length).toBe(600);
    expect(Math.max(...uv2.values)).toBeCloseTo(0.664, 2);
    const dri = e.series.find((s) => s.id === 'dRI')!;
    expect(dri.time.length).toBe(5697);
  });

  it('reads peaks, baselines and stored results', async () => {
    const e = await loadSample();
    expect(e.peaks).toHaveLength(1);
    expect(e.peaks[0].start).toBeCloseTo(19.6634, 3);
    expect(e.peaks[0].dndc).toBe(0.185);
    expect(e.peaks[0].injectedMass).toBeCloseTo(250e-6, 12);
    expect(e.baselines).toHaveLength(12);
    const mw = e.storedResults.find((r) => r.name === 'Mw');
    expect(mw?.value).toBeCloseTo(15622.59, 1);
  });
});
