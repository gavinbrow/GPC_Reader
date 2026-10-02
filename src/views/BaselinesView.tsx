import { useMemo, useRef, useState } from 'react';
import type { Tab } from '../store';
import type { Baseline, BaselineStyle } from '../analysis/method';
import { autoBaseline, snapBaseline } from '../analysis/signal';
import { despiked } from '../analysis/pipeline';
import type { ChartHandle, ChartSegment } from '../chart/types';
import { ChartPane, GraphModeTools, ToolButton, ToolHint, ToolLabel, ToolSelect, ToolSep, ViewFrame, useViewKeys, type GraphMode } from '../ui/ViewFrame';
import { NumberInput } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { toChartSeries } from '../ui/series';
import { IconAutofind, IconFit, IconNext, IconPrev } from '../ui/icons';

/**
 * Baselines: one signal is shown at a time. Pick it in the signal list, with
 * the arrows, or with ↑/↓; a plain drag on the graph sets that signal's
 * baseline range and the end points can be dragged.
 */
export function BaselinesView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const e = ctx?.experiment;
  const analysable = useMemo(() => (e ? e.series.filter((s) => s.analysable) : []), [e]);
  const ls90 = analysable.find((s) => s.kind === 'LS' && s.defaultVisible) ?? analysable[0];
  const [source, setSource] = useState<string>(ls90?.id ?? '');
  const [drag, setDrag] = useState<Baseline | null>(null);
  const [mode, setMode] = useState<GraphMode>('draw');
  const chart = useRef<ChartHandle>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const idx = Math.max(0, analysable.findIndex((s) => s.id === source));
  const select = (i: number) => {
    const s = analysable[(i + analysable.length) % analysable.length];
    if (!s) return;
    setSource(s.id);
    setDrag(null);
    rowRefs.current[s.id]?.scrollIntoView({ block: 'nearest' });
  };
  useViewKeys((ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'ArrowDown' || ev.key === 'PageDown') select(idx + 1);
    else if (ev.key === 'ArrowUp' || ev.key === 'PageUp') select(idx - 1);
    else return false;
    return true;
  });

  if (!ctx || !e) return null;
  const { method, processed, update } = ctx;
  const sourceSeries = analysable[idx];
  if (!sourceSeries) return <ViewFrame tab={tab} main={<div className="placeholder">This experiment has no signals that take a baseline.</div>} />;

  const setBaseline = (id: string, b: Baseline) => {
    const s = e.series.find((x) => x.id === id)!;
    const snapped = snapBaseline(s.time, despiked(s, method), b);
    update((m) => ({ ...m, baselines: { ...m.baselines, [id]: snapped } }));
  };
  const autofind = (ids: string[]) => {
    update((m) => {
      const baselines = { ...m.baselines };
      const pk = m.peaks[0];
      for (const id of ids) {
        const s = e.series.find((x) => x.id === id);
        if (!s) continue;
        const b = autoBaseline(id, s.time, despiked(s, m), pk ? [pk.start, pk.end] : undefined);
        if (b) baselines[id] = b;
      }
      return { ...m, baselines };
    });
  };
  const setAll = () => {
    const src = method.baselines[source];
    if (!src) return;
    update((m) => {
      const baselines = { ...m.baselines };
      for (const s of analysable) {
        const b: Baseline = { ...(baselines[s.id] ?? src), seriesId: s.id, x1: src.x1, x2: src.x2, style: 'Snap-Y' };
        baselines[s.id] = snapBaseline(s.time, despiked(s, m), b);
      }
      return { ...m, baselines };
    });
  };

  const series = [
    {
      ...toChartSeries(sourceSeries, sourceSeries.time, processed.series[sourceSeries.id].despiked, { visible: true, ls90: sourceSeries.id === ls90?.id }),
      style: 'line' as const,
    },
  ];
  const b = drag && drag.seriesId === source ? drag : processed.series[source]?.baseline;
  const segments: ChartSegment[] = b ? [{ id: source, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, color: '#00a2b8', lineWidth: 2, editable: true }] : [];
  const unit = sourceSeries.kind === 'UV' ? 'absorbance (AU)' : sourceSeries.kind === 'LS' ? 'detector voltage (V)' : sourceSeries.units ? `${sourceSeries.label} (${sourceSeries.units})` : sourceSeries.label;

  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolLabel>Signal:</ToolLabel>
          <ToolButton icon={<IconPrev />} onClick={() => select(idx - 1)} title="Previous signal (↑)" />
          <ToolSelect value={source} options={analysable.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => setSource(v)} width={150} />
          <ToolButton icon={<IconNext />} onClick={() => select(idx + 1)} title="Next signal (↓)" />
          <ToolSep />
          <GraphModeTools mode={mode} setMode={setMode} drawLabel="Draw Baseline" drawTitle="Drag on the graph to set this signal's baseline range" chart={chart} />
          <ToolSep />
          <ToolButton icon={<IconAutofind />} onClick={() => autofind([source])} title="Automatically place the baseline of this signal">
            Autofind
          </ToolButton>
          <ToolButton icon={<IconAutofind />} onClick={() => autofind(analysable.map((s) => s.id))} title="Automatically place baselines for every signal">
            Autofind All
          </ToolButton>
          <ToolButton icon={<IconFit />} onClick={setAll} disabled={!method.baselines[source]} title="Use this signal's baseline time range for every signal (Y values snap to each signal)">
            Set All
          </ToolButton>
          <ToolHint>Drag to set the range · drag the end points to adjust · ↑/↓ switch signal</ToolHint>
        </>
      }
      main={
        <ChartPane
          ref={chart}
          title={`Define Baselines: ${sourceSeries.label}`}
          series={series}
          segments={segments}
          legend="none"
          mode={mode}
          resetKey={idx}
          xAxis={{ label: 'time (min)' }}
          yAxis={{ label: unit }}
          onSegmentChange={(id, seg, done) => {
            const cur = method.baselines[id];
            if (!cur) return;
            const nb: Baseline = cur.style === 'Snap-Y' ? { ...cur, x1: seg.x1, x2: seg.x2 } : { ...cur, ...seg };
            if (nb.x1 > nb.x2) [nb.x1, nb.x2, nb.y1, nb.y2] = [nb.x2, nb.x1, nb.y2, nb.y1];
            if (done) {
              setDrag(null);
              setBaseline(id, nb);
            } else {
              const s = e.series.find((x) => x.id === id)!;
              setDrag(snapBaseline(s.time, processed.series[id].despiked, nb));
            }
          }}
          onCreateRegion={(x1, x2) => {
            const cur = method.baselines[source];
            setBaseline(source, cur ? { ...cur, x1, x2 } : { seriesId: source, y1: 0, y2: 0, style: 'Snap-Y', x1, x2 });
          }}
        />
      }
      bottom={
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>Signal</th>
                <th>Style</th>
                <th>X1 (min)</th>
                <th>Y1</th>
                <th>X2 (min)</th>
                <th>Y2</th>
              </tr>
            </thead>
            <tbody>
              {analysable.map((s) => {
                const bl = processed.series[s.id].baseline;
                const set = (patch: Partial<Baseline>) => bl && setBaseline(s.id, { ...bl, ...patch });
                return (
                  <tr
                    key={s.id}
                    ref={(el) => {
                      rowRefs.current[s.id] = el;
                    }}
                    className={'clickable' + (s.id === source ? ' selected' : '')}
                    onClick={() => setSource(s.id)}
                    title="Click to show this signal"
                  >
                    <td>{s.label}</td>
                    <td>
                      <select value={bl?.style ?? 'Snap-Y'} onChange={(ev) => set({ style: ev.target.value as BaselineStyle })} disabled={!bl}>
                        <option>Snap-Y</option>
                        <option>Manual</option>
                      </select>
                    </td>
                    {bl ? (
                      <>
                        <td><NumberInput value={bl.x1} digits={4} onCommit={(v) => set({ x1: v })} /></td>
                        <td><NumberInput value={bl.y1} digits={6} onCommit={(v) => set({ y1: v, style: 'Manual' })} /></td>
                        <td><NumberInput value={bl.x2} digits={4} onCommit={(v) => set({ x2: v })} /></td>
                        <td><NumberInput value={bl.y2} digits={6} onCommit={(v) => set({ y2: v, style: 'Manual' })} /></td>
                      </>
                    ) : (
                      <td colSpan={4} className="muted">
                        no baseline: drag on the graph or use Autofind
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      }
      bottomFraction={0.32}
    />
  );
}
