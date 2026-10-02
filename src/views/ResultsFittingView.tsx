import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Tab } from '../store';
import type { FitModel, Method, ResultsFit } from '../analysis/method';
import type { PeakResult, Processed } from '../analysis/pipeline';
import { distributionOf, type DistributionCurve } from '../analysis/distribution';
import type { ChartRegion, ChartSeries } from '../chart/types';
import { ChartPane, ToolButton, ToolLabel, ToolSelect, ToolSep, ViewFrame } from '../ui/ViewFrame';
import { PropertyGrid, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { pm } from '../ui/format';
import { familyTraces } from './PeaksView';

/* ------------------------------------------------------------------ */
/* Helpers shared by the graph-oriented results views                  */
/* ------------------------------------------------------------------ */

/** Distinct colours for peaks / experiments (first one is ASTRA's black). */
export const PEAK_COLORS = ['#000000', '#d81b60', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#7cb342', '#546e7a'];
/** Colours for fitted curves (first one is ASTRA's red). */
export const FIT_COLORS = ['#ff0000', '#ad1457', '#0d47a1', '#1b5e20', '#e65100', '#4a148c', '#006064', '#3e2723', '#33691e', '#263238'];

export const peakColor = (i: number) => PEAK_COLORS[i % PEAK_COLORS.length];
export const fitColor = (i: number) => FIT_COLORS[i % FIT_COLORS.length];

/**
 * LS / UV / RI (/ VIS) traces, each on its own hidden autoscaled axis so that
 * they can be overlaid with absolute-valued results (molar mass, radius …).
 * VIS is hidden unless the caller says otherwise.
 */
export function relativeTraces(p: Processed, vis: Record<string, boolean>): ChartSeries[] {
  return familyTraces(p, (id) => vis[id] ?? id !== 'VIS').map((s) => ({
    ...s,
    label: s.label === 'dRI' ? 'RI' : s.label,
    axis: `rel:${s.id}`,
    lineWidth: 1,
  }));
}

/** Keep only the entries of two parallel arrays that lie inside [lo, hi]. */
export function sliceRange(x: ArrayLike<number>, y: ArrayLike<number>, lo: number, hi: number): [number[], number[]] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] >= lo && x[i] <= hi) {
      xs.push(x[i]);
      ys.push(y[i]);
    }
  }
  return [xs, ys];
}

/**
 * Molar mass / radius per slice as used by the results: the fitted values
 * inside the fit range, NaN outside it (a polynomial extrapolated beyond the
 * fit range is meaningless and must not enter distributions or plots).
 */
export function windowed(pr: PeakResult, kind: 'mass' | 'radius'): Float64Array {
  const fit = kind === 'mass' ? pr.massFit : pr.radiusFit;
  const v = kind === 'mass' ? pr.Mused : pr.rgUsed;
  if (!fit) return v;
  return v.map((y, i) => (pr.t[i] >= fit.start && pr.t[i] <= fit.end ? y : NaN));
}

/** Weight-fraction distribution restricted to the fit range. */
export function peakDistribution(pr: PeakResult, kind: 'mass' | 'radius'): DistributionCurve | null {
  return distributionOf(pr.t, pr.c, windowed(pr, kind), !!(kind === 'mass' ? pr.massFit : pr.radiusFit));
}

export function PeakSelect({ peaks, value, onChange }: { peaks: PeakResult[]; value: number; onChange: (i: number) => void }) {
  return (
    <>
      <ToolLabel>Peak:</ToolLabel>
      <ToolSelect value={value} options={peaks.map((p, i) => ({ value: i, label: p.peak.name || `Peak ${i + 1}` }))} onChange={onChange} width={110} />
    </>
  );
}

export function EmptyView({ tab, text, toolbar }: { tab: Tab; text: ReactNode; toolbar?: ReactNode }) {
  return <ViewFrame tab={tab} toolbar={toolbar} main={<div className="placeholder">{text}</div>} />;
}

