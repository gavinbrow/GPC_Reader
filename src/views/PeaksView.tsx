import { useRef, useState } from 'react';
import { useStore, type Tab } from '../store';
import { makePeak, type LSModel, type Method, type Peak } from '../analysis/method';
import { autoPeaks } from '../analysis/signal';
import type { Processed } from '../analysis/pipeline';
import type { ChartHandle, ChartRegion, ChartSeries } from '../chart/types';
import { ChartPane, GraphModeTools, ToolButton, ToolHint, ToolSep, ViewFrame, useViewKeys, type GraphMode } from '../ui/ViewFrame';
import { PropertyGrid, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { familyLabel, seriesColor, seriesStyle } from '../ui/series';
import { IconAutofind, IconTrash } from '../ui/icons';
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
  const [mode, setMode] = useState<GraphMode>('draw');
  const chart = useRef<ChartHandle>(null);
  const nPeaks = ctx?.method.peaks.length ?? 0;
  const cur = Math.max(0, Math.min(sel, nPeaks - 1));

  const deletePeak = (i: number) => {
    if (!ctx || i < 0 || i >= ctx.method.peaks.length) return;
    const name = ctx.method.peaks[i].name;
    ctx.update((m) => {
      const peaks = m.peaks.filter((_, k) => k !== i);
      return { ...m, peaks, normalization: { ...m.normalization, peakId: peaks.some((p) => p.id === m.normalization.peakId) ? m.normalization.peakId : peaks[0]?.id } };
    });
    setSel(Math.max(0, Math.min(i, ctx.method.peaks.length - 2)));
    useStore.getState().setStatus(`${name} deleted (Ctrl+Z to undo)`);
  };
  useViewKeys((ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || !nPeaks) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') deletePeak(cur);
    else if (ev.key === 'ArrowLeft') setSel(Math.max(0, cur - 1));
    else if (ev.key === 'ArrowRight') setSel(Math.min(nPeaks - 1, cur + 1));
    else return false;
    return true;
  });

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
  const addPeak = (x1: number, x2: number) => {
    setSel(method.peaks.length);
    update((m) => {
      const pk = makePeak(e, Math.min(x1, x2), Math.max(x1, x2), m.peaks[m.peaks.length - 1], m.peaks.length + 1);
      return {
        ...m,
        peaks: [...m.peaks, pk],
        massFit: { ...m.massFit, [pk.id]: { model: 'None', order: 1 } },
        radiusFit: { ...m.radiusFit, [pk.id]: { model: 'None', order: 1 } },
        distribution: { ...m.distribution, ranges: { ...m.distribution.ranges, [pk.id]: [] } },
        normalization: m.normalization.peakId ? m.normalization : { ...m.normalization, peakId: pk.id },
      };
    });
  };
  const autofind = () => {
    const id = processed.concSeriesId ?? (processed.series.dRI ? 'dRI' : ls90Id(processed));
    if (!id) return;
    const found = autoPeaks(processed.t, processed.series[id].aligned);
    if (!found.length) {
      useStore.getState().setStatus('Autofind found no peaks');
      return;
    }
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
    useStore.getState().setStatus(`Autofind found ${found.length} peak${found.length > 1 ? 's' : ''}`);
  };

  const regions: ChartRegion[] = method.peaks.map((p, i) => {
    const d = dragging?.id === p.id ? dragging : null;
    return { id: p.id, x1: d ? d.x1 : p.start, x2: d ? d.x2 : p.end, label: p.name, editable: true, selected: i === cur };
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
          <GraphModeTools mode={mode} setMode={setMode} drawLabel="Draw Peak" drawTitle="Drag on the graph to add a peak" chart={chart} />
          <ToolSep />
          <ToolButton icon={<IconTrash />} onClick={() => deletePeak(cur)} disabled={!method.peaks.length} title="Delete the selected peak (Del)">
            Delete Peak
          </ToolButton>
          <ToolHint>Drag to add a peak · drag edges to adjust · click a peak or its number to select · Del deletes</ToolHint>
        </>
      }
      main={
        <ChartPane
          ref={chart}
          title="Define Peaks"
          series={series}
          relativeScale
          legend="top"
          mode={mode}
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
          <PropertyGrid
            columns={method.peaks.map((_, i) => String(i + 1))}
            rows={peakRows(method, setPeak)}
            labelWidth={270}
            columnWidth={150}
            selectedColumn={cur}
            onSelectColumn={setSel}
            onDeleteColumn={deletePeak}
            columnTitle="Click to select this peak; Del deletes it"
          />
        ) : (
          <div className="placeholder">No peaks defined. Drag on the graph to add one, or use Autofind Peaks.</div>
        )
      }
      bottomFraction={0.4}
    />
  );
}
