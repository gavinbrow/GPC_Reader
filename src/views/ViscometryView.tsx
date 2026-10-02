import { useState } from 'react';
import type { Tab } from '../store';
import type { ChartSeries } from '../chart/types';
import { ChartPane, ToolLabel, ToolSep, ViewFrame } from '../ui/ViewFrame';
import { PropertyGrid, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { num, pm, sci } from '../ui/format';
import { PeakSelect, scaleToWindow } from './AlignmentView';

export function ViscometryView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const [peakId, setPeakId] = useState<string | undefined>();
  const [vis, setVis] = useState<Record<string, boolean>>({});
  if (!ctx) return null;
  const { method, processed, update } = ctx;

  if (!processed.series.VIS) {
    return (
      <ViewFrame
        tab={tab}
        messages={['This experiment has no viscometer data.']}
        main={<div className="placeholder">Viscometry requires a differential viscometer (VIS) signal in the experiment.</div>}
      />
    );
  }
  const pr = processed.peaks.find((p) => p.peak.id === peakId) ?? processed.peaks[0];
  if (!pr) {
    return <ViewFrame tab={tab} messages={['No peaks are defined. Define peaks in the Peaks procedure first.']} main={<div className="placeholder" />} />;
  }

  const { peak, moments: mo } = pr;
  const lo = peak.start;
  const hi = peak.end;

  // Per-slice data, restricted to slices with a usable concentration.
  let cmax = 0;
  for (let k = 0; k < pr.c.length; k++) if (pr.c[k] > cmax) cmax = pr.c[k];
  const tt: number[] = [];
  const eta: number[] = [];
  const mm: number[] = [];
  const eta2: number[] = [];
  for (let k = 0; k < pr.t.length; k++) {
    const v = pr.eta?.[k];
    if (v !== undefined && v > 0 && pr.c[k] > 0.02 * cmax) {
      tt.push(pr.t[k]);
      eta.push(v);
      const M = pr.Mused[k];
      if (M > 0) {
        mm.push(M);
        eta2.push(v);
      }
    }
  }

  const timeSeries: ChartSeries[] = [
    { id: 'eta', label: '[η]', x: tt, y: eta, color: '#000', style: 'markers', markerSize: 2, axis: 'left', visible: vis.eta ?? true },
  ];
  const ri = processed.series.dRI;
  if (ri) timeSeries.push({ id: 'ri', label: 'dRI', x: processed.t, y: scaleToWindow(processed.t, ri.aligned, lo, hi), color: '#0000ff', style: 'line', axis: 'ri', visible: vis.ri ?? true });
  timeSeries.push({ id: 'vis', label: 'VIS', x: processed.t, y: scaleToWindow(processed.t, processed.series.VIS.aligned, lo, hi), color: '#d00000', style: 'line', axis: 'vis', visible: vis.vis ?? true });

  const mhSeries: ChartSeries[] = [{ id: 'mh', label: '[η] vs M', x: mm, y: eta2, color: '#000', style: 'markers', markerSize: 2, hideInLegend: true }];
  let mhNote: string | undefined;
  if (mm.length > 1 && mo.mhK > 0 && Number.isFinite(mo.mhA)) {
    const mmin = Math.min(...mm);
    const mmax = Math.max(...mm);
    const xs = Array.from({ length: 41 }, (_, i) => mmin * (mmax / mmin) ** (i / 40));
    mhSeries.push({ id: 'fit', label: 'fit', x: xs, y: xs.map((x) => mo.mhK * x ** mo.mhA), color: '#ff0000', style: 'line', hideInLegend: true });
    mhNote = `[η] = ${sci(mo.mhK, 3)} M^${mo.mhA.toFixed(3)}`;
  }

  const stat = pr.stats.VIS;
  const rows: PGRow[] = [
    {
      key: 'peak',
      label: 'Peak',
      cells: [{ value: peak.id, kind: 'select', options: processed.peaks.map((p) => ({ value: p.peak.id, label: p.peak.name })), onChange: (v) => setPeakId(String(v)) }],
    },
    { key: 'etaw', label: 'Intrinsic Viscosity, [η]w (mL/g)', cells: [{ value: pm(mo.etaW.v, mo.etaW.e, 'mL/g') }] },
    { key: 'etan', label: 'Intrinsic Viscosity, [η]n (mL/g)', cells: [{ value: pm(mo.etaN.v, mo.etaN.e, 'mL/g') }] },
    { key: 'rhw', label: 'Hydrodynamic Radius, Rh weight-average (nm)', cells: [{ value: pm(mo.rhW.v, mo.rhW.e, 'nm', 2) }] },
    { key: 'rhz', label: 'Hydrodynamic Radius, Rh z-average (nm)', cells: [{ value: pm(mo.rhZ.v, mo.rhZ.e, 'nm', 2) }] },
    { key: 'mhk', label: 'Mark-Houwink K (mL/g)', cells: [{ value: Number.isFinite(mo.mhK) ? sci(mo.mhK, 3) : 'n/a' }] },
    { key: 'mha', label: 'Mark-Houwink a', cells: [{ value: Number.isFinite(mo.mhA) ? mo.mhA.toFixed(3) : 'n/a' }] },
    { key: 'area', label: 'Specific viscosity peak area', cells: [{ value: stat ? num(stat.area, 4) : 'n/a' }] },
    { key: 'height', label: 'Specific viscosity peak height', cells: [{ value: stat ? sci(stat.height, 3) : 'n/a' }] },
  ];

  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolLabel>Peak:</ToolLabel>
          <PeakSelect peaks={method.peaks} value={peak.id} onChange={setPeakId} />
          <ToolSep />
          <label className="tool-check" title="[η] = sqrt(2 (η_sp − ln(1 + η_sp))) / c, valid also at high specific viscosity">
            <input type="checkbox" checked={method.viscosity.solomonCiuta} onChange={(ev) => update((m) => ({ ...m, viscosity: { ...m.viscosity, solomonCiuta: ev.target.checked } }))} />
            Solomon–Ciuta
          </label>
        </>
      }
      messages={[...pr.warnings]}
      main={
        <div className="split-h">
          <ChartPane
            title="Intrinsic Viscosity vs. Time"
            series={timeSeries}
            legend="top"
            xAxis={{ label: 'time (min)', min: lo, max: hi }}
            yAxis={{ label: 'Intrinsic Viscosity (mL/g)', log: true }}
            onToggleSeries={(id, v) => setVis((o) => ({ ...o, [id]: v }))}
          />
          <ChartPane
            title="Mark-Houwink Plot"
            primary={false}
            series={mhSeries}
            legend="none"
            xAxis={{ label: 'Molar Mass (g/mol)', log: true }}
            yAxis={{ label: 'Intrinsic Viscosity (mL/g)', log: true }}
            footerRight={mhNote}
          />
        </div>
      }
      bottom={<PropertyGrid columns={['Value']} rows={rows} labelWidth={330} columnWidth={260} />}
      bottomFraction={0.3}
    />
  );
}
