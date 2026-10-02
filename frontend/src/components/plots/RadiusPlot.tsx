/**
 * RadiusPlot — Rg(v) plot showing RMS radius vs. time for each peak.
 *
 * A standalone Plotly plot (separate from the chromatogram) because radius
 * values (nm) have a different scale from detector signals. One scatter
 * trace per peak, colored from a fixed palette. Reads resultsStore.radius
 * for slice data and peakStore.peaks for trace labels. Fetches on mount /
 * experiment change.
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

export default function RadiusPlot() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const radius = useResultsStore((s) => s.radius);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchRadius = useResultsStore((s) => s.fetchRadius);
  const peaks = usePeakStore((s) => s.peaks);

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchRadius(currentExperimentId);
  }, [currentExperimentId, fetchRadius]);

  const { data, layout } = useMemo<{
    data: Partial<Data>[];
    layout: Partial<Layout>;
  }>(() => {
    if (!radius || radius.peaks.length === 0) {
      return { data: [], layout: {} };
    }
    const peakLabel = (peakId: number) => {
      const p = peaks.find((pk) => pk.id === peakId);
      if (!p) return `Peak ${peakId}`;
      const num = p.range_number ?? peakId;
      return p.range_name ? `Peak ${num} · ${p.range_name}` : `Peak ${num}`;
    };
    const traces: Partial<Data>[] = radius.peaks.map((slice, i) => {
      const x: number[] = [];
      const y: number[] = [];
      slice.time.forEach((t, j) => {
        const r = slice.radius[j];
        if (t != null && r != null && Number.isFinite(r)) {
          x.push(t);
          y.push(r);
        }
      });
      return {
        x,
        y,
        type: 'scatter',
        mode: 'lines',
        name: peakLabel(slice.peak_id),
        line: {
          width: 1.5,
          color: PEAK_COLORS[i % PEAK_COLORS.length],
        },
      };
    });
    const plotLayout: Partial<Layout> = {
      title: { text: 'Radius vs. Volume', font: { size: 16 } },
      xaxis: {
        title: { text: 'Time (min)' },
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      yaxis: {
        title: { text: 'Radius (nm)' },
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
      margin: { l: 60, r: 30, t: 50, b: 50 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      showlegend: true,
      autosize: true,
    };
    return { data: traces, layout: plotLayout };
  }, [radius, peaks]);

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-sm">Select an experiment to view radius plot</p>
      </div>
    );
  }

  if (loading && !radius) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading radius...
      </div>
    );
  }

  if (error && !radius) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!radius || radius.peaks.length === 0) {
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
        <p className="text-sm">Run analysis to see radius plot</p>
      </div>
    );
  }

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
    toImageButtonOptions: { format: 'png' as const, filename: 'radius' },
  };

  return (
    <div className="flex flex-col h-full">
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