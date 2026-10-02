import { useEffect, useMemo, useState } from 'react';
import type { Tab } from '../store';
import { determineNormalization, ls90Id } from '../analysis/calibration';
import type { ChartSeries } from '../chart/types';
import { ChartPane, DataTable, ToolButton, ToolLabel, ToolSep, ViewFrame } from '../ui/ViewFrame';
import { NumberInput } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { IconFit } from '../ui/icons';
import { PeakSelect, peakWindow } from './AlignmentView';

const DET_COLORS = ['#8e24aa', '#3949ab', '#039be5', '#00897b', '#ff0000', '#7cb342', '#fb8c00', '#6d4c41'];

/** Boxed number input for the tool strip. */
function ToolNumber(props: { value: number; digits: number; width: number; onCommit: (v: number) => void }) {
  return (
    <span style={{ border: '1px solid #b9b9b9', background: '#fff', height: 22, display: 'inline-flex', alignItems: 'center', padding: '0 2px' }}>
      <NumberInput {...props} />
    </span>
  );
}

export function NormalizationView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [resetKey, setResetKey] = useState(0);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const method = ctx?.method;
  const processed = ctx?.processed;
  const peak = method?.peaks.find((p) => p.id === method.normalization.peakId) ?? method?.peaks[0];
  const win = useMemo(() => (processed ? peakWindow(processed, peak) : null), [processed, peak]);
  useEffect(() => setResetKey((k) => k + 1), [peak?.id]);
  if (!ctx || !method || !processed || !win) return null;
  const { experiment: e, update } = ctx;

  const nDet = processed.lsIds.length;
  const id90 = ls90Id(processed);
  const j90 = id90 ? processed.lsIds.indexOf(id90) : -1;
  const norm = (j: number) => method.ls.normalization[j] ?? 1;

  const setNorm = (j: number, v: number) =>
    update((m) => ({ ...m, ls: { ...m.ls, normalization: m.ls.angles.map((_, k) => (k === j ? v : m.ls.normalization[k] ?? 1)) } }));
  const setEnabled = (j: number, v: boolean) =>
    update((m) => ({ ...m, ls: { ...m.ls, enabled: m.ls.angles.map((_, k) => (k === j ? v : m.ls.enabled[k] !== false)) } }));
  const normalize = () => {
    if (!peak) return;
    const n = determineNormalization(e, method, peak);
    update((m) => ({ ...m, ls: { ...m.ls, normalization: n } }));
    setResetKey((k) => k + 1);
  };
  const reset = () => update((m) => ({ ...m, ls: { ...m.ls, normalization: m.ls.angles.map(() => 1) } }));
  const setPeakId = (id: string) => update((m) => ({ ...m, normalization: { ...m.normalization, peakId: id } }));

  // Normalised traces relative to the 90° detector's maximum within the window.
  let max90 = 0;
  if (j90 >= 0) {
    const y = processed.series[processed.lsIds[j90]].aligned;
    for (let i = 0; i < processed.t.length; i++) {
      if (processed.t[i] >= win.lo && processed.t[i] <= win.hi && y[i] * norm(j90) > max90) max90 = y[i] * norm(j90);
    }
  }
  const series: ChartSeries[] = processed.lsIds.map((id, j) => {
    const raw = processed.series[id].raw;
    const a = processed.series[id].aligned;
    const f = norm(j) / (max90 > 0 ? max90 : 1);
    const label = `${raw.label} (${(method.ls.angles[j] ?? 0).toFixed(1)}°)`;
    return {
      id,
      label,
      x: processed.t,
      y: a.map((v) => v * f),
      color: j === j90 ? '#ff0000' : DET_COLORS[j % DET_COLORS.length],
      style: 'line',
      lineWidth: 1.2,
      visible: vis[id] ?? method.ls.enabled[j] !== false,
    };
  });

  const rows = processed.lsIds.map((id, j) => [
    processed.series[id].raw.label,
    (method.ls.angles[j] ?? 0).toFixed(2),
    <NumberInput key={id} value={norm(j)} digits={4} width={90} onCommit={(v) => setNorm(j, v)} />,
    <input key={id + 'e'} type="checkbox" checked={method.ls.enabled[j] !== false} onChange={(ev) => setEnabled(j, ev.target.checked)} />,
  ]);

  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolLabel>Peak:</ToolLabel>
          <PeakSelect peaks={method.peaks} value={peak?.id} onChange={setPeakId} />
          {peak && (
            <>
              <ToolLabel>Radius (nm):</ToolLabel>
              <ToolNumber
                value={peak.radius}
                digits={2}
                width={56}
                onCommit={(v) => update((m) => ({ ...m, peaks: m.peaks.map((p) => (p.id === peak.id ? { ...p, radius: Math.max(0, v) } : p)) }))}
              />
            </>
          )}
          <ToolLabel>Percent to keep:</ToolLabel>
          <ToolNumber
            value={method.normalization.percentToKeep}
            digits={0}
            width={44}
            onCommit={(v) => update((m) => ({ ...m, normalization: { ...m.normalization, percentToKeep: Math.max(1, Math.min(100, v)) } }))}
          />
          <ToolButton icon={<IconFit />} onClick={normalize} disabled={!peak || !nDet} title="Compute normalization coefficients from the top part of the selected isotropic standard peak">
            Normalize
          </ToolButton>
          <ToolButton onClick={reset} title="Set all normalization coefficients to 1">
            Reset
          </ToolButton>
          <ToolSep />
          <span className="muted">Use a narrow peak of a small isotropic scatterer; all detectors should then overlap.</span>
        </>
      }
      messages={[!nDet ? 'This experiment has no light scattering detectors.' : '', !peak ? 'No peaks are defined. Define a peak in the Peaks procedure first.' : ''].filter(Boolean)}
      main={
        <ChartPane
          title="Normalization"
          series={series}
          legend="right"
          resetKey={resetKey}
          regions={[]}
          xAxis={{ label: 'time (min)', min: win.lo, max: win.hi }}
          yAxis={{ label: 'Normalized LS signal (relative to 90°)' }}
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
        />
      }
      bottom={<DataTable head={['Detector', 'Angle in solvent (°)', 'Normalization coefficient', 'Enabled']} rows={rows} />}
      bottomFraction={0.3}
    />
  );
}
