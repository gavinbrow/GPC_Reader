import { gunzipSync } from 'fflate';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import {
  decodeBool,
  decodeFloat64,
  decodeInt32,
  decodeNumeric,
  splitStringList,
} from './blob';
import { DATA, INSTRUMENT_LABELS, RESULT_NAMES, UNIT_NAMES } from './codes';
import type {
  BaselineDefinition,
  Experiment,
  FluidConnection,
  LSInstrument,
  LogEntry,
  PeakDefinition,
  RawSeries,
  RIInstrument,
  StoredResult,
  UVInstrument,
  VISInstrument,
} from './types';

type Row = Record<string, SqlValue>;

const LS_CLASSES = [
  'WHeleos8Profile',
  'WHeleosNeonProfile',
  'WHeleosProfile',
  'WHeleosIIProfile',
  'WMiniDawnProfile',
  'WTreosProfile',
  'WDawnEosProfile',
];
const RI_CLASSES = [
  'WNGOInstrumentProfile',
  'WOptilabRexProfile',
  'WOptilabTrexProfile',
  'WOptilab903Profile',
  'WOptilabDSPProfile',
  'WGenericRIInstrumentProfile',
];
const UV_CLASSES = ['WHplcUVDeviceProfile', 'WGenericUVInstrumentProfile', 'WUVInstrumentProfile'];
const VIS_CLASSES = ['WGenericViscometerProfile', 'WViscoStarProfile', 'WViscoStarIIIProfile'];

/** True when the bytes look like a gzip stream. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** True when the bytes are an SQLite database. */
export function isSqlite(bytes: Uint8Array): boolean {
  const magic = 'SQLite format 3';
  if (bytes.length < 16) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic.charCodeAt(i)) return false;
  return true;
}

class Tables {
  private names: Set<string>;
  constructor(private db: Database) {
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    this.names = new Set(res.length ? res[0].values.map((v) => String(v[0])) : []);
  }
  has(name: string) {
    return this.names.has(name);
  }
  list(): string[] {
    return [...this.names].sort();
  }
  rows(table: string, where = ''): Row[] {
    if (!this.has(table)) return [];
    const stmt = this.db.prepare(`SELECT rowid AS _rowid, * FROM "${table}" ${where}`);
    const out: Row[] = [];
    try {
      while (stmt.step()) out.push(stmt.getAsObject() as Row);
    } finally {
      stmt.free();
    }
    return out;
  }
  first(table: string): Row | undefined {
    return this.rows(table)[0];
  }
  count(table: string): number {
    const r = this.db.exec(`SELECT COUNT(*) FROM "${table}"`);
    return Number(r[0]?.values[0]?.[0] ?? 0);
  }
}

