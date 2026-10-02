import { useState } from 'react';
import type { Tab } from '../store';
import type { PeakResult } from '../analysis/pipeline';
import { polyfit } from '../analysis/math';
import type { ChartRegion, ChartSeries } from '../chart/types';
import { ChartPane, ToolLabel, ToolSelect, ViewFrame } from '../ui/ViewFrame';
import { useViewContext } from '../ui/useView';
import { EmptyView, fitColor, peakColor, relativeTraces, sliceRange, windowed } from './ResultsFittingView';

type Plot = 'rms radius vs. molar mass' | 'rms radius vs. time';
const PLOTS: Plot[] = ['rms radius vs. molar mass', 'rms radius vs. time'];

/** Log-log line through the main part of the peak, spanning the M range actually used by the fit (c >= 10 % of max). */
export function conformationLine(pr: PeakResult): { x: number[]; y: number[] } | null {
  let cmax = 0;
  for (const c of pr.c) if (c > cmax) cmax = c;
  const M = windowed(pr, 'mass');
  const R = windowed(pr, 'radius');
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  for (let i = 0; i < pr.c.length; i++) {
    if (pr.c[i] >= 0.1 * cmax && M[i] > 0 && R[i] > 0) {
      xs.push(Math.log10(M[i]));
      ys.push(Math.log10(R[i]));
      ws.push(pr.c[i]);
    }
  }
  const f = xs.length >= 3 ? polyfit(xs, ys, 1, ws) : null;
  if (!f) return null;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return { x: [10 ** lo, 10 ** hi], y: [10 ** (f.p[0] + f.p[1] * lo), 10 ** (f.p[0] + f.p[1] * hi)] };
}

export function ConformationView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [plot, setPlot] = useState<Plot>(PLOTS[0]);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  if (!ctx) return null;
  const { processed } = ctx;
  if (!processed.peaks.length) return <EmptyView tab={tab} text="No peaks are defined. Define peaks in the Peaks procedure first." />;

  const multi = processed.peaks.length > 1;
  const show = (id: string) => vis[id] ?? true;
  const toolbar = (
    <>
      <ToolLabel>Plot:</ToolLabel>
      <ToolSelect value={plot} options={PLOTS} onChange={setPlot} width={190} />
    </>
  );
  const onToggle = (id: string, v: boolean) => setVis((o) => ({ ...o, [id]: v }));
  const messages: string[] = [];

  if (plot === PLOTS[0]) {
    const series: ChartSeries[] = [];
    const foot: string[] = [];
    processed.peaks.forEach((pr, i) => {
      const name = pr.peak.name || `Peak ${i + 1}`;
      series.push({ id: `pt${i}`, label: name, x: windowed(pr, 'mass'), y: windowed(pr, 'radius'), color: peakColor(i), style: 'markers', markerSize: 2.5, visible: show(`pt${i}`) });
      const line = conformationLine(pr);
      if (line) series.push({ id: `fit${i}`, label: `${name} fit`, x: line.x, y: line.y, color: fitColor(i), style: 'line', lineWidth: 1.5, visible: show(`fit${i}`) });
      const s = pr.moments.conformationSlope;
      if (Number.isFinite(s.v)) foot.push(`${multi ? `${name}: ` : ''}slope = ${s.v.toFixed(2)}${Number.isFinite(s.e) ? ` ± ${s.e.toFixed(2)}` : ''}`);
      else messages.push(`${name}: the conformation slope cannot be determined (the rms radius is not available for enough slices; radii below about 10 nm are usually not measurable).`);
    });
    const hasData = series.some((s) => s.id.startsWith('pt') && Array.from(s.y).some((v, k) => v > 0 && s.x[k] > 0));
    return (
      <ViewFrame
        tab={tab}
        toolbar={toolbar}
        messages={messages}
        main={
          !hasData ? (
            <div className="placeholder">
              No slice has both a molar mass and an rms radius, so there is no conformation plot. Radii below about 10 nm are usually too small to be measured by light scattering.
            </div>
          ) : (
            <ChartPane
              title="Conformation Plot"
              series={series}
              legend={multi ? 'top' : 'none'}
              xAxis={{ label: 'Molar Mass (g/mol)', log: true }}
              yAxis={{ label: 'rms radius (nm)', log: true }}
              footerRight={foot.join('    ')}
              onToggleSeries={onToggle}
            />
          )
        }
      />
    );
  }

  const series: ChartSeries[] = relativeTraces(processed, vis);
  const regions: ChartRegion[] = [];
  processed.peaks.forEach((pr, i) => {
    const sfx = multi ? ` ${i + 1}` : '';
    regions.push({ id: pr.peak.id, x1: pr.peak.start, x2: pr.peak.end, label: pr.peak.name });
    series.push({ id: `pt${i}`, label: `rms radius${sfx}`, x: pr.t, y: pr.rg, color: peakColor(i), style: 'markers', markerSize: 2, visible: show(`pt${i}`) });
    if (pr.radiusFit) {
      const [fx, fy] = sliceRange(pr.t, pr.radiusFit.values, pr.radiusFit.start, pr.radiusFit.end);
      series.push({ id: `fit${i}`, label: `rms radius fit${sfx}`, x: fx, y: fy, color: fitColor(i), style: 'line', lineWidth: 1.5, visible: show(`fit${i}`) });
    }
  });
  const lo = Math.min(...processed.peaks.map((p) => p.peak.start));
  const hi = Math.max(...processed.peaks.map((p) => p.peak.end));
  const pad = Math.max(0.5, 0.25 * (hi - lo));
  return (
    <ViewFrame
      tab={tab}
      toolbar={toolbar}
      main={
        <ChartPane
          title="rms radius vs. time"
          series={series}
          legend="top"
          regions={regions}
          xAxis={{ label: 'time (min)', min: lo - pad, max: hi + pad }}
          yAxis={{ label: 'rms radius (nm)', log: true }}
          onToggleSeries={onToggle}
        />
      }
    />
  );
}
