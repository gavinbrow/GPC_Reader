import { useMemo, useState, type ReactNode } from 'react';
import { exportResultsCSV, exportSliceCSV, sliceRows } from '../actions';
import type { Moments, Value } from '../analysis/moments';
import type { PeakResult, Processed } from '../analysis/pipeline';
import { processedFor, useStore, type Tab } from '../store';
import { DataTable, ToolButton, ToolLabel, ToolSelect, ViewFrame } from '../ui/ViewFrame';
import { useViewContext } from '../ui/useView';
import { num, pm, withRel } from '../ui/format';
import { IconExport } from '../ui/icons';

/* ------------------------------------------------------------------ shared rows */

export interface ResultLine {
  label: string;
  unit: string;
  get: (m: Moments, pr: PeakResult) => Value | number;
  /** Formatting style: 'm' molar mass with relative uncertainty, 'r' radius, 'x' plain. */
  style?: 'm' | 'r' | 'x' | 'pct';
}

export const RESULT_LINES: { group: string; lines: ResultLine[] }[] = [
  {
    group: 'Molar mass moments',
    lines: [
      { label: 'Mn', unit: 'g/mol', get: (m) => m.Mn, style: 'm' },
      { label: 'Mp', unit: 'g/mol', get: (m) => m.Mp, style: 'm' },
      { label: 'Mv', unit: 'g/mol', get: (m) => m.Mv, style: 'm' },
      { label: 'Mw', unit: 'g/mol', get: (m) => m.Mw, style: 'm' },
      { label: 'Mz', unit: 'g/mol', get: (m) => m.Mz, style: 'm' },
      { label: 'Mz+1', unit: 'g/mol', get: (m) => m.Mz1, style: 'm' },
      { label: 'M (avg)', unit: 'g/mol', get: (m) => m.Mavg, style: 'm' },
    ],
  },
  {
    group: 'Polydispersity',
    lines: [
      { label: 'Mw/Mn', unit: '', get: (m) => m.MwMn, style: 'x' },
      { label: 'Mz/Mn', unit: '', get: (m) => m.MzMn, style: 'x' },
    ],
  },
  {
    group: 'rms radius moments',
    lines: [
      { label: 'rn', unit: 'nm', get: (m) => m.rn, style: 'r' },
      { label: 'rw', unit: 'nm', get: (m) => m.rw, style: 'r' },
      { label: 'rz', unit: 'nm', get: (m) => m.rz, style: 'r' },
      { label: 'r (avg)', unit: 'nm', get: (m) => m.ravg, style: 'r' },
      { label: 'Conformation slope (rg ∝ M^ν)', unit: '', get: (m) => m.conformationSlope, style: 'x' },
    ],
  },
  {
    group: 'Mass',
    lines: [
      { label: 'Calculated mass', unit: 'µg', get: (m) => m.mass * 1e6, style: 'x' },
      { label: 'Mass recovery', unit: '%', get: (m) => m.recovery, style: 'pct' },
      { label: 'Mass fraction', unit: '%', get: (m) => m.massFraction, style: 'pct' },
      { label: 'Peak volume', unit: 'mL', get: (m) => m.volume, style: 'x' },
    ],
  },
  {
    group: 'Viscometry',
    lines: [
      { label: '[η]w', unit: 'mL/g', get: (m) => m.etaW, style: 'x' },
      { label: '[η]n', unit: 'mL/g', get: (m) => m.etaN, style: 'x' },
      { label: 'Rh (w)', unit: 'nm', get: (m) => m.rhW, style: 'r' },
      { label: 'Rh (z)', unit: 'nm', get: (m) => m.rhZ, style: 'r' },
      { label: 'Mark-Houwink K', unit: 'mL/g', get: (m) => m.mhK, style: 'x' },
      { label: 'Mark-Houwink a', unit: '', get: (m) => m.mhA, style: 'x' },
    ],
  },
];

export function formatResult(line: ResultLine, v: Value | number): string {
  const val = typeof v === 'number' ? { v, e: NaN } : v;
  if (!Number.isFinite(val.v)) return 'n/a';
  switch (line.style) {
    case 'm':
      return withRel(val.v, val.e);
    case 'r':
      return Number.isFinite(val.e) ? `${val.v.toFixed(1)} (±${((100 * val.e) / val.v).toFixed(1)}%)` : val.v.toFixed(1);
    case 'pct':
      return val.v.toFixed(1);
    default:
      return Number.isFinite(val.e) ? `${num(val.v)} (±${num(val.e, 2)})` : num(val.v);
  }
}

