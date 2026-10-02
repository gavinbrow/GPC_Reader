/**
 * FitPanel — per-peak light-scattering fit model selector + fit diagnostics.
 *
 * Lets the user pick a peak, then choose the LS fit model (Zimm/Debye/Berry)
 * and fit degree (1/2). These map to peak.ls_model and peak.ls_fit_degree and
 * are saved via peakStore.updatePeak → PUT /peaks/{peakId}. After a change,
 * a "Re-run analysis to apply" hint is shown. If resultsStore.angularFit has
 * data for the selected peak, a chi² summary (mean χ², n angles used) and
 * the fit_model/fit_degree that were actually used in the last run are shown.
 * Intended to render below PeakPanel in the Peaks right-tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { usePeakStore } from '../../stores/peakStore';
import { useResultsStore } from '../../stores/resultsStore';

const LS_MODELS: { value: number; label: string }[] = [
  { value: 0, label: 'Zimm' },
  { value: 1, label: 'Debye' },
  { value: 2, label: 'Berry' },
];

const LS_DEGREES: { value: number; label: string }[] = [
  { value: 1, label: '1 (linear)' },
  { value: 2, label: '2 (quadratic)' },
];

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

export default function FitPanel() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const peaks = usePeakStore((s) => s.peaks);
  const selectedPeakId = usePeakStore((s) => s.selectedPeakId);
  const setSelectedPeakId = usePeakStore((s) => s.setSelectedPeakId);
  const updatePeak = usePeakStore((s) => s.updatePeak);
  const angularFit = useResultsStore((s) => s.angularFit);
  const fetchAngularFit = useResultsStore((s) => s.fetchAngularFit);

  const [model, setModel] = useState<number>(0);
  const [degree, setDegree] = useState<number>(1);
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const selectedPeak = useMemo(
    () => peaks.find((p) => p.id === selectedPeakId) ?? null,
    [peaks, selectedPeakId],
  );

  useEffect(() => {
    if (!selectedPeak) {
      setModel(0);
      setDegree(1);
      setDirty(false);
      return;
    }
    setModel(selectedPeak.ls_model ?? 0);
    setDegree(selectedPeak.ls_fit_degree ?? 1);
    setDirty(false);
  }, [selectedPeak]);

  useEffect(() => {
    if (currentExperimentId == null) return;
    if (selectedPeakId == null) return;
    fetchAngularFit(currentExperimentId, selectedPeakId);
  }, [currentExperimentId, selectedPeakId, fetchAngularFit]);

  const fitSlice = useMemo(() => {
    if (!angularFit || selectedPeakId == null) return null;
    return angularFit.peaks.find((p) => p.peak_id === selectedPeakId) ?? null;
  }, [angularFit, selectedPeakId]);

  const meanChi2 = fitSlice ? mean(fitSlice.chi2) : null;
  const meanAngles = fitSlice ? mean(fitSlice.n_angles_used) : null;

  if (currentExperimentId == null) {
    return null;
  }

  if (peaks.length === 0) {
    return (
      <div className="border-t border-slate-200 p-4 text-xs text-slate-400 italic">
        No peaks — create or detect peaks to configure fit model.
      </div>
    );
  }

  const handleModelChange = (m: number) => {
    setModel(m);
    setDirty(true);
  };

  const handleDegreeChange = (d: number) => {
    setDegree(d);
    setDirty(true);
  };

  const handleSave = async () => {
    if (currentExperimentId == null || !selectedPeak) return;
    setSaving(true);
    await updatePeak(currentExperimentId, selectedPeak.id, {
      ls_model: model,
      ls_fit_degree: degree,
    });
    setSaving(false);
    setDirty(false);
  };

  const selectClass =
    'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Fit Model
        </h4>
        {dirty && (
          <span className="text-xs text-amber-600">Re-run analysis to apply</span>
        )}
      </div>

      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">Peak</span>
        <select
          value={selectedPeakId ?? ''}
          onChange={(e) => setSelectedPeakId(e.target.value === '' ? null : Number(e.target.value))}
          className={selectClass}
        >
          {peaks.map((p) => {
            const num = p.range_number ?? p.id;
            const lbl = p.range_name ? `Peak ${num} · ${p.range_name}` : `Peak ${num}`;
            return (
              <option key={p.id} value={p.id}>
                {lbl}
              </option>
            );
          })}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs text-slate-500 mb-0.5">Fit model</span>
          <select
            value={model}
            onChange={(e) => handleModelChange(Number(e.target.value))}
            className={selectClass}
          >
            {LS_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs text-slate-500 mb-0.5">Fit degree</span>
          <select
            value={degree}
            onChange={(e) => handleDegreeChange(Number(e.target.value))}
            className={selectClass}
          >
            {LS_DEGREES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        onClick={handleSave}
        disabled={!dirty || saving}
        className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>

      {fitSlice && (
        <div className="pt-2 border-t border-slate-100 space-y-1">
          <div className="text-xs text-slate-400 uppercase tracking-wide">
            Last run
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400">Model used:</span>{' '}
              <span className="font-mono text-slate-700">
                {fitSlice.fit_model ?? '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Degree:</span>{' '}
              <span className="font-mono text-slate-700">
                {fitSlice.fit_degree ?? '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Mean χ²:</span>{' '}
              <span className="font-mono text-slate-700">{fmtNum(meanChi2)}</span>
            </div>
            <div>
              <span className="text-slate-400">Mean angles:</span>{' '}
              <span className="font-mono text-slate-700">{fmtNum(meanAngles, 1)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}