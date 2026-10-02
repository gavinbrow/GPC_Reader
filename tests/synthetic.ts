import type { Experiment, RawSeries } from '../src/afe8/types';
import { opticalConstant } from '../src/analysis/ls';

/**
 * Build a synthetic SEC-MALS experiment with a known molar mass M(t) and rms
 * radius rg(t) at every slice, so the analysis can be checked against
 * ground truth. Scattering follows the Zimm equation exactly (A2 = 0).
 */
export function syntheticExperiment(opts: {
  logM: (t: number) => number;
  rg: (M: number) => number; // nm
  conc: (t: number) => number; // g/mL
  noise?: number; // V
  eta?: (M: number) => number; // mL/g
}): { e: Experiment; truth: { t: Float64Array; M: Float64Array; rg: Float64Array; c: Float64Array } } {
  const n0 = 1.33;
  const lambda = 658;
  const dndc = 0.185;
  const cal = 5e-5;
  const angles = [22, 38, 50, 65, 90, 115, 130, 150];
  const N = 3000;
  const t = Float64Array.from({ length: N }, (_, i) => (i * 30) / N);
  const K = opticalConstant(n0, dndc, lambda);
  const lam = lambda / n0;
  const M = t.map((x) => 10 ** opts.logM(x));
  const rg = M.map((m) => opts.rg(m));
  const c = t.map((x) => opts.conc(x));
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const series: RawSeries[] = angles.map((a, j) => {
    const x = Math.sin((a * Math.PI) / 360) ** 2;
    const values = t.map((_, i) => {
      const P = 1 / (1 + ((16 * Math.PI ** 2) / (3 * lam ** 2)) * rg[i] ** 2 * x);
      const R = K * c[i] * M[i] * P;
      return 0.02 + R / (cal * n0 * n0) + (opts.noise ?? 0) * rnd();
    });
    return {
      id: `LS ${j + 1}`, label: `LS ${j + 1}`, kind: 'LS', instrumentClass: 'WHeleos8Profile', baselineName: `detector ${j + 1}`,
      units: 'V', quantity: 'voltage', time: t, values, detector: j + 1, defaultVisible: a === 90, analysable: true,
    } as RawSeries;
  });
  series.push({
    id: 'dRI', label: 'dRI', kind: 'RI', instrumentClass: 'WNGOInstrumentProfile', baselineName: 'differential refractive index data',
    units: 'RIU', quantity: 'dRI', time: t, values: c.map((v) => -1e-4 + v * dndc), defaultVisible: true, analysable: true,
  });
  if (opts.eta) {
    series.push({
      id: 'VIS', label: 'VIS', kind: 'VIS', instrumentClass: 'WGenericViscometerProfile', baselineName: 'Specific Viscosity Data',
      units: '', quantity: 'specificViscosity', time: t, values: t.map((_, i) => 0.001 + opts.eta!(M[i]) * c[i]), defaultVisible: true, analysable: true,
    });
  }
  const e: Experiment = {
    id: 'synthetic', fileName: 'synthetic.afe8', name: 'synthetic', path: '', configurationName: 'LS+RI', astraVersion: '', processingDateTime: '',
    collection: { operator: '', duration: 30, collectionInterval: 0.6, injectionVolume: 100, vial: '', flowRate: 1, triggerOnAutoInject: true, collectionTime: '', script: '' },
    ls: {
      name: 'DAWN', profileClass: 'WHeleos8Profile', wavelength: lambda, calibrationConstant: cal, temperature: 25, detectorCount: 8,
      nominalAngles: angles, solventAngles: angles, normalizationCoefficients: angles.map(() => 1), detectorEnabled: angles.map(() => true),
      firmware: '', divideByLaserMonitor: true, cellType: 'FusedSilicaFlowCell',
    },
    ri: { name: 'Optilab', profileClass: 'WNGOInstrumentProfile', wavelength: 658, calibrationConstant: 1, temperature: 25, firmware: '' },
    hplcDevices: [],
    solvent: { name: 'water', description: '', refractiveIndexModel: 9, refractiveIndexParams: [n0, 0, 0, 0, 0, 25], viscosityModel: 0, viscosityParams: [], referenceTemperature: 25, referenceWavelength: 658 },
    sample: { name: 'synthetic', description: '', dndc, a2: 0, uvExtinction: 0, concentration: 0.002, mhsK: 0, mhsA: 0 },
    peaks: [{ number: 1, name: 'Peak 1', start: 10, end: 20, dndc, a2: 0, uvExtinction: 0, concentration: 0.002, injectedMass: 2e-4, lsModel: 0, lsFitDegree: 1, radius: 3 }],
    baselines: [], fluidConnections: [], flowPath: [], despikingLevel: 1, concentrationSource: 'RI', series, storedResults: [], log: [], tables: [],
  };
  return { e, truth: { t, M, rg, c } };
}
