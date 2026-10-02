import { useEffect, useMemo, useState } from 'react';
import type { Tab } from '../store';
import type { DelayKind, Peak } from '../analysis/method';
import type { Processed } from '../analysis/pipeline';
import { determineDelays, ls90Id, seriesForKind } from '../analysis/calibration';
import type { ChartSeries } from '../chart/types';
import { ChartPane, DataTable, ToolButton, ToolLabel, ToolSelect, ToolSep, ViewFrame } from '../ui/ViewFrame';
import { NumberInput } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { IconFit } from '../ui/icons';
import { familyTraces } from './PeaksView';

/** Tool-strip select listing the peaks of a method. */
export function PeakSelect({ peaks, value, onChange }: { peaks: Peak[]; value: string | undefined; onChange: (id: string) => void }) {
  if (!peaks.length) return <span className="muted">no peaks defined</span>;
  const cur = peaks.some((p) => p.id === value) ? value! : peaks[0].id;
  return <ToolSelect value={cur} options={peaks.map((p) => ({ value: p.id, label: p.name }))} onChange={onChange} width={110} />;
}

/**
 * Zoom window around a standard peak: centred on the LS 90° maximum, ±3 FWHM
 * wide (falls back to the peak limits ± one peak width).
 */
export function peakWindow(p: Processed, peak: Peak | undefined): { lo: number; hi: number; tMax: number } {
  const fallback = { lo: p.t[0] ?? 0, hi: p.t[p.t.length - 1] ?? 1, tMax: NaN };
  if (!peak) return fallback;
  const ref = ls90Id(p) ?? (p.series.dRI ? 'dRI' : null);
  if (!ref) return fallback;
  const y = p.series[ref].aligned;
  let best = -1;
  let ymax = -Infinity;
  for (let i = 0; i < p.t.length; i++) {
    if (p.t[i] < peak.start || p.t[i] > peak.end) continue;
    if (Number.isFinite(y[i]) && y[i] > ymax) {
      ymax = y[i];
      best = i;
    }
  }
  if (best < 0) return fallback;
  const tMax = p.t[best];
  const pr = p.peaks.find((r) => r.peak.id === peak.id);
  const fwhm = pr?.stats[ref]?.fwhm;
  const half = Number.isFinite(fwhm) && fwhm! > 0 ? Math.min(3 * fwhm!, peak.end - peak.start) : peak.end - peak.start;
  return { lo: Math.max(p.t[0], tMax - Math.max(half, 0.2)), hi: Math.min(p.t[p.t.length - 1], tMax + Math.max(half, 0.2)), tMax };
}

/** y / max(y) with the maximum taken over the window [lo, hi]. */
export function scaleToWindow(t: ArrayLike<number>, y: ArrayLike<number>, lo: number, hi: number): Float64Array {
  let max = 0;
  for (let i = 0; i < t.length; i++) if (t[i] >= lo && t[i] <= hi && Number.isFinite(y[i]) && y[i] > max) max = y[i];
  const out = new Float64Array(y.length);
  const f = max > 0 ? 1 / max : 1;
  for (let i = 0; i < y.length; i++) out[i] = y[i] * f;
  return out;
}

/** Centroid of the part of the peak above half maximum (min). */
function centroid(t: ArrayLike<number>, y: ArrayLike<number>, peak: Peak): number {
  let max = -Infinity;
  for (let i = 0; i < t.length; i++) if (t[i] >= peak.start && t[i] <= peak.end && Number.isFinite(y[i]) && y[i] > max) max = y[i];
  if (!(max > 0)) return NaN;
  let s = 0;
  let w = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < peak.start || t[i] > peak.end || !(y[i] >= 0.5 * max)) continue;
    s += y[i] * t[i];
    w += y[i];
  }
  return w > 0 ? s / w : NaN;
}

const NAMES: Record<'LS' | DelayKind, string> = { LS: 'LS (reference)', UV: 'UV', RI: 'dRI', VIS: 'VIS (viscometer)' };

