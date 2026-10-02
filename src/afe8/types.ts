/** Kinds of detector/data source recognised in an experiment. */
export type InstrumentKind = 'LS' | 'RI' | 'UV' | 'VIS' | 'HPLC' | 'AUX';

/**
 * One raw signal as collected, on its own native time base (minutes).
 */
export interface RawSeries {
  /** Stable key, also the ASTRA legend label: "LS 5", "UV 1", "dRI", "VIS", "FM", ... */
  id: string;
  label: string;
  kind: InstrumentKind;
  /** Instrument profile class that produced the series (e.g. WHeleos8Profile). */
  instrumentClass: string;
  /** Name ASTRA uses for this series in WBaseline ("detector 5", "channel 1", ...). */
  baselineName?: string;
  units: string;
  /** Which y axis family this belongs to; used to group series on graphs. */
  quantity: 'voltage' | 'absorbance' | 'dRI' | 'specificViscosity' | 'hplc' | 'monitor' | 'temperature' | 'other';
  time: Float64Array;
  values: Float64Array;
  /** LS detector number (1-based) for LS series. */
  detector?: number;
  /** UV channel (1-based) / aux channel number. */
  channel?: number;
  /** Shown by default in the Basic Collection graph (mirrors ASTRA defaults). */
  defaultVisible?: boolean;
  /** Analysable signal (gets a baseline, can be used in peak statistics). */
  analysable?: boolean;
}

export interface LSInstrument {
  name: string;
  profileClass: string;
  wavelength: number; // nm (vacuum)
  calibrationConstant: number; // 1/(V cm)
  temperature: number; // °C (cell)
  detectorCount: number;
  /** Nominal (instrument) angles in degrees, one per LS detector. */
  nominalAngles: number[];
  /** Angles in the solvent as stored by ASTRA's LS procedure (if present). */
  solventAngles?: number[];
  normalizationCoefficients: number[];
  detectorEnabled: boolean[];
  firmware: string;
  divideByLaserMonitor: boolean;
  cellType: string;
}

export interface RIInstrument {
  name: string;
  profileClass: string;
  wavelength: number;
  calibrationConstant: number;
  temperature: number;
  firmware: string;
}

export interface UVInstrument {
  name: string;
  profileClass: string;
  cellLength: number; // cm
  channelCount: number;
  activeChannel: number; // 0-based
  wavelengths: number[]; // nm per channel when known
  firmware: string;
}

export interface VISInstrument {
  name: string;
  profileClass: string;
  temperature: number;
  /** How the signal is obtained: native vector or LS auxiliary channel. */
  source: string;
  auxChannel?: number;
  calibrationConstant: number;
}

export interface Solvent {
  name: string;
  description: string;
  refractiveIndexModel: number;
  refractiveIndexParams: number[];
  viscosityModel: number;
  viscosityParams: number[];
  referenceTemperature: number;
  referenceWavelength: number;
}

export interface SampleInfo {
  name: string;
  description: string;
  dndc: number; // mL/g
  a2: number; // mol mL / g^2
  uvExtinction: number; // mL/(mg cm)
  concentration: number; // g/mL
  mhsK: number;
  mhsA: number;
}

export interface PeakDefinition {
  number: number;
  name: string;
  start: number; // min
  end: number; // min
  dndc: number;
  a2: number;
  uvExtinction: number;
  concentration: number; // g/mL (injected sample concentration)
  injectedMass: number; // g
  lsModel: number; // 0 Zimm, 1 Debye, 2 Berry
  lsFitDegree: number;
  radius: number; // nm, used by normalization
}

export interface BaselineDefinition {
  seriesName: string; // ASTRA name ("detector 5", ...)
  type: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface FluidConnection {
  name: string;
  from: string;
  to: string;
  volume: number; // mL
}

export interface StoredResult {
  code: number;
  name: string;
  peak: number;
  instrumentClass: string;
  category: number;
  value: number;
  uncertainty: number;
  unit: string;
  index?: number;
  unableToCalculate: boolean;
}

export interface LogEntry {
  time: string;
  event: number;
  details: string;
}

export interface CollectionInfo {
  operator: string;
  duration: number; // min
  collectionInterval: number; // s
  injectionVolume: number; // µL
  vial: string;
  flowRate: number; // mL/min
  triggerOnAutoInject: boolean;
  collectionTime: string;
  script: string;
}

export interface Experiment {
  id: string;
  fileName: string;
  /** Sample / experiment display name. */
  name: string;
  path: string;
  configurationName: string;
  astraVersion: string;
  processingDateTime: string;
  collection: CollectionInfo;
  ls?: LSInstrument;
  ri?: RIInstrument;
  uv?: UVInstrument;
  vis?: VISInstrument;
  hplcDevices: string[];
  solvent: Solvent;
  sample: SampleInfo;
  peaks: PeakDefinition[];
  baselines: BaselineDefinition[];
  fluidConnections: FluidConnection[];
  /** Ordered instrument chain along the flow path (profile class names). */
  flowPath: string[];
  despikingLevel: number;
  concentrationSource: 'RI' | 'UV';
  series: RawSeries[];
  storedResults: StoredResult[];
  log: LogEntry[];
  /** Raw table listing for the "file contents" inspector. */
  tables: { name: string; rows: number }[];
}
