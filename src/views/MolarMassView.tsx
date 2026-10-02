import { useMemo, useState } from 'react';
import type { Tab } from '../store';
import type { LSModel, Peak } from '../analysis/method';
import { sliceFitAt } from '../analysis/pipeline';
import { polyval } from '../analysis/math';
import type { ChartSeries } from '../chart/types';
import { ChartPane, ToolButton, ToolHint, ToolLabel, ToolSelect, ToolSep, ViewFrame, useViewKeys } from '../ui/ViewFrame';
import { IconNext, IconPrev } from '../ui/icons';
import { PropertyGrid, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { pm } from '../ui/format';
import { familyTraces } from './PeaksView';

export function MolarMassView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [peakIdx, setPeakIdx] = useState(0);
  const [slice, setSlice] = useState<number | null>(null);
  const [vis, setVis] = useState<Record<string, boolean>>({ VIS: false });
  const processed = ctx?.processed;
  const peaks = processed?.peaks ?? [];
  const pi = Math.max(0, Math.min(peakIdx, peaks.length - 1));
  const pr = peaks[pi];

  // Default slice of every peak: its concentration apex.
  const apexes = useMemo(
    () =>
      peaks.map((p) => {
        let best = 0;
        for (let k = 0; k < p.c.length; k++) if (p.c[k] > p.c[best]) best = k;
        return p.i0 + best;
      }),
    [peaks],
  );
  const cur = pr ? Math.max(pr.i0, Math.min(pr.i1, slice ?? apexes[pi])) : 0;

  const goPeak = (i: number, at?: number) => {
    if (!peaks.length) return;
    const k = Math.max(0, Math.min(peaks.length - 1, i));
    setPeakIdx(k);
    setSlice(at ?? null);
  };
  /** Move the cursor by d slices; past the end of a peak it continues into the next one. */
  const step = (d: number) => {
    if (!pr) return;
    const to = cur + d;
    if (to > pr.i1 && pi < peaks.length - 1) goPeak(pi + 1, peaks[pi + 1].i0);
    else if (to < pr.i0 && pi > 0) goPeak(pi - 1, peaks[pi - 1].i1);
    else setSlice(Math.max(pr.i0, Math.min(pr.i1, to)));
  };
  /** Cursor to time x: selects the peak under x (or the nearest one). */
  const moveTo = (t: Float64Array, x: number) => {
    if (!peaks.length) return;
    let k = peaks.findIndex((p) => x >= p.peak.start && x <= p.peak.end);
    if (k < 0) {
      let best = Infinity;
      peaks.forEach((p, i) => {
        const d = Math.min(Math.abs(x - p.peak.start), Math.abs(x - p.peak.end));
        if (d < best) [best, k] = [d, i];
      });
    }
    const p = peaks[k];
    goPeak(k, Math.max(p.i0, Math.min(p.i1, nearest(t, x))));
  };
  useViewKeys((ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || !pr) return;
    const big = ev.shiftKey ? 10 : 1;
    if (ev.key === 'ArrowLeft') step(-big);
    else if (ev.key === 'ArrowRight') step(big);
    else if (ev.key === 'PageUp') step(-25);
    else if (ev.key === 'PageDown') step(25);
    else if (ev.key === 'Home') setSlice(pr.i0);
    else if (ev.key === 'End') setSlice(pr.i1);
    else if (ev.key === 'ArrowUp') goPeak(pi - 1);
    else if (ev.key === 'ArrowDown') goPeak(pi + 1);
    else return false;
    return true;
  });

  if (!ctx || !processed) return null;
  const { method, update } = ctx;
  if (!pr) {
    return <ViewFrame tab={tab} messages={['No peaks are defined. Define peaks in the Peaks procedure first.']} main={<div className="placeholder" />} />;
  }

  const sf = sliceFitAt(processed, pr.index, cur);
  const fit = sf?.fit;
  const setPeak = (patch: Partial<Peak>) =>
    update((m) => ({ ...m, peaks: m.peaks.map((p, i) => (i === pr.index ? { ...p, ...patch } : p)) }));

  const resultSeries: ChartSeries[] = [];
  if (fit) {
    resultSeries.push({ id: 'data', label: 'data', x: fit.x, y: fit.y, color: '#000', style: 'markers', markerSize: 2.5, hideInLegend: true });
    if (fit.fit) {
      const xs = Array.from({ length: 41 }, (_, i) => (i / 40) * Math.max(1, ...fit.x));
      resultSeries.push({ id: 'fit', label: 'fit', x: xs, y: xs.map((x) => polyval(fit.fit!.p, x)), color: '#ff0000', style: 'line', hideInLegend: true });
    }
  }

  const messages = [...pr.warnings];
  if (sf && !(sf.c > 0)) messages.push('Concentration is not positive at this slice. Molar mass cannot be computed without the concentration.');
  if (fit && fit.fit && !Number.isFinite(fit.rg) && fit.M > 0) messages.push('The angular dependence gives a negative mean-square radius at this slice (radius below the detection limit or detectors not normalized).');

  const detRows: PGRow[] = method.ls.angles.map((a, j) => ({
    key: `det${j}`,
    label: `${processed.lsIds[j] ?? `LS ${j + 1}`}  (${a.toFixed(2)}°)`,
    cells: [
      {
        value: method.ls.enabled[j] !== false,
        kind: 'checkbox',
        onChange: (v) => update((m) => ({ ...m, ls: { ...m.ls, enabled: m.ls.angles.map((_, k) => (k === j ? !!v : m.ls.enabled[k] !== false)) } })),
      },
    ],
  }));

  const rows: PGRow[] = [
    { key: 'M', label: 'Molar Mass', cells: [{ value: pm(fit?.M, fit?.Merr, 'g/mol') }] },
    { key: 'rg', label: 'rms radius', cells: [{ value: pm(fit?.rg, fit?.rgErr, 'nm', 1) }] },
    {
      key: 'peak',
      label: 'Peak Number',
      cells: [{ value: String(pi + 1), kind: 'select', options: processed.peaks.map((p, i) => ({ value: String(i + 1), label: `${i + 1} (${p.peak.name})` })), onChange: (v) => goPeak(Number(v) - 1) }],
    },
    { key: 'slice', label: 'Slice Index', cells: [{ value: cur + 1, kind: 'number', digits: 0, onChange: (v) => setSlice(Math.round(Number(v)) - 1) }] },
    { key: 'pos', label: 'Slice in Peak', cells: [{ value: `${cur - pr.i0 + 1} of ${pr.i1 - pr.i0 + 1}` }] },
    { key: 'model', label: 'Model', cells: [{ value: pr.peak.lsModel, kind: 'select', options: ['Zimm', 'Debye', 'Berry'], onChange: (v) => setPeak({ lsModel: v as LSModel }) }] },
    { key: 'deg', label: 'Fit Degree', cells: [{ value: String(pr.peak.fitDegree), kind: 'select', options: ['1', '2', '3'], onChange: (v) => setPeak({ fitDegree: Number(v) }) }] },
    { key: 'abs', label: 'Abscissa Position', cells: [{ value: `${processed.t[cur].toFixed(3)} min` }] },
    { key: 'conc', label: 'Concentration', cells: [{ value: pm(sf ? sf.c * 1000 : NaN, undefined, 'mg/mL') }] },
    { key: 'dndc', label: 'dn/dc (mL/g)', cells: [{ value: pr.peak.dndc, kind: 'number', digits: 4, onChange: (v) => setPeak({ dndc: Number(v) }) }] },
    { key: 'r2', label: 'Fit R²', cells: [{ value: fit?.r2, digits: 4 }] },
    { key: 'det', label: 'Enabled Detectors', children: detRows },
  ];

  const control = familyTraces(processed, (id) => vis[id] ?? true);
  const peakOptions = processed.peaks.map((p, i) => ({ value: i, label: `${i + 1}: ${p.peak.name}` }));
  return (
    <ViewFrame
      tab={tab}
      messages={messages}
      toolbar={
        <>
          <ToolLabel>Peak:</ToolLabel>
          <ToolButton icon={<IconPrev />} onClick={() => goPeak(pi - 1)} disabled={pi === 0} title="Previous peak (↑)" />
          <ToolSelect value={pi} options={peakOptions} onChange={(v) => goPeak(v)} width={150} />
          <ToolButton icon={<IconNext />} onClick={() => goPeak(pi + 1)} disabled={pi >= processed.peaks.length - 1} title="Next peak (↓)" />
          <ToolSep />
          <ToolLabel>Slice:</ToolLabel>
          <ToolButton icon={<IconPrev />} onClick={() => step(-1)} title="Previous slice (←, Shift+← = 10 slices)" />
          <span className="tool-readout">
            {cur + 1} · {processed.t[cur].toFixed(3)} min
          </span>
          <ToolButton icon={<IconNext />} onClick={() => step(1)} title="Next slice (→, Shift+→ = 10 slices)" />
          <ToolButton onClick={() => setSlice(null)} title="Back to the concentration maximum of the peak">
            Apex
          </ToolButton>
          <ToolHint>
            ←/→ scan slices (Shift ×10) · ↑/↓ change peak · Home/End peak limits · click a peak to jump there
          </ToolHint>
        </>
      }
      main={
        <div className="split-h">
          <ChartPane
            title={`results graph: ${pr.peak.name}, slice ${cur + 1}`}
            primary={false}
            series={resultSeries}
            legend="none"
            xAxis={{ label: 'sin²(θ/2)', min: 0, max: 1 }}
            yAxis={{ label: fit?.yLabel ?? 'K*c/R(θ)' }}
            footerRight={fit?.fit ? `Fit R²=${fit.r2.toFixed(4)}` : undefined}
          />
          <ChartPane
            title="control graph"
            series={control}
            relativeScale
            legend="top"
            regions={processed.peaks.map((p, i) => ({ id: p.peak.id, x1: p.peak.start, x2: p.peak.end, label: p.peak.name, selected: i === pi }))}
            markers={[{ id: 'slice', x: processed.t[cur], draggable: true, color: '#000' }]}
            xAxis={{ label: 'time (min)' }}
            yAxis={{ label: 'Relative Scale' }}
            footerRight={`Index = ${processed.t[cur].toFixed(3)} min`}
            onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
            onClick={(x) => moveTo(processed.t, x)}
            onMarkerChange={(_, x) => moveTo(processed.t, x)}
          />
        </div>
      }
      bottom={<PropertyGrid columns={['Value']} rows={rows} columnWidth={260} />}
      bottomFraction={0.36}
    />
  );
}

function nearest(t: Float64Array, x: number): number {
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(t[lo] - x) <= Math.abs(t[hi] - x) ? lo : hi;
}
