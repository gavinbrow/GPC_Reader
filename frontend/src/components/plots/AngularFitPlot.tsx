/**
 * AngularFitPlot — per-slice angular fit quality (χ² vs. time).
 *
 * The backend angular-fit endpoint returns chi2, n_angles_used, fit_model,
 * and fit_degree per slice but does NOT return raw per-angle scatter points
 * or the fitted curve. Rather than requesting a backend change, this plot
 * visualizes fit QUALITY: χ² (reduced) vs. time, one line trace per peak (or
 * a single selected peak). Fit model + degree are shown as annotation text.
 * Reads resultsStore.angularFit. A peak selector dropdown filters to one
 * peak (or "All peaks"). Fetches on mount / experiment change.
 *
 * Simplification noted in TODO §3b.2: chi²-over-time is a legitimate
 * per-slice angular fit quality visualization without needing raw angle data.
 */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
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

const ALL_PEAKS = -1;

function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

export default function AngularFitPlot() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const angularFit = useResultsStore((s) => s.angularFit);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchAngularFit = useResultsStore((s) => s.fetchAngularFit);
  const peaks = usePeakStore((s) => s.peaks);

  const [selectedPeakId, setSelectedPeakId] = useState<number>(ALL_PEAKS);

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchAngularFit(currentExperimentId);
  }, [currentExperimentId, fetchAngularFit]);

  const peakLabel = (peakId: number) => {
    const p = peaks.find((pk) => pk.id === peakId);
    if (!p) return `Peak ${peakId}`;
    const num = p.range_number ?? peakId;
    return p.range_name ? `Peak ${num} · ${p.range_name}` : `Peak ${num}`;
  };

  const visiblePeaks = useMemo(() => {
    if (!angularFit || angularFit.peaks.length === 0) return [];
    if (selectedPeakId === ALL_PEAKS) return angularFit.peaks;
    return angularFit.peaks.filter((p) => p.peak_id === selectedPeakId);
  }, [angularFit, selectedPeakId]);

  const { data, layout } = useMemo<{
    data: Partial<Data>[];
    layout: Partial<Layout>;
  }>(() => {
    if (visiblePeaks.length === 0) {
      return { data: [], layout: {} };
    }
    const traces: Partial<Data>[] = visiblePeaks.map((slice, i) => {
      const x: number[] = [];
      const y: number[] = [];
      slice.time.forEach((t, j) => {
        const c = slice.chi2[j];
        if (t != null && c != null && Number.isFinite(c) && Number.isFinite(t)) {
          x.push(t);
          y.push(c);
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

    const annotations: NonNullable<Layout['annotations']> = [];
    visiblePeaks.forEach((slice, i) => {
      const color = PEAK_COLORS[i % PEAK_COLORS.length];
      annotations.push({
        xref: 'paper',
        yref: 'paper',
        x: 0.02,
        y: 0.98 - i * 0.06,
        xanchor: 'left',
        yanchor: 'top',
        text: `${peakLabel(slice.peak_id)}: ${slice.fit_model ?? '—'} · deg ${slice.fit_degree ?? '—'}`,
        showarrow: false,
        font: { size: 10, color },
        bgcolor: 'rgba(255,255,255,0.7)',
      });
    });

    const plotLayout: Partial<Layout> = {
      title: { text: 'Angular Fit Quality (χ² vs. time)', font: { size: 16 } },
      xaxis: {
        title: { text: 'Time (min)' },
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      yaxis: {
        title: { text: 'χ² (reduced)' },
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
  }, [visiblePeaks, peaks]);

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-sm">Select an experiment to view angular fit</p>
      </div>
    );
  }

  if (loading && !angularFit) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading angular fit...
      </div>
    );
  }

  if (error && !angularFit) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!angularFit || angularFit.peaks.length === 0) {
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
        <p className="text-sm">Run analysis to see angular fit quality</p>
      </div>
    );
  }

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
    toImageButtonOptions: { format: 'png' as const, filename: 'angular-fit' },
  };

  const selectorClass =
    'text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <span className="text-xs text-slate-500">Peak:</span>
        <select
          value={selectedPeakId}
          onChange={(e) => setSelectedPeakId(Number(e.target.value))}
          className={selectorClass}
        >
          <option value={ALL_PEAKS}>All peaks</option>
          {angularFit.peaks.map((p) => (
            <option key={p.peak_id} value={p.peak_id}>
              {peakLabel(p.peak_id)}
            </option>
          ))}
        </select>
        {visiblePeaks.length === 1 && (
          <span className="text-xs text-slate-500 ml-auto">
            mean χ²: {fmtNum(meanChi2(visiblePeaks[0]))} · n angles:{' '}
            {fmtNum(meanAngles(visiblePeaks[0]), 1)}
          </span>
        )}
      </div>
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
    </div>
  );
}

function meanChi2(slice: {
  chi2: (number | null)[];
}): number | null {
  const vals: number[] = [];
  for (const c of slice.chi2) {
    if (c != null && Number.isFinite(c)) vals.push(c);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function meanAngles(slice: {
  n_angles_used: (number | null)[];
}): number | null {
  const vals: number[] = [];
  for (const c of slice.n_angles_used) {
    if (c != null && Number.isFinite(c)) vals.push(c);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}