/** Time range where the concentration exceeds `frac` of its maximum (a sensible default fit range). */
function mainPeakRange(pr: PeakResult, frac = 0.05): [number, number] | null {
  let cmax = 0;
  for (const c of pr.c) if (c > cmax) cmax = c;
  if (!(cmax > 0)) return null;
  let a = -1;
  let b = -1;
  for (let i = 0; i < pr.c.length; i++) {
    if (pr.c[i] >= frac * cmax) {
      if (a < 0) a = i;
      b = i;
    }
  }
  return a >= 0 && b > a ? [pr.t[a], pr.t[b]] : null;
}

/* ------------------------------------------------------------------ */
/* Results Fitting                                                     */
/* ------------------------------------------------------------------ */

type Display = 'Molar Mass' | 'rms radius';
const MODELS: FitModel[] = ['None', 'Polynomial', 'Exponential'];
const NO_FIT: ResultsFit = { model: 'None', order: 1 };

export function ResultsFittingView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [peakIdx, setPeakIdx] = useState(0);
  const [display, setDisplay] = useState<Display>('Molar Mass');
  const [log, setLog] = useState(true);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<{ x1: number; x2: number } | null>(null);
  if (!ctx) return null;
  const { method, processed, update } = ctx;
  const pr = processed.peaks[Math.min(peakIdx, processed.peaks.length - 1)];
  if (!pr) {
    return <EmptyView tab={tab} text="No peaks are defined. Define peaks in the Peaks procedure first." />;
  }

  const isMass = display === 'Molar Mass';
  const key = isMass ? 'massFit' : 'radiusFit';
  const peakId = pr.peak.id;
  const cfg: ResultsFit = method[key][peakId] ?? NO_FIT;
  const fit = isMass ? pr.massFit : pr.radiusFit;
  const values = isMass ? pr.M : pr.rg;
  const active = cfg.model !== 'None';
  const fStart = cfg.start ?? pr.peak.start;
  const fEnd = cfg.end ?? pr.peak.end;

  const setFit = (patch: Partial<ResultsFit>) => update((m: Method) => ({ ...m, [key]: { ...m[key], [peakId]: { ...(m[key][peakId] ?? NO_FIT), ...patch } } }));
  /** Enabling a model on an unset range starts with the part of the peak above 5 % of the maximum concentration. */
  const setModel = (model: FitModel) => {
    const r = model !== 'None' && cfg.start === undefined && cfg.end === undefined ? mainPeakRange(pr) : null;
    setFit(r ? { model, start: r[0], end: r[1] } : { model });
  };
  const setRange = (a: number, b: number) => setFit({ start: Math.min(a, b), end: Math.max(a, b) });

  const quantity = isMass ? 'Molar Mass' : 'rms radius';
  const series: ChartSeries[] = [
    ...relativeTraces(processed, vis),
    { id: 'values', label: `${quantity} ${pr.index + 1}`, x: pr.t, y: values, color: '#000', style: 'markers', markerSize: 2, visible: vis.values ?? true },
  ];
  if (fit && active) {
    const [fx, fy] = sliceRange(pr.t, fit.values, fit.start, fit.end);
    series.push({ id: 'fit', label: 'Fit', x: fx, y: fy, color: '#ff0000', style: 'line', lineWidth: 1.5, visible: vis.fit ?? true });
  }

  const region: ChartRegion = { id: 'fit', x1: drag?.x1 ?? fStart, x2: drag?.x2 ?? fEnd, kind: 'flat', color: '#9ec3ea', editable: true };
  const w = pr.peak.end - pr.peak.start;

  const mo = pr.moments;
  const rows: PGRow[] = [
    {
      key: 'model',
      label: 'Model',
      cells: [{ value: cfg.model, kind: 'select', options: MODELS, onChange: (v) => setModel(v as FitModel) }],
    },
    {
      key: 'order',
      label: 'Order',
      cells:
        cfg.model === 'Polynomial'
          ? [{ value: String(cfg.order), kind: 'select', options: ['1', '2', '3', '4', '5'], onChange: (v) => setFit({ order: Number(v) }) }]
          : [{ value: cfg.model === 'Exponential' ? '1' : '-' }],
    },
    { key: 'start', label: 'Fit Range Start (min)', cells: [{ value: fStart, kind: 'number', digits: 4, onChange: (v) => setRange(Number(v), fEnd) }] },
    { key: 'end', label: 'Fit Range Stop (min)', cells: [{ value: fEnd, kind: 'number', digits: 4, onChange: (v) => setRange(fStart, Number(v)) }] },
    { key: 'r2', label: 'Fit R²', cells: [{ value: fit ? fit.r2.toFixed(4) : active ? 'n/a' : '-' }] },
    ...(isMass
      ? [
          { key: 'Mn', label: 'Mn', cells: [{ value: pm(mo.Mn.v, mo.Mn.e, 'g/mol') }] },
          { key: 'Mw', label: 'Mw', cells: [{ value: pm(mo.Mw.v, mo.Mw.e, 'g/mol') }] },
          { key: 'Mz', label: 'Mz', cells: [{ value: pm(mo.Mz.v, mo.Mz.e, 'g/mol') }] },
          { key: 'pd', label: 'Mw/Mn', cells: [{ value: pm(mo.MwMn.v, mo.MwMn.e, '', 3) }] },
        ]
      : [
          { key: 'rn', label: 'rn', cells: [{ value: pm(mo.rn.v, mo.rn.e, 'nm', 1) }] },
          { key: 'rw', label: 'rw', cells: [{ value: pm(mo.rw.v, mo.rw.e, 'nm', 1) }] },
          { key: 'rz', label: 'rz', cells: [{ value: pm(mo.rz.v, mo.rz.e, 'nm', 1) }] },
        ]),
  ];

  const messages = [...pr.warnings];
  if (active && !fit) messages.push('The fit could not be computed: too few valid slices with positive concentration in the fit range.');

  const pad = 0.1 * w;
  return (
    <ViewFrame
      tab={tab}
      messages={messages}
      toolbar={
        <>
          <ToolLabel>Display:</ToolLabel>
          <ToolSelect value={display} options={['Molar Mass', 'rms radius'] as Display[]} onChange={setDisplay} width={110} />
          <ToolLabel>Model:</ToolLabel>
          <ToolSelect value={cfg.model} options={MODELS} onChange={setModel} width={100} />
          <ToolLabel>Order:</ToolLabel>
          <select
            className="tool-select"
            style={{ width: 48 }}
            disabled={cfg.model !== 'Polynomial'}
            value={cfg.model === 'Polynomial' ? String(cfg.order) : '0'}
            onChange={(e) => setFit({ order: Number(e.target.value) })}
          >
            {cfg.model !== 'Polynomial' && <option value="0">{cfg.model === 'Exponential' ? '1' : '0'}</option>}
            {[1, 2, 3, 4, 5].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <ToolSep />
          <ToolButton pressed={log} onClick={() => setLog((v) => !v)} title="Logarithmic y axis">
            <i>log</i>
          </ToolButton>
          <ToolSep />
          <PeakSelect peaks={processed.peaks} value={pr.index} onChange={setPeakIdx} />
          <span className="muted" style={{ marginLeft: 12 }}>
            Drag the blue region to change the fit range.
          </span>
        </>
      }
      main={
        <ChartPane
          title="Results Fitting"
          series={series}
          legend="top"
          regions={[region]}
          resetKey={pr.index * 10 + (isMass ? 0 : 1)}
          xAxis={{ label: 'time (min)', min: pr.peak.start - pad, max: pr.peak.end + pad }}
          yAxis={{ label: isMass ? 'Molar Mass (g/mol)' : 'rms radius (nm)', log }}
          footerRight={fit && active ? `Fit R²=${fit.r2.toFixed(4)}` : undefined}
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
          onRegionChange={(_, x1, x2, done) => {
            if (done) {
              setDrag(null);
              setRange(x1, x2);
            } else setDrag({ x1, x2 });
          }}
        />
      }
      bottom={<PropertyGrid columns={['Value']} rows={rows} columnWidth={240} />}
      bottomFraction={0.3}
    />
  );
}
