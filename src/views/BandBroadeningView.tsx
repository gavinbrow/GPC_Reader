import { useEffect, useMemo, useState } from 'react';
import type { Tab } from '../store';
import { process } from '../analysis/pipeline';
import { determineBandBroadening, seriesForKind } from '../analysis/calibration';
import type { ChartSeries } from '../chart/types';
import { ChartPane, DataTable, ToolButton, ToolLabel, ToolSep, ViewFrame } from '../ui/ViewFrame';
import { NumberInput } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { IconFit } from '../ui/icons';
import { seriesColor } from '../ui/series';
import { PeakSelect, peakWindow, scaleToWindow } from './AlignmentView';

type Inst = 'LS' | 'UV' | 'VIS';
const INST_NAMES: Record<Inst, string> = { LS: 'LS (90° detector)', UV: 'UV', VIS: 'VIS (viscometer)' };

export function BandBroadeningView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [peakId, setPeakId] = useState<string | undefined>();
  const [residuals, setResiduals] = useState<Record<string, number>>({});
  const [resetKey, setResetKey] = useState(0);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const method = ctx?.method;
  const experiment = ctx?.experiment;
  const peak = method?.peaks.find((p) => p.id === peakId) ?? method?.peaks[0];

  // Both versions of the data, with identical delays: without and with band broadening.
  const bb = method?.bandBroadening;
  const off = useMemo(() => (experiment && method ? process(experiment, { ...method, bandBroadening: { ...method.bandBroadening, enabled: false } }) : null), [experiment, method]);
  const on = useMemo(() => (experiment && method ? process(experiment, { ...method, bandBroadening: { ...method.bandBroadening, enabled: true } }) : null), [experiment, method]);
  const win = useMemo(() => (off ? peakWindow(off, peak) : null), [off, peak]);
  useEffect(() => setResetKey((k) => k + 1), [peak?.id]);
  if (!ctx || !method || !bb || !off || !on || !win) return null;
  const { update } = ctx;

  const insts = (['LS', 'UV', 'VIS'] as Inst[]).filter((k) => seriesForKind(off, k));
  const hasRI = !!off.series.dRI;

  const determine = () => {
    if (!peak) return;
    const r = determineBandBroadening(experiment!, method, peak);
    setResiduals(r.residuals);
    update((m) => ({ ...m, bandBroadening: { enabled: true, terms: r.terms }, delays: r.delays }));
    setResetKey((k) => k + 1);
  };
  const setTerm = (k: Inst, field: 'instrumental' | 'mixing', v: number) =>
    update((m) => ({
      ...m,
      bandBroadening: { ...m.bandBroadening, terms: { ...m.bandBroadening.terms, [k]: { ...m.bandBroadening.terms[k], [field]: Math.max(0, v) } } },
    }));

  const series: ChartSeries[] = [];
  const add = (id: string, p: typeof off, label: string, color: string, dashed: boolean) => {
    if (!p.series[id]) return;
    series.push({
      id: label,
      label,
      x: p.t,
      y: scaleToWindow(p.t, p.series[id].aligned, win.lo, win.hi),
      color,
      style: dashed ? 'dashed' : 'line',
      lineWidth: dashed ? 1 : 1.6,
      visible: vis[label] ?? true,
    });
  };
  if (hasRI) add('dRI', off, 'dRI (reference)', seriesColor(off.series.dRI.raw), false);
  for (const k of insts) {
    const id = seriesForKind(off, k)!;
    const label = k === 'LS' ? 'LS' : k;
    const color = seriesColor(off.series[id].raw, k === 'LS');
    add(id, off, `${label} unbroadened`, color, true);
    add(id, on, `${label} broadened`, color, false);
  }

  const rows = insts.map((k) => {
    const t = method.bandBroadening.terms[k];
    const r = residuals[k];
    return [
      INST_NAMES[k],
      <NumberInput key={k + 'i'} value={t.instrumental} digits={2} width={90} onCommit={(v) => setTerm(k, 'instrumental', v)} />,
      <NumberInput key={k + 'm'} value={t.mixing} digits={2} width={90} onCommit={(v) => setTerm(k, 'mixing', v)} />,
      r !== undefined && Number.isFinite(r) ? `${(100 * r).toFixed(2)} %` : '–',
    ];
  });

  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolLabel>Peak:</ToolLabel>
          <PeakSelect peaks={method.peaks} value={peak?.id} onChange={setPeakId} />
          <ToolButton icon={<IconFit />} onClick={determine} disabled={!peak || !hasRI || !insts.length} title="Fit Gaussian and exponential broadening terms that make each upstream detector match the dRI peak shape">
            Determine Broadening
          </ToolButton>
          <label className="tool-check">
            <input type="checkbox" checked={bb.enabled} onChange={(ev) => update((m) => ({ ...m, bandBroadening: { ...m.bandBroadening, enabled: ev.target.checked } }))} />
            Enabled
          </label>
          <ToolSep />
          <span className="muted">Select a narrow standard peak. Detectors upstream of the dRI cell are broadened to the shape of the dRI peak.</span>
        </>
      }
      messages={[!hasRI ? 'No dRI detector: band broadening needs the dRI peak as the reference.' : '', !peak ? 'No peaks are defined. Define a peak in the Peaks procedure first.' : ''].filter(Boolean)}
      main={
        <ChartPane
          title="Band Broadening"
          series={series}
          legend="right"
          resetKey={resetKey}
          xAxis={{ label: 'time (min)', min: win.lo, max: win.hi }}
          yAxis={{ label: 'Relative Scale', min: 0, max: 1 }}
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
        />
      }
      bottom={
        <DataTable
          head={['Instrument', 'Instrumental term, Gaussian σ (µL)', 'Mixing term, exponential τ (µL)', 'Fit residual (rms, % of peak)']}
          rows={rows}
        />
      }
      bottomFraction={0.2}
    />
  );
}