const num = (v: SqlValue | undefined, d = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(+v) ? +v : d;
const str = (v: SqlValue | undefined, d = ''): string => (typeof v === 'string' ? v.trim() : v == null ? d : String(v));
const bytes = (v: SqlValue | undefined): Uint8Array | null => (v instanceof Uint8Array ? v : null);

/** Time index of a vector/matrix row: explicit or evenly spaced. */
function indexOf(r: Row): Float64Array {
  if (num(r.m_bEvenlySpacedIndex) && num(r.m_nIndexLength) > 0) {
    const n = num(r.m_nIndexLength);
    const t0 = num(r.m_dIndexStart);
    const dt = num(r.m_dIndexSpacing);
    return Float64Array.from({ length: n }, (_, i) => t0 + i * dt);
  }
  return decodeFloat64(bytes(r.m_vIndex));
}

function closestIndex(values: number[], target: number): number {
  let best = 0;
  values.forEach((v, i) => {
    if (Math.abs(v - target) < Math.abs(values[best] - target)) best = i;
  });
  return best;
}

export interface ParseOptions {
  fileName?: string;
}

/**
 * Parse an ASTRA experiment (.afe8 = gzip-compressed SQLite database).
 * Accepts the gzip bytes or an already-decompressed SQLite image.
 */
export function parseAfe8(SQL: SqlJsStatic, input: Uint8Array, opts: ParseOptions = {}): Experiment {
  let data = input;
  if (isGzip(data)) data = gunzipSync(data);
  if (!isSqlite(data)) throw new Error('Not an ASTRA experiment: the file is not a (gzip-compressed) SQLite database.');
  const db = new SQL.Database(data);
  try {
    return readExperiment(new Tables(db), opts);
  } finally {
    db.close();
  }
}

function readExperiment(T: Tables, opts: ParseOptions): Experiment {
  if (!T.has('WExperiment')) throw new Error('Not an ASTRA experiment: missing WExperiment table.');
  const exp = T.first('WExperiment') ?? {};
  const cfg = T.first('WExperimentConfigurationProfile') ?? {};
  const expData = T.first('WExperimentData') ?? {};
  const sampleRow = T.first('WInjectedSampleProfile') ?? {};
  const solventRow = T.first('WSolventProfile') ?? {};
  const coll = T.first('WBasicCollectionProcedure') ?? {};

  // ---------------------------------------------------------------- LS
  let ls: LSInstrument | undefined;
  for (const cls of LS_CLASSES) {
    const r = T.first(cls);
    if (!r) continue;
    const nDet = num(r.m_nNumberOfDetectors, 0);
    let nominal = Array.from(decodeFloat64(bytes(r.m_vDetectorAngles)));
    if (nDet > 0 && nominal.length > nDet) nominal = nominal.slice(0, nDet);
    let norm = Array.from(decodeFloat64(bytes(r.m_vNormalizationCoefficients)));
    norm = nominal.map((_, i) => (norm[i] && Number.isFinite(norm[i]) ? norm[i] : 1));
    ls = {
      name: str(r.m_sName, INSTRUMENT_LABELS[cls] ?? cls),
      profileClass: cls,
      wavelength: num(r.m_dWavelength, 658),
      calibrationConstant: num(r.m_dCalibrationConstant, 1),
      temperature: num(r.m_dTemperature, 25),
      detectorCount: nominal.length,
      nominalAngles: nominal,
      normalizationCoefficients: norm,
      detectorEnabled: nominal.map(() => true),
      firmware: str(r.firmwareVersion),
      divideByLaserMonitor: !!num(r.m_bDivideByLaserMonitor),
      cellType: str(r.m_sLSSampleCellClassName).replace(/^W|Profile$/g, ''),
    };
    const proc = T.first('WDetermineMassAndRadiusFromLSProcedure');
    if (proc) {
      const ang = Array.from(decodeFloat64(bytes(proc.m_vDetectorAngle)));
      const en = decodeBool(bytes(proc.m_vDetectorEnabled));
      const detNo = Array.from(decodeInt32(bytes(proc.m_vDetectorNumber)));
      if (ang.length === nominal.length) ls.solventAngles = ang;
      if (en.length === nominal.length) ls.detectorEnabled = en;
      else if (detNo.length && en.length === detNo.length) {
        ls.detectorEnabled = nominal.map((_, i) => {
          const k = detNo.indexOf(i + 1);
          return k < 0 ? true : en[k];
        });
      }
    }
    break;
  }

  // ---------------------------------------------------------------- RI
  let ri: RIInstrument | undefined;
  for (const cls of RI_CLASSES) {
    const r = T.first(cls);
    if (!r) continue;
    ri = {
      name: str(r.m_sName, INSTRUMENT_LABELS[cls] ?? cls),
      profileClass: cls,
      wavelength: num(r.m_dWavelength, 658),
      calibrationConstant: num(r.m_dCalibrationConstant, 1),
      temperature: num(r.m_dTemperature, 25),
      firmware: str(r.firmwareVersion),
    };
    break;
  }

  // ---------------------------------------------------------------- UV
  let uv: UVInstrument | undefined;
  for (const cls of UV_CLASSES) {
    const r = T.first(cls);
    if (!r) continue;
    const nCh = num(r.numberUVChannels, 1);
    const wl = [num(sampleRow.primaryUVWavelength, 280), num(sampleRow.secondaryUVWavelength, 254)];
    uv = {
      name: str(r.m_sName, INSTRUMENT_LABELS[cls] ?? cls),
      profileClass: cls,
      cellLength: num(r.cellLength, 1),
      channelCount: nCh,
      activeChannel: num(r.activeChannel, 0),
      wavelengths: Array.from({ length: nCh }, (_, i) => wl[i] ?? 0),
      firmware: str(r.firmwareVersion),
    };
    break;
  }

  // ---------------------------------------------------------------- VIS
  let vis: VISInstrument | undefined;
  const auxConn = T.rows('WAuxConnectionProfile');
  for (const cls of VIS_CLASSES) {
    const r = T.first(cls);
    if (!r) continue;
    const conn = auxConn.find((c) => str(c.m_sSourceInstrument).startsWith(cls));
    vis = {
      name: str(r.m_sName, INSTRUMENT_LABELS[cls] ?? cls),
      profileClass: cls,
      temperature: num(r.m_dTemperature, 25),
      source: conn ? `${str(conn.m_sDestinationInstrument)} AUX ${num(conn.m_nAuxChannel)}` : 'native',
      auxChannel: conn ? num(conn.m_nAuxChannel) : undefined,
      calibrationConstant: conn ? num(conn.m_dCalibrationConstant, 1) : 1,
    };
    break;
  }

  // ---------------------------------------------------------------- series
  const series: RawSeries[] = [];
  const lsAngles = ls?.solventAngles ?? ls?.nominalAngles ?? [];
  const det90 = lsAngles.length ? closestIndex(lsAngles, 90) + 1 : 0;

  for (const r of T.rows('WMatrixData')) {
    const cls = str(r.m_sInstrumentClassName);
    const code = num(r.m_nDataName);
    const t = indexOf(r);
    const cols = Array.from(decodeFloat64(bytes(r.m_vColumnIndex)));
    const nCols = cols.length;
    if (!t.length || !nCols) continue;
    const vals = decodeNumeric(bytes(r.m_vvValue), t.length * nCols);
    if (vals.length < t.length * nCols) continue;
    const column = (k: number) => {
      const out = new Float64Array(t.length);
      for (let i = 0; i < t.length; i++) out[i] = vals[i * nCols + k];
      return out;
    };
    if (code === DATA.LS_DETECTORS && LS_CLASSES.includes(cls)) {
      cols.forEach((c, k) => {
        const d = Math.round(c);
        series.push({
          id: `LS ${d}`,
          label: `LS ${d}`,
          kind: 'LS',
          instrumentClass: cls,
          baselineName: `detector ${d}`,
          units: 'V',
          quantity: 'voltage',
          time: t,
          values: column(k),
          detector: d,
          defaultVisible: d === det90,
          analysable: true,
        });
      });
    } else if (code === DATA.AUX_CHANNELS && LS_CLASSES.includes(cls)) {
      cols.forEach((c, k) => {
        const ch = Math.round(c);
        const values = column(k);
        if (vis && vis.auxChannel === ch) {
          const cal = vis.calibrationConstant || 1;
          series.push({
            id: 'VIS',
            label: 'VIS',
            kind: 'VIS',
            instrumentClass: vis.profileClass,
            baselineName: 'Specific Viscosity Data',
            units: '',
            quantity: 'specificViscosity',
            time: t,
            values: values.map((v) => v * cal),
            channel: ch,
            defaultVisible: true,
            analysable: true,
          });
        }
        series.push({
          id: `AUX ${ch}`,
          label: `AUX ${ch}`,
          kind: 'AUX',
          instrumentClass: cls,
          units: 'V',
          quantity: 'voltage',
          time: t,
          values,
          channel: ch,
          defaultVisible: false,
        });
      });
    } else if (code === DATA.UV_CHANNELS) {
      cols.forEach((c, k) => {
        const ch = Math.round(c);
        series.push({
          id: `UV ${ch}`,
          label: `UV ${ch}`,
          kind: 'UV',
          instrumentClass: cls,
          baselineName: `channel ${ch}`,
          units: 'AU',
          quantity: 'absorbance',
          time: t,
          values: column(k),
          channel: ch,
          defaultVisible: uv ? ch === uv.activeChannel + 1 : ch === 1,
          analysable: true,
        });
      });
    }
  }

  const vectorSpec: Record<number, Partial<RawSeries> & { id: string }> = {
    [DATA.DIFFERENTIAL_RI]: {
      id: 'dRI',
      kind: 'RI',
      baselineName: 'differential refractive index data',
      units: 'RIU',
      quantity: 'dRI',
      defaultVisible: true,
      analysable: true,
    },
    [DATA.SPECIFIC_VISCOSITY]: {
      id: 'VIS',
      kind: 'VIS',
      baselineName: 'Specific Viscosity Data',
      units: '',
      quantity: 'specificViscosity',
      defaultVisible: true,
      analysable: true,
    },
    [DATA.FORWARD_MONITOR]: { id: 'FM', kind: 'LS', units: '', quantity: 'monitor', defaultVisible: false },
    [DATA.HPLC_RIPPLE]: { id: 'HPLC Ripple (%)', kind: 'HPLC', units: '%', quantity: 'hplc', defaultVisible: true },
    [DATA.HPLC_PRESSURE]: { id: 'HPLC Pressure (bar)', kind: 'HPLC', units: 'bar', quantity: 'hplc', defaultVisible: true },
    [DATA.HPLC_FLOW]: { id: 'HPLC Flow Rate (mL/min)', kind: 'HPLC', units: 'mL/min', quantity: 'hplc', defaultVisible: true },
    [DATA.LASER_MONITOR]: { id: 'Laser monitor', kind: 'LS', units: '', quantity: 'monitor' },
    [DATA.LASER_CURRENT]: { id: 'Laser current', kind: 'LS', units: 'A', quantity: 'monitor' },
    [DATA.LASER_VOLTAGE]: { id: 'Laser voltage', kind: 'LS', units: 'V', quantity: 'monitor' },
    [DATA.LASER_TEMPERATURE]: { id: 'Laser temperature', kind: 'LS', units: '°C', quantity: 'temperature' },
    [DATA.CELL_TEMPERATURE]: { id: 'LS cell temperature', kind: 'LS', units: '°C', quantity: 'temperature' },
    [DATA.ABSOLUTE_RI]: { id: 'Absolute RI', kind: 'RI', units: 'RIU', quantity: 'other' },
    [DATA.RI_TEMPERATURE]: { id: 'RI temperature', kind: 'RI', units: '°C', quantity: 'temperature' },
  };

  for (const r of T.rows('WVectorData')) {
    const cls = str(r.m_sInstrumentClassName);
    const code = num(r.m_nDataName);
    let spec = vectorSpec[code];
    // 12021 is the LS aux matrix name but under an RI profile it is a raw voltage vector.
    if (code === DATA.RI_RAW && RI_CLASSES.includes(cls)) spec = { id: 'RI raw', kind: 'RI', units: 'V', quantity: 'other' };
    if (!spec) continue;
    if (series.some((s) => s.id === spec.id)) continue;
    const t = indexOf(r);
    if (t.length < 2) continue;
    const values = decodeNumeric(bytes(r.m_vValue), t.length);
    if (values.length !== t.length) continue;
    series.push({
      label: spec.id,
      instrumentClass: cls,
      time: t,
      values,
      ...spec,
    } as RawSeries);
  }

  const order = (s: RawSeries) => {
    const base = { LS: 0, UV: 100, RI: 200, VIS: 300, HPLC: 500, AUX: 600 }[s.kind];
    if (s.kind === 'LS' && s.detector) return s.detector;
    if (s.kind === 'UV' && s.channel) return base + s.channel;
    if (s.id === 'dRI') return 200;
    if (s.id === 'VIS') return 300;
    if (s.id === 'FM') return 400;
    if (s.kind === 'HPLC') return base + ['HPLC Ripple (%)', 'HPLC Pressure (bar)', 'HPLC Flow Rate (mL/min)'].indexOf(s.id);
    return 700 + base;
  };
  series.sort((a, b) => order(a) - order(b));

  // ---------------------------------------------------------------- peaks / baselines
  const peaks: PeakDefinition[] = T.rows('WPeakRange')
    .filter((r) => num(r.rangeNumber) >= 1)
    .map((r) => ({
      number: num(r.rangeNumber),
      name: str(r.rangeName) || `Peak ${num(r.rangeNumber)}`,
      start: num(r.rangeStart),
      end: num(r.rangeEnd),
      dndc: num(r.m_dDNDC, num(sampleRow.m_dDNDC, 0.185)),
      a2: num(r.m_dA2),
      uvExtinction: num(r.m_dUVExtinctionCoefficient),
      concentration: num(r.m_dConcentration),
      injectedMass: num(r.m_dInjectedMass),
      lsModel: num(r.m_nLSModel),
      lsFitDegree: Math.max(1, num(r.m_nLSFitDegree, 1)),
      radius: num(r.m_dRadius, 3),
    }))
    .sort((a, b) => a.number - b.number);

  const baselines: BaselineDefinition[] = T.rows('WBaseline').map((r) => ({
    seriesName: str(r.m_sSeriesName),
    type: num(r.m_nBaselineType),
    x1: num(r.m_dX1),
    x2: num(r.m_dX2),
    y1: num(r.m_dY1),
    y2: num(r.m_dY2),
  }));

  // ---------------------------------------------------------------- flow path
  const fluidConnections: FluidConnection[] = T.rows('WFluidConnectionProfile').map((r) => ({
    name: str(r.m_sName),
    from: str(r.m_sSourceInstrument),
    to: str(r.m_sDestinationInstrument),
    volume: num(r.m_dInterdetectorVolume),
  }));
  const flowPath: string[] = [];
  {
    const targets = new Set(fluidConnections.map((c) => c.to));
    let node = fluidConnections.find((c) => !targets.has(c.from))?.from;
    const seen = new Set<string>();
    while (node && !seen.has(node)) {
      seen.add(node);
      flowPath.push(node);
      node = fluidConnections.find((c) => c.from === node)?.to;
    }
  }

  // ---------------------------------------------------------------- results & log
  const storedResults: StoredResult[] = T.rows('WResultData').map((r) => {
    const code = num(r.m_nDataName);
    return {
      code,
      name: RESULT_NAMES[code] ?? `Result ${code}`,
      peak: num(r.m_nPeak),
      instrumentClass: str(r.m_sInstrumentClassName),
      category: num(r.dataCategory),
      value: num(r.m_dValue, NaN),
      uncertainty: num(r.m_dHighUncertainty),
      unit: UNIT_NAMES[num(r.m_nValueUnits)] ?? '',
      index: num(r.indexValue) || undefined,
      unableToCalculate: !!num(r.m_bUnableToCalculate),
    };
  });

  const logRows = T.rows('WLogEntry');
  const log: LogEntry[] = logRows
    .map((r) => ({ time: str(r.systemTime), event: num(r.m_nEvent), details: str(r.m_sDetails) }))
    .sort((a, b) => a.time.localeCompare(b.time));
  const astraVersion =
    (log.map((l) => /ASTRA \(v([\d.]+)\)/.exec(l.details)?.[1]).find(Boolean) as string | undefined) ??
    logRows
      .map((r) => (r.data instanceof Uint8Array ? new TextDecoder().decode(r.data) : str(r.data)))
      .map((d) => /appVersion="([\d.]+)"/.exec(d)?.[1])
      .find(Boolean) ??
    '';

  const fileName = opts.fileName ?? str(exp.path).split(/[\\/]/).pop() ?? 'experiment.afe8';
  const name = fileName.replace(/\.afe8$/i, '');

  const despike = T.first('WDespikingProcedure');
  const concProc = T.first('WConvertToConcentrationProcedure');
  const flowFromVector = series.find((s) => s.id === 'HPLC Flow Rate (mL/min)');
  let flowRate = num(coll.pumpFlowRate, 0);
  if (!(flowRate > 0) && flowFromVector) {
    const v = [...flowFromVector.values].sort((a, b) => a - b);
    flowRate = v[Math.floor(v.length / 2)];
  }
  if (!(flowRate > 0)) flowRate = 1;

  return {
    id: `${name}-${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    name,
    path: str(exp.path).replace(/^\\/, ''),
    configurationName: str(cfg.m_sName),
    astraVersion,
    processingDateTime: str(exp.processingDateTime),
    collection: {
      operator: str(coll.m_sCollectionOperatorName),
      duration: num(coll.m_dCollectionDuration),
      collectionInterval: num(coll.collectinIntervalLs, num(coll.m_dLSCollectionInterval, 0.5)),
      injectionVolume: num(coll.samplerInjVolume),
      vial: str(coll.samplerInjLocationEx),
      flowRate,
      triggerOnAutoInject: !!num(coll.waitForAutoInjectSignal, num(coll.m_bWaitForAutoInjectSignal)),
      collectionTime: str(expData.m_CollectionTime),
      script: str(coll.m_sScript),
    },
    ls,
    ri,
    uv,
    vis,
    hplcDevices: T.rows('WHplcDeviceProfile').map((r) => str(r.m_sName)),
    solvent: {
      name: str(solventRow.m_sName, 'solvent'),
      description: str(solventRow.m_sDescription),
      refractiveIndexModel: num(solventRow.m_nRefractiveIndexModel),
      refractiveIndexParams: Array.from(decodeFloat64(bytes(solventRow.m_vRefractiveIndexModelParameters))),
      viscosityModel: num(solventRow.m_nViscosityModel),
      viscosityParams: Array.from(decodeFloat64(bytes(solventRow.m_vViscosityModelParameters))),
      referenceTemperature: num(solventRow.m_dReferenceTemperature, 25),
      referenceWavelength: num(solventRow.m_dReferenceWavelength, 658),
    },
    sample: {
      name: str(sampleRow.m_sName, name),
      description: str(sampleRow.m_sDescription),
      dndc: num(sampleRow.m_dDNDC, 0.185),
      a2: num(sampleRow.m_dA2),
      uvExtinction: num(sampleRow.m_dUVExtinctionCoefficient),
      concentration: num(sampleRow.m_dConcentration),
      mhsK: num(sampleRow.m_dMHS_K),
      mhsA: num(sampleRow.m_dMHS_a),
    },
    peaks,
    baselines,
    fluidConnections,
    flowPath,
    despikingLevel: despike ? num(despike.m_eDespikingLevel, 1) : 1,
    concentrationSource: /uv/i.test(str(concProc?.m_sConcentrationSource)) ? 'UV' : 'RI',
    series,
    storedResults,
    log,
    tables: T.list().map((n) => ({ name: n, rows: T.count(n) })),
  };
}

/** Split a "WHplcDeviceProfile (Pump)" style flow-path node into a label. */
export function flowNodeLabel(node: string): string {
  const m = /^(\w+)(?:\s*\((.*)\))?$/.exec(node.trim());
  if (!m) return node;
  const base = INSTRUMENT_LABELS[m[1]] ?? m[1];
  return m[2] ? `${m[2]}` : base;
}

export { splitStringList };
