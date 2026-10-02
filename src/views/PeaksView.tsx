import { useState } from 'react';
import type { Tab } from '../store';
import { makePeak, type LSModel, type Method, type Peak } from '../analysis/method';
import { autoPeaks } from '../analysis/signal';
import type { Processed } from '../analysis/pipeline';
import type { ChartRegion, ChartSeries } from '../chart/types';
import { ChartPane, ToolButton, ToolSep, ViewFrame } from '../ui/ViewFrame';
import { PropertyGrid, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { familyLabel, seriesColor, seriesStyle } from '../ui/series';
import { IconAutofind, IconMinus, IconPlus } from '../ui/icons';
import { ls90Id } from '../analysis/calibration';

/** One representative aligned trace per detector family (LS 90°, UV, dRI, VIS) for relative-scale graphs. */
export function familyTraces(p: Processed, visible?: (id: string) => boolean): ChartSeries[] {
  const ids: string[] = [];
  const l90 = ls90Id(p);
  if (l90) ids.push(l90);
  const uv = `UV ${p.method.uvChannel + 1}`;
  if (p.series[uv]) ids.push(uv);
  if (p.series.dRI) ids.push('dRI');
  if (p.series.VIS) ids.push('VIS');
  return ids.map((id) => {
    const s = p.series[id].raw;
    const label = familyLabel(s);
    return {
      id: label,
      label,
      x: p.t,
      y: p.series[id].aligned,
      color: seriesColor(s, s.kind === 'LS'),
      style: seriesStyle(s),
      visible: visible ? visible(label) : true,
    };
  });
}

/** Mass in µg ↔ g, concentration mg/mL ↔ g/mL conversions are handled through `scale`. */
export function peakRows(m: Method, setPeak: (i: number, patch: Partial<Peak>) => void): PGRow[] {
  const col = <K extends keyof Peak>(key: K, opts: { digits?: number; scale?: number; kind?: 'number' | 'text' | 'select'; options?: string[] } = {}) =>
    m.peaks.map((p, i) => ({
      value: p[key] as never,
      kind: opts.kind ?? (typeof p[key] === 'number' ? 'number' : 'text'),
      digits: opts.digits,
      scale: opts.scale,
      options: opts.options,
      onChange: (v: string | number | boolean) => setPeak(i, { [key]: opts.kind === 'select' && typeof p[key] === 'number' ? Number(v) : v } as Partial<Peak>),
    }));
  return [
    { key: 'name', label: 'Name', cells: col('name') },
    { key: 'start', label: 'Start (min)', cells: col('start', { digits: 4 }) },
    { key: 'end', label: 'Stop (min)', cells: col('end', { digits: 4 }) },
    { key: 'dndc', label: 'dn/dc (mL/g)', cells: col('dndc', { digits: 4 }) },
    { key: 'uv', label: 'UV Ext. Coef. (mL/(mg cm))', cells: col('uvExtinction', { digits: 4 }) },
    { key: 'mass', label: 'Injected Mass (µg)', cells: col('injectedMass', { digits: 3, scale: 1e6 }) },
    { key: 'conc', label: 'Concentration (mg/mL)', cells: col('concentration', { digits: 3, scale: 1e3 }) },
    { key: 'a2', label: 'A2 (mol mL/g²)', cells: col('a2', { digits: 6 }) },
    {
      key: 'ls',
      label: 'LS Analysis',
      defaultOpen: true,
      children: [
        { key: 'model', label: 'Model', cells: col('lsModel', { kind: 'select', options: ['Zimm', 'Debye', 'Berry'] }) },
        { key: 'deg', label: 'Fit Degree', cells: col('fitDegree', { kind: 'select', options: ['1', '2', '3'] }) },
      ],
    },
    {
      key: 'norm',
      label: 'Normalization',
      children: [{ key: 'rad', label: 'Radius (nm)', cells: col('radius', { digits: 2 }), title: 'rms radius assumed when this peak is used to normalise the detectors' }],
    },
    {
      key: 'vis',
      label: 'Viscosity Analysis',
      children: [
        { key: 'mhk', label: 'Mark-Houwink K (mL/g)', cells: col('mhsK', { digits: 6 }) },
        { key: 'mha', label: 'Mark-Houwink a', cells: col('mhsA', { digits: 4 }) },
      ],
    },
  ];
}

export function PeaksView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [sel, setSel] = useState(0);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<{ id: string; x1: number; x2: number } | null>(null);
  if (!ctx) return null;
  const { experiment: e, method, processed, update } = ctx;

  const setPeak = (i: number, patch: Partial<Peak>) =>
    update((m) => {
      const peaks = m.peaks.slice();
      const p = { ...peaks[i], ...patch };
      if (typeof patch.fitDegree === 'string') p.fitDegree = Number(patch.fitDegree);
      if (patch.lsModel) p.lsModel = patch.lsModel as LSModel;
      if (p.start > p.end) [p.start, p.end] = [p.end, p.start];
      peaks[i] = p;
      return { ...m, peaks };
    });
  const addPeak = (x1: number, x2: number) =>
    update((m) => {
      const pk = makePeak(e, Math.min(x1, x2), Math.max(x1, x2), m.peaks[m.peaks.length - 1], m.peaks.length + 1);
      setSel(m.peaks.length);
      return {
        ...m,
        peaks: [...m.peaks, pk],
        massFit: { ...m.massFit, [pk.id]: { model: 'None', order: 1 } },
        radiusFit: { ...m.radiusFit, [pk.id]: { model: 'None', order: 1 } },
        distribution: { ...m.distribution, ranges: { ...m.distribution.ranges, [pk.id]: [] } },
        normalization: m.normalization.peakId ? m.normalization : { ...m.normalization, peakId: pk.id },
      };
    });
  const deletePeak = (i: number) =>
    update((m) => {
      const peaks = m.peaks.filter((_, k) => k !== i);
      setSel(Math.max(0, Math.min(sel, peaks.length - 1)));
      return { ...m, peaks, normalization: { ...m.normalization, peakId: peaks.some((p) => p.id === m.normalization.peakId) ? m.normalization.peakId : peaks[0]?.id } };
    });
  const autofind = () => {
    const id = processed.concSeriesId ?? (processed.series.dRI ? 'dRI' : ls90Id(processed));
    if (!id) return;
    const found = autoPeaks(processed.t, processed.series[id].aligned);
    if (!found.length) return;
    update((m) => {
      const peaks = found.map(([a, b], i) => ({ ...(m.peaks[i] ?? makePeak(e, a, b, m.peaks[0], i + 1)), start: a, end: b, name: m.peaks[i]?.name ?? `Peak ${i + 1}` }));
      const massFit = { ...m.massFit };
      const radiusFit = { ...m.radiusFit };
      const ranges = { ...m.distribution.ranges };
      for (const p of peaks) {
        massFit[p.id] ??= { model: 'None', order: 1 };
        radiusFit[p.id] ??= { model: 'None', order: 1 };
        ranges[p.id] ??= [];
      }
      return { ...m, peaks, massFit, radiusFit, distribution: { ...m.distribution, ranges }, normalization: { ...m.normalization, peakId: m.normalization.peakId ?? peaks[0]?.id } };
    });
  };

  const regions: ChartRegion[] = method.peaks.map((p, i) => {
    const d = dragging?.id === p.id ? dragging : null;
    return { id: p.id, x1: d ? d.x1 : p.start, x2: d ? d.x2 : p.end, label: p.name, editable: true, selected: i === sel };
  });
  const series = familyTraces(processed, (id) => vis[id] ?? true);
  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolButton icon={<IconAutofind />} onClick={autofind} title={`Find peaks in the ${processed.concSeriesId ?? 'concentration'} signal`}>
            Autofind Peaks
          </ToolButton>
          <ToolSep />
          <ToolButton
            icon={<IconPlus />}
            onClick={() => {
              const pr = processed.peaks[sel];
              const w = pr ? pr.peak.end - pr.peak.start : 2;
              const start = pr ? pr.peak.end + 0.1 * w : processed.t[Math.floor(processed.t.length / 2)];
              addPeak(start, start + w);
            }}
            title="Add a peak (or Shift+drag on the graph)"
          >
            Add Peak
          </ToolButton>
          <ToolButton icon={<IconMinus />} onClick={() => deletePeak(sel)} disabled={!method.peaks.length} title="Delete the selected peak">
            Delete Peak
          </ToolButton>
          <span className="muted" style={{ marginLeft: 12 }}>
            Drag peak edges to adjust; Shift+drag to define a new peak; click a peak to select it.
          </span>
        </>
      }
      main={
        <ChartPane
          title="Define Peaks"
          series={series}
          relativeScale
          legend="top"
          regions={regions}
          xAxis={{ label: 'time (min)' }}
          yAxis={{ label: 'Relative Scale' }}
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
          onRegionChange={(id, x1, x2, done) => {
            const i = method.peaks.findIndex((p) => p.id === id);
            if (i < 0) return;
            setSel(i);
            if (done) {
              setDragging(null);
              setPeak(i, { start: x1, end: x2 });
            } else setDragging({ id, x1, x2 });
          }}
          onCreateRegion={addPeak}
          onClick={(x) => {
            const i = method.peaks.findIndex((p) => x >= p.start && x <= p.end);
            if (i >= 0) setSel(i);
          }}
        />
      }
      bottom={
        method.peaks.length ? (
          <PropertyGrid columns={method.peaks.map((_, i) => String(i + 1))} rows={peakRows(method, setPeak)} labelWidth={270} columnWidth={150} />
        ) : (
          <div className="placeholder">No peaks defined. Use Autofind Peaks or Shift+drag on the graph.</div>
        )
      }
      bottomFraction={0.4}
    />
  );
}
