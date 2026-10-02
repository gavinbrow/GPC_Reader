/**
 * CalibrationPanel — column calibration curve fit panel.
 *
 * Provides a degree selector (1-6, default 3) and a "Fit Calibration" button
 * that calls fetchCalibration(experimentId, undefined, degree). Shows R²,
 * calibration type, and coefficients. The calibration curve itself is shown
 * in the center area via CalibrationCurve.tsx (a separate center tab).
 */
import { useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';

const selectClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

function fmtNum(v: number | null | undefined, digits = 4): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

const DEGREES: { value: number; label: string }[] = [
  { value: 1, label: '1 (linear)' },
  { value: 2, label: '2 (quadratic)' },
  { value: 3, label: '3 (cubic)' },
  { value: 4, label: '4 (quartic)' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
];

export default function CalibrationPanel() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const calibration = useResultsStore((s) => s.calibration);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchCalibration = useResultsStore((s) => s.fetchCalibration);

  const [degree, setDegree] = useState<number>(3);

  const handleFit = () => {
    if (currentExperimentId == null) return;
    fetchCalibration(currentExperimentId, undefined, degree);
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to fit calibration.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Column Calibration
      </h4>

      <div className="flex items-end gap-3">
        <label className="block w-40">
          <span className="block text-xs text-slate-500 mb-0.5">Degree</span>
          <select
            value={degree}
            onChange={(e) => setDegree(Number(e.target.value))}
            className={selectClass}
          >
            {DEGREES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={handleFit}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Fitting…' : 'Fit Calibration'}
        </button>
      </div>

      {error && !calibration && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {calibration && (
        <div className="space-y-1 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-slate-400">R²:</span>{' '}
              <span className="font-mono text-slate-700">
                {fmtNum(calibration.r_squared, 6)}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Type:</span>{' '}
              <span className="font-mono text-slate-700">
                {calibration.calibration_type ?? '—'}
              </span>
            </div>
          </div>
          {calibration.coefficients.length > 0 && (
            <div>
              <span className="text-slate-400">Coefficients:</span>
              <div className="font-mono text-slate-700 text-xs mt-0.5">
                {calibration.coefficients.map((c, i) => (
                  <div key={i}>
                    c{i}: {fmtNum(c, 6)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}