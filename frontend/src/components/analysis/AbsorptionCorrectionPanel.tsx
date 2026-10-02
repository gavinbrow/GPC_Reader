/**
 * AbsorptionCorrectionPanel — forward-monitor absorption correction panel.
 *
 * Allows the user to input forward monitor data, time axis, and peak range
 * to compute the absorption correction. Shows the correction factor and
 * whether absorption was detected. The corrected molar mass is displayed
 * in the results store.
 */
import { useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';
import { usePeakStore } from '../../stores/peakStore';

const inputClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '\u2014';
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '\u2014';
}

export default function AbsorptionCorrectionPanel() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const absorptionCorrection = useResultsStore((s) => s.absorptionCorrection);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchAbsorptionCorrection = useResultsStore((s) => s.fetchAbsorptionCorrection);
  const peaks = usePeakStore((s) => s.peaks);
  const selectedPeakId = usePeakStore((s) => s.selectedPeakId);

  const [peakStart, setPeakStart] = useState<string>('');
  const [peakEnd, setPeakEnd] = useState<string>('');
  const [baselinePct, setBaselinePct] = useState<string>('10');
  const [fmInput, setFmInput] = useState<string>('');

  const handleCorrect = () => {
    if (currentExperimentId == null) return;
    const selectedPeak = peaks.find((p) => p.id === selectedPeakId) ?? peaks[0];
    const start = peakStart ? parseFloat(peakStart) : selectedPeak?.range_start ?? 0;
    const end = peakEnd ? parseFloat(peakEnd) : selectedPeak?.range_end ?? 10;
    const fm = fmInput
      ? fmInput.split(',').map((s) => parseFloat(s.trim())).filter((v) => Number.isFinite(v))
      : Array(100).fill(1.0);
    const tAxis = Array.from({ length: fm.length }, (_, i) => (start + (end - start) * i / (fm.length - 1)));
    fetchAbsorptionCorrection(
      currentExperimentId,
      {
        forward_monitor: fm,
        time_axis: tAxis,
        peak_start: start,
        peak_end: end,
        baseline_pct: baselinePct ? parseFloat(baselinePct) : 10,
      },
      selectedPeakId ?? undefined,
    );
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to apply absorption correction.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Absorption Correction
      </h4>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-xs text-slate-500 mb-0.5">Peak Start (min)</span>
          <input
            type="number"
            value={peakStart}
            onChange={(e) => setPeakStart(e.target.value)}
            placeholder="auto"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-0.5">Peak End (min)</span>
          <input
            type="number"
            value={peakEnd}
            onChange={(e) => setPeakEnd(e.target.value)}
            placeholder="auto"
            className={inputClass}
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">Baseline %</span>
        <input
          type="number"
          value={baselinePct}
          onChange={(e) => setBaselinePct(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">
          Forward Monitor (comma-separated)
        </span>
        <textarea
          value={fmInput}
          onChange={(e) => setFmInput(e.target.value)}
          placeholder="Leave empty for no absorption (all 1.0)"
          rows={2}
          className={inputClass}
        />
      </label>

      <button
        onClick={handleCorrect}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {loading ? 'Correcting\u2026' : 'Apply Correction'}
      </button>

      {error && !absorptionCorrection && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {absorptionCorrection && (
        <div className="space-y-1 text-xs">
          <div>
            <span className="text-slate-400">Mean T:</span>{' '}
            <span className="font-mono text-slate-700">
              {fmtPct(absorptionCorrection.correction_factor_mean)}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Absorption:</span>{' '}
            <span
              className={`font-semibold ${
                absorptionCorrection.absorption_detected
                  ? 'text-amber-700'
                  : 'text-green-700'
              }`}
            >
              {absorptionCorrection.absorption_detected ? 'Detected' : 'Not detected'}
            </span>
          </div>
          {absorptionCorrection.message && (
            <div className="text-slate-500 italic">{absorptionCorrection.message}</div>
          )}
          {absorptionCorrection.corrected_molar_mass.length > 0 && (
            <div>
              <span className="text-slate-400">Corrected M slices:</span>{' '}
              <span className="font-mono text-slate-700">
                {absorptionCorrection.corrected_molar_mass.length}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}