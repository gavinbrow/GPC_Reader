import { useMemo, useState } from 'react';
import { processedFor, useStore, type ExpEntry, type Tab } from '../store';
import { concentrationTrace, type Processed } from '../analysis/pipeline';
import { ls90Id } from '../analysis/calibration';
import type { AxisOptions, ChartSeries, SeriesStyle } from '../chart/types';
import { ChartPane, ToolLabel, ToolSelect, ViewFrame } from '../ui/ViewFrame';
import { peakDistribution, windowed } from './ResultsFittingView';

const EASI_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#d81b60', '#7cb342', '#546e7a', '#000000', '#fdd835'];

type Kind = 'mass' | 'diff' | 'cum' | 'conf' | 'conc' | 'ls';

interface GraphDef {
  kind: Kind;
  label: string;
  title: string;
  x: AxisOptions;
  y: AxisOptions;
}

const GRAPHS: GraphDef[] = [
  { kind: 'mass', label: 'Molar mass vs. time', title: 'Molar Mass vs. Time', x: { label: 'time (min)' }, y: { label: 'Molar Mass (g/mol)', log: true } },
  { kind: 'diff', label: 'Differential distribution', title: 'Differential Distribution', x: { label: 'Molar Mass (g/mol)', log: true }, y: { label: 'Differential Weight Fraction', min: 0 } },
  { kind: 'cum', label: 'Cumulative distribution', title: 'Cumulative Distribution', x: { label: 'Molar Mass (g/mol)', log: true }, y: { label: 'Cumulative Weight Fraction', min: 0, max: 1 } },
  { kind: 'conf', label: 'Conformation plot', title: 'Conformation Plot', x: { label: 'Molar Mass (g/mol)', log: true }, y: { label: 'rms radius (nm)', log: true } },
  { kind: 'conc', label: 'Concentration (dRI) vs. time', title: 'Concentration vs. Time', x: { label: 'time (min)' }, y: { label: 'Concentration (mg/mL)' } },
  { kind: 'ls', label: 'LS 90° vs. time', title: 'LS 90° vs. Time', x: { label: 'time (min)' }, y: { label: 'LS 90° (V)' } },
];

interface Item {
  id: string;
  label: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  style?: SeriesStyle;
}

function shortName(entry: ExpEntry): string {
  return entry.experiment.name || entry.experiment.fileName;
}

/** Concentration (mg/mL) of the first peak's parameters, or null without dRI / dn/dc. */
function concentrationMg(p: Processed): Float64Array | null {
  const pk = p.method.peaks[0];
  if (!pk || !p.series.dRI) return null;
  const c = concentrationTrace(p.method, p.series, 'dRI', pk);
  return c ? c.map((v) => v * 1000) : null;
}

function itemsFor(kind: Kind, entries: ExpEntry[], procs: Processed[]): { items: Item[]; messages: string[]; yLabel?: string } {
  const items: Item[] = [];
  const messages: string[] = [];
  let yLabel: string | undefined;
  entries.forEach((entry, ei) => {
    const p = procs[ei];
    const name = shortName(entry);
    if (kind === 'conc' || kind === 'ls') {
      let y: Float64Array | null = null;
      if (kind === 'conc') {
        y = concentrationMg(p);
        if (!y && p.series.dRI) {
          y = p.series.dRI.aligned;
          yLabel = 'dRI signal (RIU)';
          messages.push(`${name}: no dn/dc is defined, the raw dRI signal is shown instead of the concentration.`);
        } else if (!y) messages.push(`${name}: no dRI data.`);
      } else {
        const id = ls90Id(p);
        y = id ? p.series[id].aligned : null;
        if (!y) messages.push(`${name}: no light scattering data.`);
      }
      if (y) items.push({ id: `${ei}`, label: name, x: p.t, y });
      return;
    }
    const multi = p.peaks.length > 1;
    if (!p.peaks.length) messages.push(`${name}: no peaks are defined.`);
    p.peaks.forEach((pr) => {
      const label = multi ? `${name} - ${pr.peak.name}` : name;
      const id = `${ei}:${pr.peak.id}`;
      if (kind === 'mass') items.push({ id, label, x: pr.t, y: windowed(pr, 'mass') });
      else if (kind === 'conf') items.push({ id, label, x: windowed(pr, 'mass'), y: windowed(pr, 'radius'), style: 'markers' });
      else {
        const d = peakDistribution(pr, 'mass');
        if (!d) return;
        items.push({ id, label, x: d.x, y: kind === 'diff' ? d.differentialLog : d.cumulative });
      }
    });
  });
  return { items, messages, yLabel };
}

export function EasiGraphView({ tab }: { tab: Tab }) {
  const experiments = useStore((s) => s.experiments);
  const [kind, setKind] = useState<Kind>('mass');
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const procs = useMemo(() => experiments.map((e) => processedFor(e.experiment, e.method)), [experiments]);
  const def = GRAPHS.find((g) => g.kind === kind) ?? GRAPHS[0];
  const { items, messages, yLabel } = useMemo(() => itemsFor(kind, experiments, procs), [kind, experiments, procs]);

  const toolbar = (
    <>
      <ToolLabel>Graph:</ToolLabel>
      <ToolSelect value={kind} options={GRAPHS.map((g) => ({ value: g.kind, label: g.label }))} onChange={setKind} width={210} />
    </>
  );

  if (!experiments.length) {
    return <ViewFrame tab={tab} toolbar={toolbar} main={<div className="placeholder">No experiments are open. Open experiments to compare their results here.</div>} />;
  }

  const series: ChartSeries[] = items.map((it, i) => ({
    id: it.id,
    label: it.label,
    x: it.x,
    y: it.y,
    color: EASI_COLORS[i % EASI_COLORS.length],
    style: it.style ?? 'line',
    lineWidth: 1.3,
    markerSize: 2.5,
    visible: vis[it.id] ?? true,
  }));

  return (
    <ViewFrame
      tab={tab}
      toolbar={toolbar}
      messages={messages}
      main={
        <ChartPane
          title={def.title}
          series={series}
          legend="right"
          xAxis={def.x}
          yAxis={{ ...def.y, label: yLabel ?? def.y.label }}
          fileName="EASI Graph"
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
        />
      }
    />
  );
}
