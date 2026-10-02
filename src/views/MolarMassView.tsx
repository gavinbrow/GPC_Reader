import { useEffect, useMemo, useState } from 'react';
import type { Tab } from '../store';
import type { LSModel, Peak } from '../analysis/method';
import { sliceFitAt } from '../analysis/pipeline';
import { polyval } from '../analysis/math';
import type { ChartSeries } from '../chart/types';
import { ChartPane, ViewFrame } from '../ui/ViewFrame';
import { PropertyGrid, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { pm } from '../ui/format';
import { familyTraces } from './PeaksView';

export function MolarMassView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [peakIdx, setPeakIdx] = useState(0);
  const [slice, setSlice] = useState<number | null>(null);
  const [vis, setVis] = useState<Record<string, boolean>>({ VIS: false });
  const processed = ctx?.processed;
  const pr = processed?.peaks[Math.min(peakIdx, (processed?.peaks.length ?? 1) - 1)];

  // Default slice: concentration apex of the peak.
  const apex = useMemo(() => {
    if (!pr) return 0;
    let best = 0;
    for (let k = 0; k < pr.c.length; k++) if (pr.c[k] > pr.c[best]) best = k;
    return pr.i0 + best;
  }, [pr]);
  const cur = pr ? Math.max(pr.i0, Math.min(pr.i1, slice ?? apex)) : 0;

  useEffect(() => {
    setSlice(null);
  }, [peakIdx]);

  if (!ctx || !processed) return null;
  const { method, update } = ctx;
  if (!pr) {
    return <ViewFrame tab={tab} messages={['No peaks are defined. Define peaks in the Peaks procedure first.']} main={<div className="placeholder" />} />;
  }

  const sf = sliceFitAt(processed, pr.index, cur);
  const fit = sf?.fit;
  const setPeak = (patch: Partial<Peak>) =>
    update((m) => ({ ...m, peaks: m.peaks.map((p, i) => (i === pr.index ? { ...p, ...patch } : p)) }));

  const resultSeries: ChartSeries[] = [];
  if (fit) {
    resultSeries.push({ id: 'data', label: 'data', x: fit.x, y: fit.y, color: '#000', style: 'markers', markerSize: 2.5, hideInLegend: true });
    if (fit.fit) {
      const xs = Array.from({ length: 41 }, (_, i) => (i / 40) * Math.max(1, ...fit.x));
      resultSeries.push({ id: 'fit', label: 'fit', x: xs, y: xs.map((x) => polyval(fit.fit!.p, x)), color: '#ff0000', style: 'line', hideInLegend: true });
    }
  }

  const messages = [...pr.warnings];
  if (sf && !(sf.c > 0)) messages.push('Concentration is not positive at this slice. Molar mass cannot be computed without the concentration.');
  if (fit && fit.fit && !Number.isFinite(fit.rg) && fit.M > 0) messages.push('The angular dependence gives a negative mean-square radius at this slice (radius below the detection limit or detectors not normalized).');

  const detRows: PGRow[] = method.ls.angles.map((a, j) => ({
    key: `det${j}`,
    label: `${processed.lsIds[j] ?? `LS ${j + 1}`}  (${a.toFixed(2)}°)`,
    cells: [
      {
        value: method.ls.enabled[j] !== false,
        kind: 'checkbox',
        onChange: (v) => update((m) => ({ ...m, ls: { ...m.ls, enabled: m.ls.angles.map((_, k) => (k === j ? !!v : m.ls.enabled[k] !== false)) } })),
      },
    ],
  }));

  const rows: PGRow[] = [
    { key: 'M', label: 'Molar Mass', cells: [{ value: pm(fit?.M, fit?.Merr, 'g/mol') }] },
    { key: 'rg', label: 'rms radius', cells: [{ value: pm(fit?.rg, fit?.rgErr, 'nm', 1) }] },
    {
      key: 'peak',
      label: 'Peak Number',
      cells: [{ value: String(pr.index + 1), kind: 'select', options: processed.peaks.map((p, i) => ({ value: String(i + 1), label: `${i + 1} (${p.peak.name})` })), onChange: (v) => setPeakIdx(Number(v) - 1) }],
    },
    { key: 'slice', label: 'Slice Index', cells: [{ value: cur + 1, kind: 'number', digits: 0, onChange: (v) => setSlice(Math.round(Number(v)) - 1) }] },
    { key: 'model', label: 'Model', cells: [{ value: pr.peak.lsModel, kind: 'select', options: ['Zimm', 'Debye', 'Berry'], onChange: (v) => setPeak({ lsModel: v as LSModel }) }] },
    { key: 'deg', label: 'Fit Degree', cells: [{ value: String(pr.peak.fitDegree), kind: 'select', options: ['1', '2', '3'], onChange: (v) => setPeak({ fitDegree: Number(v) }) }] },
    { key: 'abs', label: 'Abscissa Position', cells: [{ value: `${processed.t[cur].toFixed(3)} min` }] },
    { key: 'conc', label: 'Concentration', cells: [{ value: pm(sf ? sf.c * 1000 : NaN, undefined, 'mg/mL') }] },
    { key: 'dndc', label: 'dn/dc (mL/g)', cells: [{ value: pr.peak.dndc, kind: 'number', digits: 4, onChange: (v) => setPeak({ dndc: Number(v) }) }] },
    { key: 'r2', label: 'Fit R²', cells: [{ value: fit?.r2, digits: 4 }] },
    { key: 'det', label: 'Enabled Detectors', children: detRows },
  ];

  const control = familyTraces(processed, (id) => vis[id] ?? true);
  const step = (d: number) => setSlice(Math.max(pr.i0, Math.min(pr.i1, cur + d)));
  return (
    <ViewFrame
      tab={tab}
      messages={messages}
      main={
        <div
          className="split-h"
          tabIndex={0}
          onKeyDown={(ev) => {
            if (ev.key === 'ArrowLeft') step(-1);
            if (ev.key === 'ArrowRight') step(1);
            if (ev.key === 'PageUp') step(-10);
            if (ev.key === 'PageDown') step(10);
          }}
          style={{ outline: 'none' }}
        >
          <ChartPane
            title="results graph"
            primary={false}
            series={resultSeries}
            legend="none"
            xAxis={{ label: 'sin²(θ/2)', min: 0, max: 1 }}
            yAxis={{ label: fit?.yLabel ?? 'K*c/R(θ)' }}
            footerRight={fit?.fit ? `Fit R²=${fit.r2.toFixed(4)}` : undefined}
          />
          <ChartPane
            title="control graph"
            series={control}
            relativeScale
            legend="top"
            regions={[{ id: 'pk', x1: pr.peak.start, x2: pr.peak.end, label: pr.peak.name }]}
            markers={[{ id: 'slice', x: processed.t[cur], draggable: true, color: '#000' }]}
            xAxis={{ label: 'time (min)' }}
            yAxis={{ label: 'Relative Scale' }}
            footerRight={`Index = ${processed.t[cur].toFixed(3)} min`}
            onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
            onClick={(x) => setSlice(nearest(processed.t, x))}
            onMarkerChange={(_, x) => setSlice(nearest(processed.t, x))}
          />
        </div>
      }
      bottom={<PropertyGrid columns={['Value']} rows={rows} columnWidth={260} />}
      bottomFraction={0.36}
    />
  );
}

function nearest(t: Float64Array, x: number): number {
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(t[lo] - x) <= Math.abs(t[hi] - x) ? lo : hi;
}
