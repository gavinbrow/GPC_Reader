import { useState } from 'react';
import type { Tab } from '../store';
import type { ChartSeries } from '../chart/types';
import { ChartPane, ToolLabel, ToolSelect, ViewFrame } from '../ui/ViewFrame';
import { useViewContext } from '../ui/useView';
import { num } from '../ui/format';
import { EmptyView, fitColor, peakColor, windowed } from './ResultsFittingView';

type Plot = 'Intrinsic viscosity' | 'Hydrodynamic radius';
const PLOTS: Plot[] = ['Intrinsic viscosity', 'Hydrodynamic radius'];

export function MarkHouwinkView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [plot, setPlot] = useState<Plot>(PLOTS[0]);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  if (!ctx) return null;
  const { processed } = ctx;
  if (!processed.series.VIS) {
    return <EmptyView tab={tab} text="This experiment has no viscometer. The Mark-Houwink plot needs intrinsic viscosity data (VIS detector)." />;
  }
  if (!processed.peaks.length) return <EmptyView tab={tab} text="No peaks are defined. Define peaks in the Peaks procedure first." />;

  const multi = processed.peaks.length > 1;
  const isEta = plot === 'Intrinsic viscosity';
  const show = (id: string) => vis[id] ?? true;
  const series: ChartSeries[] = [];
  const foot: string[] = [];
  const messages: string[] = [];

  processed.peaks.forEach((pr, i) => {
    const name = pr.peak.name || `Peak ${i + 1}`;
    const y = isEta ? pr.eta : pr.rh;
    const Mw = windowed(pr, 'mass');
    // Span of the lines: the main part of the peak (c >= 10 % of max), like the fit itself.
    const cmax = Math.max(0, ...Array.from(pr.c).filter(Number.isFinite));
    const core = Array.from(Mw).filter((v, k) => v > 0 && Number.isFinite(v) && pr.c[k] >= 0.1 * cmax);
    if (y) series.push({ id: `pt${i}`, label: name, x: Mw, y, color: peakColor(i), style: 'markers', markerSize: 2.5, visible: show(`pt${i}`) });
    if (!isEta) return;
    const { mhK, mhA } = pr.moments;
    if (mhK > 0 && Number.isFinite(mhA)) {
      if (core.length) {
        const lo = Math.min(...core);
        const hi = Math.max(...core);
        series.push({ id: `fit${i}`, label: `${name} fit`, x: [lo, hi], y: [mhK * lo ** mhA, mhK * hi ** mhA], color: fitColor(i), style: 'line', lineWidth: 1.5, visible: show(`fit${i}`) });
      }
      foot.push(`${multi ? `${name}: ` : ''}K = ${num(mhK, 3)} mL/g, a = ${mhA.toFixed(3)}`);
    } else messages.push(`${name}: the Mark-Houwink fit could not be determined (too few slices with positive molar mass and viscosity).`);
    const { mhsK, mhsA } = pr.peak;
    if (mhsK > 0 && mhsA > 0 && series.some((s) => s.id === `pt${i}`)) {
      if (core.length) {
        const lo = Math.min(...core);
        const hi = Math.max(...core);
        series.push({
          id: `ref${i}`,
          label: `${name} reference (K=${num(mhsK, 3)}, a=${mhsA})`,
          x: [lo, hi],
          y: [mhsK * lo ** mhsA, mhsK * hi ** mhsA],
          color: peakColor(i),
          style: 'dashed',
          visible: show(`ref${i}`),
        });
      }
    }
  });

  return (
    <ViewFrame
      tab={tab}
      messages={messages}
      toolbar={
        <>
          <ToolLabel>Plot:</ToolLabel>
          <ToolSelect value={plot} options={PLOTS} onChange={setPlot} width={160} />
        </>
      }
      main={
        <ChartPane
          title={isEta ? 'Mark-Houwink Plot' : 'Hydrodynamic Radius vs. Molar Mass'}
          series={series}
          legend="top"
          xAxis={{ label: 'Molar Mass (g/mol)', log: true }}
          yAxis={{ label: isEta ? 'Intrinsic Viscosity (mL/g)' : 'Hydrodynamic radius (nm)', log: true }}
          footerRight={foot.join('    ')}
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
        />
      }
    />
  );
}
