/**
 * MarkHouwinkPlot — log([η]) vs log(M) scatter with MHS fit annotation.
 *
 * Reads resultsStore.viscometry and renders one scatter trace per peak
 * (intrinsic viscosity vs universal molar mass). If MHS constants (K, a, R²)
 * are available, they are shown as annotations. If no viscometer data is
 * present (empty arrays or NaN MHS constants), shows an empty-state message.
 * Fetches on mount / experiment change via fetchViscometry.
 */
import { useEffect, useMemo, lazy, Suspense } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';
import { usePeakStore } from '../../stores/peakStore';

const Plot = lazy(() => import('react-plotly.js'));

const PEAK_COLORS: string[] = [
  'rgb(0, 50, 120)',
  'rgb(180, 60, 20)',
  'rgb(20, 120, 60)',
  'rgb(120, 30, 130)',
  'rgb(180, 120, 0)',
  'rgb(0, 130, 130)',
  'rgb(200, 50, 100)',
  'rgb(60, 60, 60)',
];

function fmtNum(v: number | null | undefined, digits = 4): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

export default function MarkHouwinkPlot() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const viscometry = useResultsStore((s) => s.viscometry);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchViscometry = useResultsStore((s) => s.fetchViscometry);
  const peaks = usePeakStore((s) => s.peaks);

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchViscometry(currentExperimentId);
  }, [currentExperimentId, fetchViscometry]);

  const peakLabel = (peakId: number) => {
    const p = peaks.find((pk) => pk.id === peakId);
    if (!p) return `Peak ${peakId}`;
    const num = p.range_number ?? peakId;
    return p.range_name ? `Peak ${num} · ${p.range_name}` : `Peak ${num}`;
  };

  const hasData = useMemo(() => {
    if (!viscometry) return false;
    return viscometry.peaks.some((slice) => {
      return slice.intrinsic_viscosity.some(
        (v) => v != null && Number.isFinite(v) && v > 0,
      );
    });
  }, [viscometry]);

  const { data, layout } = useMemo<{
    data: Partial<Data>[];
    layout: Partial<Layout>;
  }>(() => {
    if (!viscometry || !hasData) {
      return { data: [], layout: {} };
    }
    const traces: Partial<Data>[] = [];
    const annotations: NonNullable<Layout['annotations']> = [];
    viscometry.peaks.forEach((slice, i) => {
      const color = PEAK_COLORS[i % PEAK_COLORS.length];
      const x: number[] = [];
      const y: number[] = [];
      slice.universal_molar_mass.forEach((um, j) => {
        const iv = slice.intrinsic_viscosity[j];
        if (
          um != null &&
          iv != null &&
          Number.isFinite(um) &&
          um > 0 &&
          Number.isFinite(iv) &&
          iv > 0
        ) {
          x.push(Math.log10(um));
          y.push(Math.log10(iv));
        }
      });
      if (x.length === 0) return;
      traces.push({
        x,
        y,
        type: 'scatter',
        mode: 'markers',
        name: peakLabel(slice.peak_id),
        marker: { size: 4, color },
      });
    });

    if (
      viscometry.mhs_K != null &&
      viscometry.mhs_a != null &&
      Number.isFinite(viscometry.mhs_K) &&
      Number.isFinite(viscometry.mhs_a)
    ) {
      annotations.push({
        xref: 'paper',
        yref: 'paper',
        x: 0.02,
        y: 0.98,
        xanchor: 'left',
        yanchor: 'top',
        text: `MHS: K=${fmtNum(viscometry.mhs_K)}, a=${fmtNum(viscometry.mhs_a)}, R²=${fmtNum(viscometry.mhs_r_squared, 3)}`,
        showarrow: false,
        font: { size: 11, color: '#334155' },
        bgcolor: 'rgba(255,255,255,0.7)',
      });
    }

    const plotLayout: Partial<Layout> = {
      title: { text: 'Mark-Houwink-Sakurada Plot', font: { size: 16 } },
      xaxis: {
        title: { text: 'log(M)' },
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      yaxis: {
        title: { text: 'log([η])' },
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      legend: {
        x: 1,
        y: 1,
        xanchor: 'right',
        yanchor: 'top',
        font: { size: 10 },
        bgcolor: 'rgba(255,255,255,0.8)',
      },
      annotations,
      margin: { l: 60, r: 30, t: 50, b: 50 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      showlegend: true,
      autosize: true,
    };
    return { data: traces, layout: plotLayout };
  }, [viscometry, hasData, peaks]);

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-sm">Select an experiment to view Mark-Houwink plot</p>
      </div>
    );
  }

  if (loading && !viscometry) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading viscometry...
      </div>
    );
  }

  if (error && !viscometry) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!viscometry || !hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <svg
          className="h-16 w-16 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 13.125 4.5 13.125 7.5 9.375C10.5 5.625 13.5 18.375 16.5 14.625C18 12.75 19.5 12.375 21 12.375"
          />
        </svg>
        <p className="text-sm">No viscometer data available</p>
        <p className="text-xs mt-1">(viscometer is a stretch goal)</p>
      </div>
    );
  }

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
    toImageButtonOptions: { format: 'png' as const, filename: 'mark-houwink' },
  };

  return (
    <div className="flex-1 overflow-hidden">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            Loading chart library...
          </div>
        }
      >
        <Plot
          data={data as Data[]}
          layout={layout as Layout}
          config={config}
          useResizeHandler={true}
          style={{ width: '100%', height: '100%' }}
        />
      </Suspense>
    </div>
  );
}