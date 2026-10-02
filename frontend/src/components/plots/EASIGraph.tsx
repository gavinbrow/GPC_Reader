/**
 * EASIGraph — overlay chromatograms from multiple experiments on one plot.
 *
 * Fetches the RI chromatogram for each selected experiment and overlays them
 * as separate Plotly traces. Uses the same lazy-loaded Plotly pattern as
 * other plot components.
 */
import { useEffect, useMemo, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import * as api from '../../api/endpoints';
import type { ChromatogramResponse } from '../../types/chromatogram';

interface TraceData {
  experimentId: number;
  sampleName: string;
  time: number[];
  signal: number[];
}

export default function EASIGraph() {
  const experiments = useExperimentStore((s) => s.experiments);
  const fetchExperiments = useExperimentStore((s) => s.fetchExperiments);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [traces, setTraces] = useState<TraceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [PlotlyComponent, setPlotlyComponent] = useState<typeof import('react-plotly.js').default | null>(null);

  useEffect(() => {
    fetchExperiments(1);
  }, [fetchExperiments]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('react-plotly.js');
      // `mod.default` is a class component (a function). Passing it directly to
      // the state setter would make React treat it as a functional updater and
      // CALL it — throwing "Cannot call a class as a function" and crashing the
      // whole page. Wrap it in a thunk so React stores the component itself.
      if (!cancelled) setPlotlyComponent(() => mod.default);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleToggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleLoad = async () => {
    if (selectedIds.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const newTraces: TraceData[] = [];
      for (const id of Array.from(selectedIds)) {
        const chrom: ChromatogramResponse = await api.getChromatogram(id);
        const exp = experiments.find((e) => e.id === id);
        const ri = chrom.detectors.RI;
        if (ri && ri.data) {
          newTraces.push({
            experimentId: id,
            sampleName: exp?.sample_name || `Exp ${id}`,
            time: chrom.time,
            signal: ri.data,
          });
        }
      }
      setTraces(newTraces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chromatograms');
    } finally {
      setLoading(false);
    }
  };

  const plotData = useMemo(() => {
    return traces.map((t) => ({
      x: t.time,
      y: t.signal,
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: t.sampleName,
      line: { width: 1.5 },
    }));
  }, [traces]);

  const plotLayout = useMemo(
    () => ({
      title: { text: 'EASI Graph \u2014 Chromatogram Overlay', font: { size: 14 } },
      xaxis: { title: { text: 'Time (min)' }, gridcolor: '#e2e8f0' },
      yaxis: { title: { text: 'Signal' }, gridcolor: '#e2e8f0' },
      margin: { l: 50, r: 20, t: 40, b: 40 },
      legend: { font: { size: 10 } },
      plot_bgcolor: '#fafafa',
      paper_bgcolor: '#ffffff',
    }),
    [],
  );

  return (
    <div className="h-full flex flex-col p-2 space-y-2">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="max-h-24 overflow-y-auto border border-slate-200 rounded p-1 space-y-0.5 flex-1">
          {experiments.map((e) => (
            <label
              key={e.id}
              className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer px-1 py-0.5 rounded hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(e.id)}
                onChange={() => handleToggle(e.id)}
              />
              <span className="truncate">{e.sample_name || 'Unnamed'}</span>
            </label>
          ))}
        </div>
        <button
          onClick={handleLoad}
          disabled={loading || selectedIds.size === 0}
          className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {loading ? 'Loading\u2026' : `Overlay ${selectedIds.size} run(s)`}
        </button>
      </div>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Plot */}
      <div className="flex-1 overflow-hidden">
        {traces.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            {loading ? 'Loading\u2026' : 'Select experiments and click "Overlay" to display chromatograms'}
          </div>
        ) : PlotlyComponent ? (
          <PlotlyComponent
            data={plotData}
            layout={plotLayout}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            Loading plot library\u2026
          </div>
        )}
      </div>
    </div>
  );
}