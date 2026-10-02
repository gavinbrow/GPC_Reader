/**
 * BranchingPanel — polymer branching analysis panel.
 *
 * Provides inputs for branching_type (tri/tetra/star/comb) and linear
 * reference M and Rg arrays (comma-separated textareas). The "Analyze" button
 * parses the textareas into JSON arrays and calls fetchBranching. Shows
 * per-peak mean branching ratio g, mean branch units, mean LCB frequency,
 * and an inline Plotly plot of branching ratio g vs M (log X axis).
 * If the linear reference is missing or results are all NaN, shows a message.
 */
import { useMemo, useState, lazy, Suspense } from 'react';
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

const selectClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

const textareaClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400 resize-y';

function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function mean(values: (number | null)[]): number | null {
  const vals: number[] = [];
  for (const v of values) {
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function parseNumberList(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(/[,\s]+/).filter((s) => s.length > 0);
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return nums;
}

const BRANCHING_TYPES: { value: string; label: string }[] = [
  { value: 'tri', label: 'Trifunctional' },
  { value: 'tetra', label: 'Tetrafunctional' },
  { value: 'star', label: 'Star' },
  { value: 'comb', label: 'Comb' },
];

export default function BranchingPanel() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const branching = useResultsStore((s) => s.branching);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchBranching = useResultsStore((s) => s.fetchBranching);
  const peaks = usePeakStore((s) => s.peaks);

  const [branchingType, setBranchingType] = useState<string>('tri');
  const [refM, setRefM] = useState<string>('');
  const [refRg, setRefRg] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);

  const peakLabel = (peakId: number) => {
    const p = peaks.find((pk) => pk.id === peakId);
    if (!p) return `Peak ${peakId}`;
    const num = p.range_number ?? peakId;
    return p.range_name ? `Peak ${num} · ${p.range_name}` : `Peak ${num}`;
  };

  const hasData = useMemo(() => {
    if (!branching) return false;
    return branching.peaks.some((slice) => {
      return slice.branching_ratio_g.some(
        (v) => v != null && Number.isFinite(v),
      );
    });
  }, [branching]);

  const { plotData, plotLayout } = useMemo<{
    plotData: Partial<Data>[];
    plotLayout: Partial<Layout>;
  }>(() => {
    if (!branching || !hasData) {
      return { plotData: [], plotLayout: {} };
    }
    const traces: Partial<Data>[] = branching.peaks.map((slice, i) => {
      const x: number[] = [];
      const y: number[] = [];
      slice.molar_mass.forEach((m, j) => {
        const g = slice.branching_ratio_g[j];
        if (m != null && g != null && Number.isFinite(m) && m > 0 && Number.isFinite(g)) {
          x.push(m);
          y.push(g);
        }
      });
      return {
        x,
        y,
        type: 'scatter',
        mode: 'markers',
        name: peakLabel(slice.peak_id),
        marker: { size: 4, color: PEAK_COLORS[i % PEAK_COLORS.length] },
      };
    });
    const layout: Partial<Layout> = {
      title: { text: 'Branching Ratio g vs M', font: { size: 12 } },
      xaxis: {
        title: { text: 'Molar Mass (g/mol)' },
        type: 'log',
        gridcolor: '#e2e8f0',
      },
      yaxis: { title: { text: 'g' }, gridcolor: '#e2e8f0' },
      legend: { font: { size: 9 }, bgcolor: 'rgba(255,255,255,0.8)' },
      margin: { l: 50, r: 20, t: 40, b: 40 },
      autosize: true,
    };
    return { plotData: traces, plotLayout: layout };
  }, [branching, hasData, peaks]);

  const handleAnalyze = () => {
    if (currentExperimentId == null) return;
    setParseError(null);
    const mArr = parseNumberList(refM);
    const rgArr = parseNumberList(refRg);
    if (refM.trim() !== '' && mArr === null) {
      setParseError('Linear reference M: invalid number list');
      return;
    }
    if (refRg.trim() !== '' && rgArr === null) {
      setParseError('Linear reference Rg: invalid number list');
      return;
    }
    if (
      (mArr != null && rgArr == null) ||
      (mArr == null && rgArr != null)
    ) {
      setParseError('Provide both M and Rg reference arrays, or leave both empty');
      return;
    }
    const params: Record<string, unknown> = {
      branching_type: branchingType,
    };
    if (mArr != null && rgArr != null) {
      params.linear_reference_m = JSON.stringify(mArr);
      params.linear_reference_rg = JSON.stringify(rgArr);
    }
    fetchBranching(currentExperimentId, params as Parameters<typeof fetchBranching>[1]);
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to run branching analysis.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Branching Analysis
      </h4>

      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">Branching type</span>
        <select
          value={branchingType}
          onChange={(e) => setBranchingType(e.target.value)}
          className={selectClass}
        >
          {BRANCHING_TYPES.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">
          Linear reference M (comma-separated)
        </span>
        <textarea
          value={refM}
          onChange={(e) => setRefM(e.target.value)}
          placeholder="1000, 5000, 10000, 50000, 100000"
          rows={2}
          className={textareaClass}
        />
      </label>

      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">
          Linear reference Rg (comma-separated)
        </span>
        <textarea
          value={refRg}
          onChange={(e) => setRefRg(e.target.value)}
          placeholder="1, 2, 3, 5, 8"
          rows={2}
          className={textareaClass}
        />
      </label>

      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {loading ? 'Analyzing…' : 'Analyze'}
      </button>

      {parseError && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {parseError}
        </div>
      )}

      {error && branching == null && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {branching && !hasData && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Linear reference required for branching analysis
        </div>
      )}

      {branching && hasData && (
        <div className="space-y-3">
          {branching.peaks.map((slice, i) => {
            const meanG = mean(slice.branching_ratio_g);
            const meanBU = mean(slice.branch_units_per_molecule);
            const meanLCB = mean(slice.long_chain_branch_freq);
            const hasVals = meanG != null || meanBU != null;
            if (!hasVals) return null;
            return (
              <div
                key={slice.peak_id}
                className="border border-slate-200 rounded p-2 space-y-1"
              >
                <div
                  className="text-xs font-semibold"
                  style={{ color: PEAK_COLORS[i % PEAK_COLORS.length] }}
                >
                  {peakLabel(slice.peak_id)}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">mean g:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtNum(meanG)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">mean B/M:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtNum(meanBU)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">mean LCB:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtNum(meanLCB)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {plotData.length > 0 && (
            <div className="h-48 border border-slate-200 rounded overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                    Loading chart...
                  </div>
                }
              >
                <Plot
                  data={plotData as Data[]}
                  layout={plotLayout as Layout}
                  config={{
                    responsive: true,
                    displaylogo: false,
                    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
                  }}
                  useResizeHandler={true}
                  style={{ width: '100%', height: '100%' }}
                />
              </Suspense>
            </div>
          )}
        </div>
      )}
    </div>
  );
}