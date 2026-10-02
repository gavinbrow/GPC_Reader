/**
 * DifferentialDistribution — KDE/binned differential molar-mass distribution.
 *
 * Shows the differential weight fraction as a function of molar mass on a
 * log X axis. One scatter trace per peak, colored from a fixed palette.
 * Reads resultsStore.distributions (filtered to type === 'diff'). A controls
 * bar above the plot exposes bins (number or "auto"), smoothing/bandwidth,
 * kernel, and optional range_min/range_max, which re-fetch distributions via
 * fetchDistributions(experimentId, params) on Apply. Fetches on mount /
 * experiment change. Range selection uses number inputs (a simplification of
 * the drag-on-graph interaction described in TODO §3b.2).
 */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';
import { usePeakStore } from '../../stores/peakStore';
import type { DistributionParams } from '../../types/results';

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

const KERNELS: { value: string; label: string }[] = [
  { value: 'gaussian', label: 'Gaussian' },
];

interface DistState {
  bins: string;
  smoothing: string;
  bandwidth: string;
  kernel: string;
  rangeMin: string;
  rangeMax: string;
}

function buildParams(s: DistState): DistributionParams {
  const params: DistributionParams = { type: 'diff', kernel: s.kernel };
  const binsTrim = s.bins.trim();
  if (binsTrim === 'auto' || binsTrim === '') {
    params.bins = 'auto';
  } else {
    const n = Number(binsTrim);
    if (Number.isFinite(n) && n > 0) params.bins = Math.round(n);
  }
  const sm = Number(s.smoothing);
  if (Number.isFinite(sm) && sm > 0) params.smoothing = sm;
  const bw = Number(s.bandwidth);
  if (Number.isFinite(bw) && bw > 0) params.bandwidth = bw;
  const rmin = Number(s.rangeMin);
  if (Number.isFinite(rmin)) params.range_min = rmin;
  const rmax = Number(s.rangeMax);
  if (Number.isFinite(rmax)) params.range_max = rmax;
  return params;
}

export default function DifferentialDistribution() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const distributions = useResultsStore((s) => s.distributions);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchDistributions = useResultsStore((s) => s.fetchDistributions);
  const peaks = usePeakStore((s) => s.peaks);

  const [state, setState] = useState<DistState>({
    bins: 'auto',
    smoothing: '',
    bandwidth: '',
    kernel: 'gaussian',
    rangeMin: '',
    rangeMax: '',
  });

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchDistributions(currentExperimentId, { type: 'diff', kernel: 'gaussian' });
  }, [currentExperimentId, fetchDistributions]);

  const handleApply = () => {
    if (currentExperimentId == null) return;
    fetchDistributions(currentExperimentId, buildParams(state));
  };

  const diffPeaks = useMemo(() => {
    if (!distributions) return [];
    return distributions.filter((d) => d.distribution_type === 'diff');
  }, [distributions]);

  const { data, layout } = useMemo<{
    data: Partial<Data>[];
    layout: Partial<Layout>;
  }>(() => {
    if (diffPeaks.length === 0) {
      return { data: [], layout: {} };
    }
    const peakLabel = (peakId: number) => {
      const p = peaks.find((pk) => pk.id === peakId);
      if (!p) return `Peak ${peakId}`;
      const num = p.range_number ?? peakId;
      return p.range_name ? `Peak ${num} · ${p.range_name}` : `Peak ${num}`;
    };
    const traces: Partial<Data>[] = diffPeaks.map((dist, i) => {
      const x: number[] = [];
      const y: number[] = [];
      dist.bin_centers.forEach((c, j) => {
        const w = dist.weights[j];
        if (c != null && w != null && Number.isFinite(c) && c > 0 && Number.isFinite(w)) {
          x.push(c);
          y.push(w);
        }
      });
      return {
        x,
        y,
        type: 'scatter',
        mode: 'lines',
        name: peakLabel(dist.peak_id),
        line: {
          width: 1.5,
          color: PEAK_COLORS[i % PEAK_COLORS.length],
          shape: 'hvh',
        },
      };
    });
    const plotLayout: Partial<Layout> = {
      title: { text: 'Differential Molar Mass Distribution', font: { size: 16 } },
      xaxis: {
        title: { text: 'Molar Mass (g/mol)' },
        type: 'log',
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      yaxis: {
        title: { text: 'Differential Weight' },
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
  }, [diffPeaks, peaks]);

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-sm">Select an experiment to view distributions</p>
      </div>
    );
  }

  if (loading && !distributions) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading distributions...
      </div>
    );
  }

  if (error && !distributions) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!distributions || diffPeaks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <DistributionControls
          state={state}
          setState={setState}
          onApply={handleApply}
        />
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
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
          <p className="text-sm">Run analysis to see differential distribution</p>
        </div>
      </div>
    );
  }

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
    toImageButtonOptions: { format: 'png' as const, filename: 'differential-distribution' },
  };

  return (
    <div className="flex flex-col h-full">
      <DistributionControls
        state={state}
        setState={setState}
        onApply={handleApply}
      />
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

interface ControlsProps {
  state: DistState;
  setState: (updater: (prev: DistState) => DistState) => void;
  onApply: () => void;
}

function DistributionControls({ state, setState, onApply }: ControlsProps) {
  const inputClass =
    'w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';
  const selectClass =
    'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';
  return (
    <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block w-24">
          <span className="block text-xs text-slate-500 mb-0.5">Bins</span>
          <input
            type="text"
            value={state.bins}
            placeholder="auto"
            onChange={(e) => setState((s) => ({ ...s, bins: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="block w-24">
          <span className="block text-xs text-slate-500 mb-0.5">Smoothing</span>
          <input
            type="number"
            min={0}
            step="any"
            value={state.smoothing}
            placeholder="0"
            onChange={(e) => setState((s) => ({ ...s, smoothing: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="block w-24">
          <span className="block text-xs text-slate-500 mb-0.5">Bandwidth</span>
          <input
            type="number"
            min={0}
            step="any"
            value={state.bandwidth}
            placeholder="auto"
            onChange={(e) => setState((s) => ({ ...s, bandwidth: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="block w-28">
          <span className="block text-xs text-slate-500 mb-0.5">Kernel</span>
          <select
            value={state.kernel}
            onChange={(e) => setState((s) => ({ ...s, kernel: e.target.value }))}
            className={selectClass}
          >
            {KERNELS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block w-28">
          <span className="block text-xs text-slate-500 mb-0.5">Range min</span>
          <input
            type="number"
            step="any"
            value={state.rangeMin}
            placeholder="—"
            onChange={(e) => setState((s) => ({ ...s, rangeMin: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="block w-28">
          <span className="block text-xs text-slate-500 mb-0.5">Range max</span>
          <input
            type="number"
            step="any"
            value={state.rangeMax}
            placeholder="—"
            onChange={(e) => setState((s) => ({ ...s, rangeMax: e.target.value }))}
            className={inputClass}
          />
        </label>
        <button
          onClick={onApply}
          className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
}