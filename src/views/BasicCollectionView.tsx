import { useMemo } from 'react';
import type { Tab } from '../store';
import { ChartPane, ViewFrame } from '../ui/ViewFrame';
import { PropertyGrid, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { rawAxis, toChartSeries } from '../ui/series';
import { useSeriesVisibility } from './useSeriesVisibility';

/** Raw data exactly as collected (no despiking or baselines). */
export function BasicCollectionView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  const e = ctx?.experiment;
  const shown = useMemo(() => (e ? e.series.filter((s) => s.kind !== 'AUX' || s.defaultVisible) : []), [e]);
  const vis = useSeriesVisibility(shown);
  if (!ctx || !e) return null;
  const hasHplc = shown.some((s) => s.kind === 'HPLC' && vis.isVisible(s.id));
  const series = shown.map((s) =>
    toChartSeries(s, s.time, s.values, { visible: vis.isVisible(s.id), axis: rawAxis(s, hasHplc ? 'hplc' : 'uv'), ls90: s.defaultVisible && s.kind === 'LS' }),
  );
  const c = e.collection;
  const rows: PGRow[] = [
    { key: 'op', label: 'Collection Operator', cells: [{ value: c.operator || '—' }] },
    { key: 'cd', label: 'Calculated Duration (min)', cells: [{ value: c.duration, digits: 2 }] },
    { key: 'trig', label: 'Trigger on Auto-Inject', cells: [{ value: c.triggerOnAutoInject, kind: 'checkbox' }] },
    { key: 'dur', label: 'Duration (min)', cells: [{ value: c.duration, digits: 2 }] },
    { key: 'int', label: 'Collection Interval (sec)', cells: [{ value: c.collectionInterval, digits: 3 }] },
    {
      key: 'hplc',
      label: 'HPLC Details',
      defaultOpen: true,
      children: [
        { key: 'vial', label: 'Vial Number', cells: [{ value: c.vial || '—' }] },
        { key: 'iv', label: 'Injection Volume (µL)', cells: [{ value: c.injectionVolume, digits: 2 }] },
        { key: 'flow', label: 'Flow Rate (mL/min)', cells: [{ value: c.flowRate, digits: 3 }] },
        { key: 'dev', label: 'Devices', cells: [{ value: e.hplcDevices.join(', ') || '—' }] },
      ],
    },
    {
      key: 'det',
      label: 'Details',
      children: [
        { key: 'ct', label: 'Collection Time', cells: [{ value: c.collectionTime || '—' }] },
        { key: 'file', label: 'File', cells: [{ value: e.fileName }] },
        { key: 'path', label: 'Original Path', cells: [{ value: e.path || '—' }] },
        { key: 'ver', label: 'ASTRA Version', cells: [{ value: e.astraVersion || '—' }] },
        { key: 'proc', label: 'Last Processed (ASTRA)', cells: [{ value: e.processingDateTime || '—' }] },
        { key: 'script', label: 'Collection Script', cells: [{ value: <span title={c.script}>{c.script ? `${c.script.split('\n').length} lines (hover)` : '—'}</span> }] },
      ],
    },
  ];
  return (
    <ViewFrame
      tab={tab}
      main={
        <ChartPane
          title={`Basic Collection: ${e.name}`}
          series={series}
          legend="right"
          xAxis={{ label: 'time (min)' }}
          yAxis={{ label: 'detector voltage (V)' }}
          y2Axis={{ label: hasHplc ? 'HPLC Data' : 'absorbance (AU)' }}
          onToggleSeries={vis.toggle}
        />
      }
      bottom={<PropertyGrid columns={['Value']} rows={rows} columnWidth={240} />}
      bottomFraction={0.3}
    />
  );
}
