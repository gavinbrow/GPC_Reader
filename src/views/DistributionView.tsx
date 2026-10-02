import { useState } from 'react';
import type { Tab } from '../store';
import { newId, type DistributionRange, type Method } from '../analysis/method';
import { rangeFractions, type DistributionCurve } from '../analysis/distribution';
import type { PeakResult } from '../analysis/pipeline';
import type { ChartRegion, ChartSeries } from '../chart/types';
import { ChartPane, ToolButton, ToolLabel, ToolSelect, ToolSep, ViewFrame } from '../ui/ViewFrame';
import { PropertyGrid, type PGCell, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { IconMinus, IconPlus } from '../ui/icons';
import { num } from '../ui/format';
import { EmptyView, PeakSelect, peakDistribution, windowed } from './ResultsFittingView';

type Quantity = Method['distribution']['quantity'];
type Scale = Method['distribution']['scale'];

interface RangeMoments {
  n: number;
  w: number;
  z: number;
}

/**
 * Number / weight / z averages of the quantity (molar mass, or rms radius with
 * the same weights as the peak moments) over the slices of a peak whose
 * quantity lies in [lo, hi].
 */
export function rangeMoments(pr: PeakResult, quantity: Quantity, lo: number, hi: number): RangeMoments {
  const isMass = quantity === 'Molar Mass';
  const q = windowed(pr, isMass ? 'mass' : 'radius');
  const Mw = windowed(pr, 'mass');
  let s0 = 0;
  let sm1 = 0;
  let s1 = 0;
  let s2 = 0;
  let rn = 0;
  let rw = 0;
  let rz = 0;
  let wn = 0;
  let wz = 0;
  for (let i = 0; i < q.length; i++) {
    const c = pr.c[i];
    const M = Mw[i];
    const v = q[i];
    if (!(c > 0) || !(M > 0) || !(v > 0) || v < lo || v > hi) continue;
    s0 += c;
    sm1 += c / M;
    s1 += c * M;
    s2 += c * M * M;
    rn += (c / M) * v * v;
    rw += c * v * v;
    rz += c * M * v * v;
    wn += c / M;
    wz += c * M;
  }
  if (!(s0 > 0)) return { n: NaN, w: NaN, z: NaN };
  if (isMass) return { n: s0 / sm1, w: s1 / s0, z: s2 / s1 };
  return { n: Math.sqrt(rn / wn), w: Math.sqrt(rw / s0), z: Math.sqrt(rz / wz) };
}

/** Abscissa at which the cumulative distribution reaches fraction f. */
function quantileX(d: DistributionCurve, f: number): number {
  for (let i = 0; i < d.x.length; i++) if (d.cumulative[i] >= f) return d.x[i];
  return d.x[d.x.length - 1];
}

export function DistributionView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [peakIdx, setPeakIdx] = useState(0);
  const [sel, setSel] = useState(0);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<{ id: string; x1: number; x2: number } | null>(null);
  if (!ctx) return null;
  const { method, processed, update } = ctx;
  const pr = processed.peaks[Math.min(peakIdx, processed.peaks.length - 1)];
  if (!pr) return <EmptyView tab={tab} text="No peaks are defined. Define peaks in the Peaks procedure first." />;

  const { quantity, scale } = method.distribution;
  const isMass = quantity === 'Molar Mass';
  const logScale = scale === 'Log';
  const peakId = pr.peak.id;
  const ranges: DistributionRange[] = method.distribution.ranges[peakId] ?? [];
  const curve = peakDistribution(pr, isMass ? 'mass' : 'radius');
  const fitted = isMass ? pr.massFit : pr.radiusFit;
  const selIdx = Math.min(sel, ranges.length - 1);

  const setDist = (patch: Partial<Method['distribution']>) => update((m) => ({ ...m, distribution: { ...m.distribution, ...patch } }));
  const setRanges = (fn: (r: DistributionRange[]) => DistributionRange[]) =>
    update((m) => ({ ...m, distribution: { ...m.distribution, ranges: { ...m.distribution.ranges, [peakId]: fn(m.distribution.ranges[peakId] ?? []) } } }));
  const patchRange = (id: string, patch: Partial<DistributionRange>) =>
    setRanges((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const n = { ...r, ...patch };
        if (n.start > n.stop) [n.start, n.stop] = [n.stop, n.start];
        return n;
      }),
    );
  const addRange = () => {
    if (!curve) return;
    setRanges((rs) => [...rs, { id: newId('rg'), name: `Range ${rs.length + 1}`, start: quantileX(curve, 0.05), stop: quantileX(curve, 0.95) }]);
    setSel(ranges.length);
  };
  const deleteRange = () => {
    if (selIdx < 0) return;
    setRanges((rs) => rs.filter((_, i) => i !== selIdx));
    setSel(Math.max(0, selIdx - 1));
  };

  const unit = isMass ? 'g/mol' : 'nm';
  const series: ChartSeries[] = [];
  if (curve) {
    const diffName = `${logScale ? 'log' : 'linear'} differential ${isMass ? 'molar mass' : 'rms radius'}`;
    series.push(
      { id: 'cum', label: `cumulative ${isMass ? 'molar mass' : 'rms radius'}`, x: curve.x, y: curve.cumulative, color: '#000', axis: 'left', visible: vis.cum ?? true },
      { id: 'diff', label: diffName, x: curve.x, y: logScale ? curve.differentialLog : curve.differential, color: '#ff0000', axis: 'right', visible: vis.diff ?? true },
    );
  }
  const regions: ChartRegion[] = ranges.map((r, i) => {
    const d = drag?.id === r.id ? drag : null;
    return { id: r.id, x1: d ? d.x1 : r.start, x2: d ? d.x2 : r.stop, kind: 'flat', label: r.name, editable: true, selected: i === selIdx };
  });

  const digits = isMass ? 0 : 2;
  const col = (r: DistributionRange, i: number) => {
    const fr = curve ? rangeFractions(curve, r.start, r.stop) : { below: NaN, within: NaN, above: NaN };
    const mo = rangeMoments(pr, quantity, r.start, r.stop);
    return { r, i, fr, mo };
  };
  const cols = ranges.map(col);
  const cells = (f: (c: ReturnType<typeof col>) => PGCell): PGCell[] => cols.map(f);
  const pct = (v: number): PGCell => ({ value: Number.isFinite(v) ? v.toFixed(2) : 'n/a' });
  const rows: PGRow[] = [
    { key: 'name', label: 'Name', cells: cells(({ r }) => ({ value: r.name, kind: 'text', onChange: (v) => patchRange(r.id, { name: String(v) }) })) },
    { key: 'data', label: 'Distribution Data', cells: cells(() => ({ value: quantity })) },
    { key: 'start', label: 'Start', cells: cells(({ r }) => ({ value: r.start, kind: 'number', digits, unit, onChange: (v) => patchRange(r.id, { start: Number(v) }) })) },
    { key: 'stop', label: 'Stop', cells: cells(({ r }) => ({ value: r.stop, kind: 'number', digits, unit, onChange: (v) => patchRange(r.id, { stop: Number(v) }) })) },
    { key: 'low', label: 'Low %', title: 'Weight percent below Start', cells: cells(({ fr }) => pct(fr.below)) },
    { key: 'high', label: 'High %', title: 'Weight percent above Stop', cells: cells(({ fr }) => pct(fr.above)) },
    { key: 'cum', label: 'Cumulative %', title: 'Weight percent between Start and Stop', cells: cells(({ fr }) => pct(fr.within)) },
    {
      key: 'moments',
      label: 'Moments',
      defaultOpen: true,
      children: [
        { key: 'mn', label: 'Number Averaged', cells: cells(({ mo }) => ({ value: num(mo.n) })) },
        { key: 'mw', label: 'Weight Averaged', cells: cells(({ mo }) => ({ value: num(mo.w) })) },
        { key: 'mz', label: 'Z Averaged', cells: cells(({ mo }) => ({ value: num(mo.z) })) },
      ],
    },
  ];

  const messages = [...pr.warnings];
  if (!fitted) {
    messages.push(
      `The ${isMass ? 'molar mass' : 'rms radius'} results of this peak are not fitted. Fit them in Results Fitting to obtain a smooth distribution; the current curve is a histogram of the noisy slice values.`,
    );
  }
  if (!curve) messages.push('The distribution cannot be computed: fewer than 3 slices have a positive concentration and result.');

  return (
    <ViewFrame
      tab={tab}
      messages={messages}
      toolbar={
        <>
          <ToolLabel>Distribution Type:</ToolLabel>
          <ToolSelect value={quantity} options={['Molar Mass', 'rms radius'] as Quantity[]} onChange={(v) => setDist({ quantity: v })} width={110} />
          <ToolLabel>Scale:</ToolLabel>
          <ToolSelect value={scale} options={['Linear', 'Log'] as Scale[]} onChange={(v) => setDist({ scale: v })} width={80} />
          <ToolSep />
          <PeakSelect peaks={processed.peaks} value={pr.index} onChange={(i) => setPeakIdx(i)} />
          <ToolSep />
          <ToolButton icon={<IconPlus />} onClick={addRange} disabled={!curve} title="Add a range to the selected peak">
            Add Range
          </ToolButton>
          <ToolButton icon={<IconMinus />} onClick={deleteRange} disabled={selIdx < 0} title="Delete the selected range">
            Delete Range
          </ToolButton>
          {ranges.length > 0 && (
            <>
              <ToolLabel>Range:</ToolLabel>
              <ToolSelect value={selIdx} options={ranges.map((r, i) => ({ value: i, label: r.name }))} onChange={setSel} width={100} />
            </>
          )}
        </>
      }
      main={
        <ChartPane
          title="Distribution Analysis"
          series={series}
          legend="top"
          regions={regions}
          resetKey={pr.index * 100 + (isMass ? 0 : 10) + (logScale ? 1 : 0)}
          xAxis={{ label: isMass ? 'Molar Mass (g/mol)' : 'rms radius (nm)', log: logScale, min: logScale ? undefined : 0 }}
          yAxis={{ label: 'Cumulative Weight Fraction', min: 0, max: 1 }}
          y2Axis={{ label: logScale ? 'Differential Weight Fraction' : `Differential Weight Fraction (${isMass ? 'mol/g' : '1/nm'})`, min: 0 }}
          onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
          onClick={(x) => {
            const i = ranges.findIndex((r) => x >= r.start && x <= r.stop);
            if (i >= 0) setSel(i);
          }}
          onRegionChange={(id, x1, x2, done) => {
            const i = ranges.findIndex((r) => r.id === id);
            if (i >= 0) setSel(i);
            if (done) {
              setDrag(null);
              patchRange(id, { start: x1, stop: x2 });
            } else setDrag({ id, x1, x2 });
          }}
        />
      }
      bottom={<PropertyGrid columns={ranges.map((_, i) => String(i + 1))} rows={rows} labelWidth={200} columnWidth={170} />}
      bottomFraction={0.34}
    />
  );
}
