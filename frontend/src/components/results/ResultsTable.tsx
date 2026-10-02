/**
 * ResultsTable — summary table of per-peak analysis results.
 *
 * Reads resultsStore.results and renders a table with columns Peak #, Name,
 * Start, End, Mn, Mw, Mz, Pd, Rg (nm), Area, Recovery. Molar mass moments
 * are shown in scientific notation; polydispersity, radius, area, and
 * recovery as fixed-point. Fetches results on mount / experiment change.
 */
import { useEffect } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function fmtSci(v: number | null | undefined, digits = 2): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toExponential(digits) : '—';
}

export default function ResultsTable() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const results = useResultsStore((s) => s.results);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchResults = useResultsStore((s) => s.fetchResults);

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchResults(currentExperimentId);
  }, [currentExperimentId, fetchResults]);

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-sm">Select an experiment to view results</p>
      </div>
    );
  }

  if (loading && !results) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading results...
      </div>
    );
  }

  if (error && !results) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!results || results.peaks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 py-10">
        <svg
          className="h-10 w-10 mb-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
          />
        </svg>
        <p className="text-xs">No results yet — run analysis to see results</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Results {results.peaks.length > 0 && `(${results.peaks.length})`}
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="px-3 py-1.5 text-left font-medium">#</th>
              <th className="px-3 py-1.5 text-left font-medium">Name</th>
              <th className="px-3 py-1.5 text-right font-medium">Start</th>
              <th className="px-3 py-1.5 text-right font-medium">End</th>
              <th className="px-3 py-1.5 text-right font-medium">Mn</th>
              <th className="px-3 py-1.5 text-right font-medium">Mw</th>
              <th className="px-3 py-1.5 text-right font-medium">Mz</th>
              <th
                className="px-3 py-1.5 text-right font-medium"
                title="Dispersity Đ = Mw/Mn"
              >
                Đ
              </th>
              <th className="px-3 py-1.5 text-right font-medium">Rg (nm)</th>
              <th className="px-3 py-1.5 text-right font-medium">Area</th>
              <th className="px-3 py-1.5 text-right font-medium">Recovery</th>
            </tr>
          </thead>
          <tbody>
            {results.peaks.map((peak) => (
              <tr
                key={peak.peak_id}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="px-3 py-1.5 text-slate-500 font-mono">
                  {peak.range_number ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-slate-700">
                  {peak.range_name || '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtNum(peak.range_start, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtNum(peak.range_end, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtSci(peak.mn, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtSci(peak.mw, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtSci(peak.mz, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtNum(peak.polydispersity, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtNum(peak.rms_radius, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtNum(peak.peak_area, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                  {fmtNum(peak.recovery, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}