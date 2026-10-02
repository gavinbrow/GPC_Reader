import { useMemo } from 'react';
import type { Tab } from '../store';
import type { DespikeLevel } from '../analysis/method';
import { ChartPane, ToolLabel, ToolSelect, ViewFrame } from '../ui/ViewFrame';
import { useViewContext } from '../ui/useView';
import { rawAxis, toChartSeries } from '../ui/series';
import { useSeriesVisibility } from './useSeriesVisibility';

const LEVELS = ['Off', 'Low', 'Normal', 'High'] as const;

export function DespikingView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const e = ctx?.experiment;
  const shown = useMemo(() => (e ? e.series.filter((s) => s.analysable) : []), [e]);
  const vis = useSeriesVisibility(shown);
  if (!ctx || !e) return null;
  const { method, processed, update } = ctx;
  const level = method.despike.enabled ? method.despike.level : 'Off';
  const series = shown.map((s) =>
    toChartSeries(s, s.time, processed.series[s.id].despiked, { visible: vis.isVisible(s.id), axis: rawAxis(s, 'uv'), ls90: s.defaultVisible && s.kind === 'LS' }),
  );
  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolLabel>Level:</ToolLabel>
          <ToolSelect
            value={level}
            options={[...LEVELS]}
            onChange={(v) =>
              update((m) => ({ ...m, despike: v === 'Off' ? { ...m.despike, enabled: false } : { enabled: true, level: v as DespikeLevel } }))
            }
          />
          <span className="muted" style={{ marginLeft: 12 }}>
            Isolated spikes (e.g. particles in the light scattering cell) are replaced by the local median; peaks are preserved.
          </span>
        </>
      }
      main={
        <ChartPane
          title="Despiking Procedure"
          series={series}
          legend="right"
          xAxis={{ label: 'time (min)' }}
          yAxis={{ label: 'detector voltage (V)' }}
          y2Axis={{ label: 'absorbance (AU)' }}
          onToggleSeries={vis.toggle}
        />
      }
    />
  );
}
