/**
 * PeakStatisticsTable — per-peak chromatographic statistics table.
 *
 * Reads resultsStore.peakStatistics and renders a table with columns Peak #,
 * tR, Peak Max, Width (base), Width (½h), Asymmetry, Tailing, Plates,
 * Resolution. A detector selector (RI/MALS/UV) at the top re-fetches via
 * fetchPeakStatistics(experimentId, { detector }). Fetches on mount and when
 * the detector changes.
 */
import { useEffect, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';
import { usePeakStore } from '../../stores/peakStore';

const selectClass =
  'text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

const DETECTORS: { value: string; label: string }[] = [
  { value: 'RI', label: 'RI' },
  { value: 'MALS', label: 'MALS' },
  { value: 'UV', label: 'UV' },
];

export default function PeakStatisticsTable() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const peakStatistics = useResultsStore((s) => s.peakStatistics);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchPeakStatistics = useResultsStore((s) => s.fetchPeakStatistics);
  const peaks = usePeakStore((s) => s.peaks);

  const [detector, setDetector] = useState<string>('RI');

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchPeakStatistics(currentExperimentId, { detector: detector as 'RI' | 'MALS' | 'UV' });
  }, [currentExperimentId, detector, fetchPeakStatistics]);

  const peakLabel = (peakId: number) => {
    const p = peaks.find((pk) => pk.id === peakId);
    if (!p) return peakId;
    return p.range_number ?? peakId;
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to view peak statistics.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 bg-white">
      <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Peak Statistics
        </h4>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Detector:</span>
          <select
            value={detector}
            onChange={(e) => setDetector(e.target.value)}
            className={selectClass}
          >
            {DETECTORS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && !peakStatistics && (
        <div className="p-4 text-xs text-slate-400">Loading peak statistics...</div>
      )}

      {error && !peakStatistics && (
        <div className="m-4 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {peakStatistics && peakStatistics.peaks.length === 0 && (
        <div className="p-4 text-xs text-slate-400 italic">
          No peak statistics available — run analysis first.
        </div>
      )}

      {peakStatistics && peakStatistics.peaks.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="px-3 py-1.5 text-left font-medium">#</th>
                <th className="px-3 py-1.5 text-right font-medium">tR (min)</th>
                <th className="px-3 py-1.5 text-right font-medium">Peak Max</th>
                <th className="px-3 py-1.5 text-right font-medium">Width (base)</th>
                <th className="px-3 py-1.5 text-right font-medium">Width (½h)</th>
                <th className="px-3 py-1.5 text-right font-medium">Asymmetry</th>
                <th className="px-3 py-1.5 text-right font-medium">Tailing</th>
                <th className="px-3 py-1.5 text-right font-medium">Plates</th>
                <th className="px-3 py-1.5 text-right font-medium">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {peakStatistics.peaks.map((stat) => (
                <tr
                  key={stat.peak_id}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="px-3 py-1.5 text-slate-500 font-mono">
                    {peakLabel(stat.peak_id)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {fmtNum(stat.retention_time)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {fmtNum(stat.peak_max)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {fmtNum(stat.width_baseline)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {fmtNum(stat.width_half_height)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {fmtNum(stat.asymmetry_factor)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {fmtNum(stat.tailing_factor)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {fmtNum(stat.plate_count, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {fmtNum(stat.resolution)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}