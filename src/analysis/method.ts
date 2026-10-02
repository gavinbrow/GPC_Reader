import type { Experiment, RawSeries } from '../afe8/types';
import { solventRefractiveIndex } from './solvent';

/**
 * All user-editable processing parameters of one experiment ("the method").
 * Everything the procedures compute is derived from (Experiment, Method).
 */

export type DespikeLevel = 'Low' | 'Normal' | 'High';
export type LSModel = 'Zimm' | 'Debye' | 'Berry';
export type BaselineStyle = 'Manual' | 'Snap-Y';
export type FitModel = 'None' | 'Polynomial' | 'Exponential';
export type ConcentrationSource = 'RI' | 'UV';
/** Instrument groups that can be aligned / broadened relative to LS. */
export type DelayKind = 'UV' | 'RI' | 'VIS';

export interface Baseline {
  seriesId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: BaselineStyle;
}

export interface Peak {
  id: string;
  name: string;
  start: number; // min
  end: number; // min
  dndc: number; // mL/g
  a2: number; // mol mL/g^2
  uvExtinction: number; // mL/(mg cm)
  concentration: number; // g/mL (sample)
  injectedMass: number; // g
  lsModel: LSModel;
  fitDegree: number;
  /** Radius (nm) assumed when this peak is used for normalization. */
  radius: number;
  mhsK: number; // mL/g
  mhsA: number;
}

export interface ResultsFit {
  model: FitModel;
  order: number;
  /** Fit range in minutes; undefined = whole peak. */
  start?: number;
  end?: number;
}

export interface DistributionRange {
  id: string;
  name: string;
  start: number;
  stop: number;
}

export interface Method {
  despike: { enabled: boolean; level: DespikeLevel };
  baselines: Record<string, Baseline>;
  flowRate: number; // mL/min
  /** Interdetector volume (mL) from the LS detector to each instrument; positive = downstream. */
  delays: Record<DelayKind, number>;
  /**
   * Band-broadening terms (µL) applied to instruments upstream of the
   * concentration reference (RI): Gaussian σ (instrumental) and exponential
   * τ (mixing). Applied when enabled.
   */
  bandBroadening: { enabled: boolean; terms: Record<'LS' | 'UV' | 'VIS', { instrumental: number; mixing: number }> };
  ls: {
    calibrationConstant: number; // 1/(V cm)
    wavelength: number; // nm
    angles: number[]; // degrees (in solvent)
    normalization: number[];
    enabled: boolean[];
  };
  solventRI: number; // refractive index of the solvent at the LS wavelength
  /** Multiplier applied to dRI data (RIU per stored unit). */
  riScale: number;
  uvChannel: number; // 0-based
  uvCellLength: number; // cm
  concentrationSource: ConcentrationSource;
  hundredPercentRecovery: boolean;
  peaks: Peak[];
  massFit: Record<string, ResultsFit>; // keyed by peak id
  radiusFit: Record<string, ResultsFit>;
  normalization: { peakId?: string; percentToKeep: number };
  distribution: { quantity: 'Molar Mass' | 'rms radius'; scale: 'Linear' | 'Log'; ranges: Record<string, DistributionRange[]> };
  viscosity: { solomonCiuta: boolean };
}

let idCounter = 0;
export const newId = (p = 'id') => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function lsSeries(e: Experiment): RawSeries[] {
  return e.series.filter((s) => s.kind === 'LS' && s.detector);
}