export function AlignmentView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [peakId, setPeakId] = useState<string | undefined>();
  const [before, setBefore] = useState<Record<string, number>>({});
  const [resetKey, setResetKey] = useState(0);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const method = ctx?.method;
  const peak = method?.peaks.find((p) => p.id === peakId) ?? method?.peaks[0];
  const processed = ctx?.processed;
  const win = useMemo(() => (processed ? peakWindow(processed, peak) : null), [processed, peak]);
  useEffect(() => setResetKey((k) => k + 1), [peak?.id]);
  if (!ctx || !method || !processed || !win) return null;
  const { experiment: e, update } = ctx;

  const kinds = (['UV', 'RI', 'VIS'] as DelayKind[]).filter((k) => seriesForKind(processed, k));
  const hasLS = !!seriesForKind(processed, 'LS');

  const align = () => {
    if (!peak) return;
    const r = determineDelays(e, method, peak);
    setBefore(r.centers);
    update((m) => ({ ...m, delays: r.delays }));
    setResetKey((k) => k + 1);
  };
  const reset = () => update((m) => ({ ...m, delays: { UV: 0, RI: 0, VIS: 0 } }));
  const setDelay = (k: DelayKind, v: number) => update((m) => ({ ...m, delays: { ...m.delays, [k]: v } }));

  const series: ChartSeries[] = familyTraces(processed, (id) => vis[id] ?? true).map((s) => ({
    ...s,
    y: scaleToWindow(processed.t, s.y, win.lo, win.hi),
    style: s.id === 'LS' || s.id === 'UV' ? 'linedots' : 'line',
    markerSize: 1.8,
    lineWidth: 1,
  }));

  const rows = (['LS', ...kinds] as ('LS' | DelayKind)[])
    .filter((k) => k !== 'LS' || hasLS)
    .map((k) => {
      const id = seriesForKind(processed, k)!;
      const vol = k === 'LS' ? 0 : method.delays[k];
      const now = peak ? centroid(processed.t, processed.series[id].aligned, peak) : NaN;
      const b = before[k];
      return [
        NAMES[k],
        k === 'LS' ? '0.0000' : <NumberInput key={k} value={vol} digits={4} width={90} onCommit={(v) => setDelay(k, v)} />,
        (vol / method.flowRate).toFixed(4),
        b !== undefined && Number.isFinite(b) ? b.toFixed(4) : '–',
        Number.isFinite(now) ? now.toFixed(4) : '–',
      ];
    });

  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolLabel>Peak:</ToolLabel>
          <PeakSelect peaks={method.peaks} value={peak?.id} onChange={setPeakId} />
          <ToolButton icon={<IconFit />} onClick={align} disabled={!peak || !kinds.length} title="Shift the UV, dRI and VIS peaks onto the LS 90° peak (centroid of the top half of the peak)">
            Align
          </ToolButton>
          <ToolButton onClick={reset} title="Set all interdetector volumes to zero">
            Reset Volumes
          </ToolButton>
          <ToolSep />
          <span className="muted">Choose a narrow, symmetric standard peak and press Align. Detectors downstream of LS get a positive volume.</span>
        </>
      }
      messages={peak ? [] : ['No peaks are defined. Define a peak in the Peaks procedure first.']}
      main={
        <ChartPane
          title="Alignment"
          series={series}
          legend="top"
          resetKey={resetKey}
          xAxis={{ label: 'time (min)', min: win.lo, max: win.hi }}
          yAxis={{ label: 'Relative Scale', min: 0, max: 1 }}
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
        />
      }
      bottom={
        <DataTable
          head={['Instrument', 'Delay volume (mL)', 'Delay time (min)', 'Peak center before alignment (min)', 'Peak center aligned (min)']}
          rows={rows}
        />
      }
      bottomFraction={0.22}
    />
  );
}