/** Lines that have at least one finite value in any of the given peaks. */
export function activeLines(peaks: PeakResult[]) {
  return RESULT_LINES.map((g) => ({
    ...g,
    lines: g.lines.filter((l) =>
      peaks.some((pr) => {
        const v = l.get(pr.moments, pr);
        return Number.isFinite(typeof v === 'number' ? v : v.v);
      }),
    ),
  })).filter((g) => g.lines.length);
}

/** Results table with one column per peak. */
export function PeakResultsTable({ p }: { p: Processed }) {
  const groups = activeLines(p.peaks);
  const rows: ReactNode[][] = [];
  for (const g of groups) {
    rows.push([<b key="g">{g.group}</b>, ...p.peaks.map(() => '')]);
    for (const l of g.lines) rows.push([`${l.label}${l.unit ? ` (${l.unit})` : ''}`, ...p.peaks.map((pr) => formatResult(l, l.get(pr.moments, pr)))]);
  }
  return <DataTable head={['', ...p.peaks.map((pr) => pr.peak.name)]} rows={rows} />;
}

/* ------------------------------------------------------------------ views */

export function PeakResultsView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  if (!ctx) return null;
  const p = ctx.processed;
  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <ToolButton icon={<IconExport />} onClick={exportResultsCSV} title="Export the results of all open experiments">
          Export CSV
        </ToolButton>
      }
      messages={p.peaks.flatMap((pr) => pr.warnings.map((w) => `${pr.peak.name}: ${w}`))}
      main={p.peaks.length ? <PeakResultsTable p={p} /> : <div className="placeholder">No peaks defined.</div>}
    />
  );
}

export function PeakStatsView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [peak, setPeak] = useState(0);
  if (!ctx) return null;
  const p = ctx.processed;
  const pr = p.peaks[Math.min(peak, p.peaks.length - 1)];
  if (!pr) return <div className="placeholder">No peaks defined.</div>;
  const ids = Object.keys(pr.stats);
  const head = ['Signal', 'Retention time (min)', 'Retention volume (mL)', 'Height', 'Area (·min)', 'Centroid (min)', 'σ (min)', 'FWHM (min)', 'Width 10% (min)', 'Width 5% (min)', 'Plates (N)', 'Asymmetry (10%)', 'Tailing (5%)'];
  const rows = ids.map((id) => {
    const s = pr.stats[id];
    return [id, num(s.retentionTime, 5), num(s.retentionVolume, 5), num(s.height), num(s.area), num(s.centroid, 5), num(s.sigma), num(s.fwhm), num(s.width10), num(s.width5), num(s.plates, 5), num(s.asymmetry), num(s.tailing)];
  });
  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolLabel>Peak:</ToolLabel>
          <ToolSelect value={pr.index} options={p.peaks.map((x, i) => ({ value: i, label: x.peak.name }))} onChange={setPeak} />
          <span className="muted" style={{ marginLeft: 12 }}>
            Column performance of each baseline-corrected, aligned signal within the peak limits. Plates N = 5.545 (t<sub>R</sub>/W<sub>½</sub>)².
          </span>
        </>
      }
      main={<DataTable head={head} rows={rows} />}
    />
  );
}

export function SliceTableView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const rows = useMemo(() => (ctx ? sliceRows(tab.expId!) : []), [ctx?.processed]);
  if (!ctx) return null;
  const [head, ...body] = rows;
  const fmtCell = (v: unknown) => (typeof v === 'number' ? (Number.isFinite(v) ? num(v, 5) : '') : String(v ?? ''));
  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <ToolButton icon={<IconExport />} onClick={() => exportSliceCSV(tab.expId)}>
          Export CSV
        </ToolButton>
      }
      main={<DataTable head={(head ?? []).map(String)} rows={body.map((r) => r.map(fmtCell))} />}
    />
  );
}

