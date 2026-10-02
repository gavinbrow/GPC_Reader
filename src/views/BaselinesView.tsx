import { useMemo, useState } from 'react';
import type { Tab } from '../store';
import type { Baseline, BaselineStyle } from '../analysis/method';
import { autoBaseline, snapBaseline } from '../analysis/signal';
import { despiked } from '../analysis/pipeline';
import type { ChartSegment } from '../chart/types';
import { ChartPane, ToolButton, ToolLabel, ToolSelect, ToolSep, ViewFrame } from '../ui/ViewFrame';
import { NumberInput } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { rawAxis, toChartSeries } from '../ui/series';
import { IconAutofind, IconFit } from '../ui/icons';

export function BaselinesView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const e = ctx?.experiment;
  const analysable = useMemo(() => (e ? e.series.filter((s) => s.analysable) : []), [e]);
  const ls90 = analysable.find((s) => s.kind === 'LS' && s.defaultVisible) ?? analysable[0];
  const [source, setSource] = useState<string>(ls90?.id ?? '');
  const [visible, setVisible] = useState<Record<string, boolean>>(() => ({ [ls90?.id ?? '']: true }));
  const [drag, setDrag] = useState<Baseline | null>(null);
  if (!ctx || !e) return null;
  const { method, processed, update } = ctx;

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

  const isVis = (id: string) => !!visible[id] || id === source;
  const series = analysable.map((s) =>
    toChartSeries(s, s.time, processed.series[s.id].despiked, { visible: isVis(s.id), axis: rawAxis(s, 'uv'), ls90: s.id === ls90?.id }),
  );
  const segments: ChartSegment[] = analysable
    .filter((s) => isVis(s.id))
    .map((s) => {
      const b = drag && drag.seriesId === s.id ? drag : processed.series[s.id].baseline;
      if (!b) return null;
      return {
        id: s.id,
        x1: b.x1,
        y1: b.y1,
        x2: b.x2,
        y2: b.y2,
        color: s.id === source ? '#00b7c3' : '#555',
        axis: rawAxis(s, 'uv'),
        lineWidth: s.id === source ? 2 : 1.2,
        editable: true,
      } as ChartSegment;
    })
    .filter((x): x is ChartSegment => !!x);

  const sourceSeries = analysable.find((s) => s.id === source);
  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolButton icon={<IconAutofind />} onClick={() => autofind(analysable.map((s) => s.id))} title="Automatically place baselines for every signal">
            Autofind Baselines
          </ToolButton>
          <ToolButton icon={<IconAutofind />} onClick={() => autofind([source])} title="Automatically place the baseline of the source signal">
            Autofind Source
          </ToolButton>
          <ToolSep />
          <ToolLabel>Source:</ToolLabel>
          <ToolSelect
            value={source}
            options={analysable.map((s) => s.id)}
            onChange={(v) => {
              setSource(v);
              setVisible((o) => ({ ...o, [v]: true }));
            }}
          />
          <ToolButton icon={<IconFit />} onClick={setAll} title="Use the source baseline's time range for every signal (Y values snap to each signal)">
            Set All
          </ToolButton>
          <span className="muted" style={{ marginLeft: 12 }}>
            Drag the baseline end points; Shift+drag on the graph sets a new range for the source.
          </span>
        </>
      }
      main={
        <ChartPane
          title="Define Baselines"
          series={series}
          segments={segments}
          legend="right"
          xAxis={{ label: 'time (min)' }}
          yAxis={{ label: sourceSeries?.kind === 'UV' ? 'absorbance (AU)' : sourceSeries?.kind === 'LS' ? 'detector voltage (V)' : sourceSeries?.label ?? '' }}
          y2Axis={{ label: 'absorbance (AU)' }}
          onToggleSeries={(id, v) => setVisible((o) => ({ ...o, [id]: v }))}
          onSegmentChange={(id, seg, done) => {
            const cur = method.baselines[id];
            if (!cur) return;
            const b: Baseline = cur.style === 'Snap-Y' ? { ...cur, x1: seg.x1, x2: seg.x2 } : { ...cur, ...seg };
            if (b.x1 > b.x2) [b.x1, b.x2, b.y1, b.y2] = [b.x2, b.x1, b.y2, b.y1];
            if (done) {
              setDrag(null);
              setBaseline(id, b);
            } else {
              const s = e.series.find((x) => x.id === id)!;
              setDrag(snapBaseline(s.time, processed.series[id].despiked, b));
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
                <th />
                <th>Visible</th>
                <th>Style</th>
                <th>X1 (min)</th>
                <th>Y1</th>
                <th>X2 (min)</th>
                <th>Y2</th>
              </tr>
            </thead>
            <tbody>
              {analysable.map((s) => {
                const b = processed.series[s.id].baseline;
                const set = (patch: Partial<Baseline>) => b && setBaseline(s.id, { ...b, ...patch });
                return (
                  <tr key={s.id} className={s.id === source ? 'selected' : undefined} onClick={() => setSource(s.id)}>
                    <td>{s.id}</td>
                    <td>
                      <input type="checkbox" checked={isVis(s.id)} onChange={(ev) => setVisible((o) => ({ ...o, [s.id]: ev.target.checked }))} />
                    </td>
                    <td>
                      <select value={b?.style ?? 'Snap-Y'} onChange={(ev) => set({ style: ev.target.value as BaselineStyle })} disabled={!b}>
                        <option>Snap-Y</option>
                        <option>Manual</option>
                      </select>
                    </td>
                    {b ? (
                      <>
                        <td><NumberInput value={b.x1} digits={4} onCommit={(v) => set({ x1: v })} /></td>
                        <td><NumberInput value={b.y1} digits={6} onCommit={(v) => set({ y1: v, style: 'Manual' })} /></td>
                        <td><NumberInput value={b.x2} digits={4} onCommit={(v) => set({ x2: v })} /></td>
                        <td><NumberInput value={b.y2} digits={6} onCommit={(v) => set({ y2: v, style: 'Manual' })} /></td>
                      </>
                    ) : (
                      <td colSpan={4} className="muted">
                        no baseline — use Autofind
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
