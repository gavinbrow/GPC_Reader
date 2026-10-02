import { useState } from 'react';
import type { Tab } from '../store';
import type { ChartRegion, ChartSeries } from '../chart/types';
import { ChartPane, ViewFrame } from '../ui/ViewFrame';
import { useViewContext } from '../ui/useView';
import { EmptyView, fitColor, peakColor, relativeTraces, sliceRange } from './ResultsFittingView';

export function MassVsTimeView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  // The rms radius (right axis) is hidden until switched on in the legend.
  const [vis, setVis] = useState<Record<string, boolean>>({});
  if (!ctx) return null;
  const { processed } = ctx;
  if (!processed.peaks.length) return <EmptyView tab={tab} text="No peaks are defined. Define peaks in the Peaks procedure first." />;

  const multi = processed.peaks.length > 1;
  const show = (id: string, def = true) => vis[id] ?? def;
  const series: ChartSeries[] = relativeTraces(processed, vis);
  const regions: ChartRegion[] = [];
  const messages: string[] = [];

  processed.peaks.forEach((pr, i) => {
    const sfx = multi ? ` ${i + 1}` : '';
    regions.push({ id: pr.peak.id, x1: pr.peak.start, x2: pr.peak.end, label: pr.peak.name });
    series.push({ id: `M${i}`, label: `Molar Mass${sfx}`, x: pr.t, y: pr.M, color: peakColor(i), style: 'markers', markerSize: 2, axis: 'left', visible: show(`M${i}`) });
    if (pr.massFit) {
      const [fx, fy] = sliceRange(pr.t, pr.massFit.values, pr.massFit.start, pr.massFit.end);
      series.push({ id: `Mfit${i}`, label: `Molar Mass fit${sfx}`, x: fx, y: fy, color: fitColor(i), style: 'line', lineWidth: 1.5, axis: 'left', visible: show(`Mfit${i}`) });
    }
    series.push({ id: `R${i}`, label: `rms radius${sfx}`, x: pr.t, y: pr.rg, color: peakColor(i), style: 'dots', markerSize: 2, axis: 'right', visible: show(`R${i}`, false) });
    if (pr.radiusFit) {
      const [fx, fy] = sliceRange(pr.t, pr.radiusFit.values, pr.radiusFit.start, pr.radiusFit.end);
      series.push({ id: `Rfit${i}`, label: `rms radius fit${sfx}`, x: fx, y: fy, color: fitColor(i), style: 'dashed', lineWidth: 1.5, axis: 'right', visible: show(`Rfit${i}`, false) });
    }
    messages.push(...pr.warnings.map((w) => (multi ? `${pr.peak.name}: ${w}` : w)));
  });

  // Zoom to the peaks (with some context on both sides).
  const lo = Math.min(...processed.peaks.map((p) => p.peak.start));
  const hi = Math.max(...processed.peaks.map((p) => p.peak.end));
  const pad = Math.max(0.5, 0.25 * (hi - lo));

  return (
    <ViewFrame
      tab={tab}
      messages={messages}
      main={
        <ChartPane
          title="Molar Mass vs. Time"
          series={series}
          legend="top"
          regions={regions}
          xAxis={{ label: 'time (min)', min: lo - pad, max: hi + pad }}
          yAxis={{ label: 'Molar Mass (g/mol)', log: true }}
          y2Axis={{ label: 'rms radius (nm)', log: true }}
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
        />
      }
    />
  );
}
