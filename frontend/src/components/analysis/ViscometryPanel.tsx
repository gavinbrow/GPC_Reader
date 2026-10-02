/**
 * ViscometryPanel — viscometry summary + MHS constants display panel.
 *
 * Fetches viscometry on mount via fetchViscometry(experimentId). Shows MHS K,
 * a, R² and a per-peak summary (mean [η], mean Rh, mean universal M) if data is
 * present. If no viscometer data (empty arrays / NaN MHS constants), shows
 * "No viscometer data available". The Mark-Houwink plot is a separate center
 * tab (MarkHouwinkPlot.tsx).
 */
import { useEffect, useMemo } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';
import { usePeakStore } from '../../stores/peakStore';

function fmtNum(v: number | null | undefined, digits = 4): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function fmtSci(v: number | null | undefined, digits = 2): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toExponential(digits) : '—';
}

function mean(values: (number | null)[]): number | null {
  const vals: number[] = [];
  for (const v of values) {
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function ViscometryPanel() {
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

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to view viscometry.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Viscometry
      </h4>

      {loading && !viscometry && (
        <div className="text-xs text-slate-400">Loading viscometry...</div>
      )}

      {error && !viscometry && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {viscometry && !hasData && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          No viscometer data available (viscometer is a stretch goal)
        </div>
      )}

      {viscometry && hasData && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-slate-400">MHS K</div>
              <div className="font-mono text-slate-700">
                {fmtNum(viscometry.mhs_K)}
              </div>
            </div>
            <div>
              <div className="text-slate-400">MHS a</div>
              <div className="font-mono text-slate-700">
                {fmtNum(viscometry.mhs_a)}
              </div>
            </div>
            <div>
              <div className="text-slate-400">MHS R²</div>
              <div className="font-mono text-slate-700">
                {fmtNum(viscometry.mhs_r_squared, 4)}
              </div>
            </div>
          </div>

          {viscometry.peaks.map((slice, i) => {
            const meanIV = mean(slice.intrinsic_viscosity);
            const meanRh = mean(slice.hydrodynamic_radius);
            const meanUM = mean(slice.universal_molar_mass);
            const hasVals = meanIV != null || meanRh != null;
            if (!hasVals) return null;
            return (
              <div
                key={slice.peak_id}
                className="border border-slate-200 rounded p-2 space-y-1"
              >
                <div
                  className="text-xs font-semibold"
                  style={{ color: `rgb(${i * 30}, ${i * 20}, ${i * 10})` }}
                >
                  {peakLabel(slice.peak_id)}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">mean [η]:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtNum(meanIV)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">mean Rh:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtNum(meanRh)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">mean MuM:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtSci(meanUM)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}