/** Map stored ASTRA result names onto our computed values for a side-by-side comparison. */
function ourValue(name: string, m: Moments): Value | null {
  const map: Record<string, Value | undefined> = {
    Mn: m.Mn,
    Mw: m.Mw,
    Mz: m.Mz,
    'Mz+1': m.Mz1,
    Mp: m.Mp,
    'M (avg)': m.Mavg,
    'Mw/Mn': m.MwMn,
    'Mz/Mn': m.MzMn,
    rn: m.rn,
    rw: m.rw,
    rz: m.rz,
    'r (avg)': m.ravg,
    'Calculated mass': { v: m.mass * 1e6, e: NaN },
    'Mass recovery': { v: m.recovery, e: NaN },
  };
  return map[name] ?? null;
}

export function StoredResultsView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  if (!ctx) return null;
  const { experiment: e, processed: p } = ctx;
  const rows = e.storedResults.map((r) => {
    const pr = p.peaks[r.peak - 1];
    const ours = pr && (!r.instrumentClass || r.instrumentClass === ' ' || r.category === 12) ? ourValue(r.name, pr.moments) : null;
    return [
      r.name,
      r.peak || '—',
      r.instrumentClass.replace(/^W|Profile$/g, '') || '—',
      r.index ? `ch ${r.index}` : '',
      r.unableToCalculate ? 'unable to calculate' : pm(r.value, r.uncertainty || undefined),
      r.unit,
      ours ? pm(ours.v, ours.e) : '',
    ];
  });
  return (
    <ViewFrame
      tab={tab}
      messages={[
        'Values stored in the file by ASTRA the last time it processed this experiment, with ASTRA’s own settings at that time. The right-hand column shows the OpenMALS result for the current processing parameters (where comparable).',
      ]}
      main={<DataTable head={['Result', 'Peak', 'Instrument', 'Index', 'ASTRA value', 'Unit', 'OpenMALS (current)']} rows={rows} />}
    />
  );
}

export function LogView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  if (!ctx) return null;
  const rows = ctx.experiment.log.map((l) => [l.time, l.event, <span style={{ whiteSpace: 'pre-wrap' }}>{l.details}</span>]);
  return <ViewFrame tab={tab} main={<DataTable head={['Time', 'Event', 'Details']} rows={rows} />} />;
}

export function FileContentsView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  if (!ctx) return null;
  const e = ctx.experiment;
  const series = e.series.map((s) => [s.id, s.kind, s.instrumentClass, s.time.length, `${num(s.time[0])} – ${num(s.time[s.time.length - 1])}`, s.units, s.baselineName ?? '']);
  const tables = e.tables.filter((t) => t.rows > 0).map((t) => [t.name, t.rows]);
  return (
    <ViewFrame
      tab={tab}
      main={<DataTable head={['Signal', 'Kind', 'Instrument profile', 'Points', 'Time range (min)', 'Units', 'ASTRA series name']} rows={series} />}
      bottom={<DataTable head={['SQLite table (non-empty)', 'Rows']} rows={tables} />}
      bottomFraction={0.45}
    />
  );
}

export function EasiTableView({ tab }: { tab: Tab }) {
  const experiments = useStore((s) => s.experiments);
  const [quantity, setQuantity] = useState<'summary' | 'all'>('summary');
  const processed = experiments.map((x) => processedFor(x.experiment, x.method));
  const allPeaks = processed.flatMap((p) => p.peaks.map((pr) => ({ p, pr })));
  const groups = activeLines(allPeaks.map((x) => x.pr));
  const summary = new Set(['Mn', 'Mw', 'Mz', 'Mw/Mn', 'rz', 'Calculated mass', 'Mass recovery', '[η]w', 'Rh (w)']);
  const lines = groups.flatMap((g) => g.lines).filter((l) => quantity === 'all' || summary.has(l.label));
  const head = ['Experiment', 'Peak', ...lines.map((l) => `${l.label}${l.unit ? ` (${l.unit})` : ''}`)];
  const rows = allPeaks.map(({ p, pr }) => [p.experiment.name, pr.peak.name, ...lines.map((l) => formatResult(l, l.get(pr.moments, pr)))]);
  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolLabel>Columns:</ToolLabel>
          <ToolSelect value={quantity} options={[{ value: 'summary', label: 'Summary' }, { value: 'all', label: 'All results' }]} onChange={setQuantity} />
          <ToolButton icon={<IconExport />} onClick={exportResultsCSV}>
            Export CSV
          </ToolButton>
        </>
      }
      main={experiments.length ? <DataTable head={head} rows={rows} /> : <div className="placeholder">Open one or more experiments to compare their results.</div>}
    />
  );
}