export function defaultMethod(e: Experiment): Method {
  const ls = e.ls;
  const nDet = lsSeries(e).length || ls?.detectorCount || 0;
  const n = solventRefractiveIndex(e.solvent, ls?.wavelength ?? 658, ls?.temperature ?? 25);

  // Interdetector volumes along the flow path, relative to the LS instrument.
  const pos: Record<string, number> = {};
  let acc = 0;
  e.flowPath.forEach((node, i) => {
    if (i > 0) {
      const c = e.fluidConnections.find((f) => f.to === node && f.from === e.flowPath[i - 1]);
      acc += c?.volume ?? 0;
    }
    pos[node.split(' ')[0]] = acc;
  });
  const lsPos = ls ? pos[ls.profileClass] ?? 0 : 0;
  const delayOf = (cls?: string) => (cls && pos[cls] !== undefined ? pos[cls] - lsPos : 0);

  const baselines: Record<string, Baseline> = {};
  for (const s of e.series) {
    if (!s.baselineName) continue;
    const b = e.baselines.find((x) => x.seriesName.toLowerCase() === s.baselineName!.toLowerCase());
    if (b && b.x2 > b.x1) {
      baselines[s.id] = { seriesId: s.id, x1: b.x1, x2: b.x2, y1: b.y1, y2: b.y2, style: b.type === 2 ? 'Snap-Y' : 'Manual' };
    }
  }

  const peaks: Peak[] = e.peaks.map((p) => ({
    id: newId('pk'),
    name: p.name,
    start: p.start,
    end: p.end,
    dndc: p.dndc,
    a2: p.a2,
    uvExtinction: p.uvExtinction,
    concentration: p.concentration,
    injectedMass: p.injectedMass,
    lsModel: (['Zimm', 'Debye', 'Berry'] as LSModel[])[p.lsModel] ?? 'Zimm',
    fitDegree: p.lsFitDegree,
    radius: p.radius,
    mhsK: e.sample.mhsK,
    mhsA: e.sample.mhsA,
  }));

  const massFit: Record<string, ResultsFit> = {};
  const radiusFit: Record<string, ResultsFit> = {};
  const ranges: Record<string, DistributionRange[]> = {};
  for (const p of peaks) {
    massFit[p.id] = { model: 'None', order: 1 };
    radiusFit[p.id] = { model: 'None', order: 1 };
    ranges[p.id] = [];
  }

  const angles = ls?.solventAngles?.slice(0, nDet) ?? ls?.nominalAngles.slice(0, nDet) ?? [];
  const level = (['Low', 'Normal', 'High'] as DespikeLevel[])[e.despikingLevel] ?? 'Normal';

  return {
    despike: { enabled: true, level },
    baselines,
    flowRate: e.collection.flowRate || 1,
    delays: { UV: delayOf(e.uv?.profileClass), RI: delayOf(e.ri?.profileClass), VIS: delayOf(e.vis?.profileClass) },
    bandBroadening: {
      enabled: false,
      terms: { LS: { instrumental: 0, mixing: 0 }, UV: { instrumental: 0, mixing: 0 }, VIS: { instrumental: 0, mixing: 0 } },
    },
    ls: {
      calibrationConstant: ls?.calibrationConstant ?? 1,
      wavelength: ls?.wavelength ?? 658,
      angles,
      normalization: Array.from({ length: angles.length }, (_, i) => ls?.normalizationCoefficients[i] ?? 1),
      enabled: Array.from({ length: angles.length }, (_, i) => ls?.detectorEnabled[i] ?? true),
    },
    solventRI: n,
    riScale: 1,
    uvChannel: e.uv?.activeChannel ?? 0,
    uvCellLength: e.uv?.cellLength ?? 1,
    concentrationSource: e.concentrationSource === 'UV' && e.uv ? 'UV' : e.series.some((s) => s.id === 'dRI') ? 'RI' : 'UV',
    hundredPercentRecovery: false,
    peaks,
    massFit,
    radiusFit,
    normalization: { peakId: peaks[0]?.id, percentToKeep: 25 },
    distribution: { quantity: 'Molar Mass', scale: 'Linear', ranges },
    viscosity: { solomonCiuta: false },
  };
}

/** A fresh peak with parameters copied from a template (or the sample). */
export function makePeak(e: Experiment, start: number, end: number, template?: Peak, index = 1): Peak {
  return {
    id: newId('pk'),
    name: `Peak ${index}`,
    start,
    end,
    dndc: template?.dndc ?? e.sample.dndc ?? 0.185,
    a2: template?.a2 ?? e.sample.a2 ?? 0,
    uvExtinction: template?.uvExtinction ?? e.sample.uvExtinction ?? 0,
    concentration: template?.concentration ?? e.sample.concentration ?? 0,
    injectedMass: template?.injectedMass ?? (e.sample.concentration * e.collection.injectionVolume) / 1000,
    lsModel: template?.lsModel ?? 'Zimm',
    fitDegree: template?.fitDegree ?? 1,
    radius: template?.radius ?? 3,
    mhsK: template?.mhsK ?? e.sample.mhsK ?? 0,
    mhsA: template?.mhsA ?? e.sample.mhsA ?? 0,
  };
}
