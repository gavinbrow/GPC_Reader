/**
 * BatchProcessor — one-to-many settings propagation UI.
 *
 * Select a source experiment, select target experiments, choose which settings
 * to propagate (baselines, peaks, peak_params, procedures), and start a batch
 * job. Shows progress bar, per-target results, and error messages.
 */
import { useEffect, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useBatchStore } from '../../stores/batchStore';
import type { SettingToPropagate } from '../../types/batch';

const inputClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

const SETTINGS: { value: SettingToPropagate; label: string; desc: string }[] = [
  { value: 'baselines', label: 'Baselines', desc: 'Per-detector baseline settings' },
  { value: 'peaks', label: 'Peaks', desc: 'Peak ranges (start/end, name)' },
  { value: 'peak_params', label: 'Peak Params', desc: 'dn/dc, ls_model, fit_degree' },
  { value: 'procedures', label: 'Procedures', desc: 'Enabled flags + parameters' },
];

export default function BatchProcessor() {
  const experiments = useExperimentStore((s) => s.experiments);
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const batchJob = useBatchStore((s) => s.batchJob);
  const batchRunning = useBatchStore((s) => s.batchRunning);
  const batchError = useBatchStore((s) => s.batchError);
  const startBatch = useBatchStore((s) => s.startBatch);
  const fetchExperiments = useExperimentStore((s) => s.fetchExperiments);

  const [sourceId, setSourceId] = useState<number | null>(currentExperimentId);
  const [selectedTargets, setSelectedTargets] = useState<Set<number>>(new Set());
  const [selectedSettings, setSelectedSettings] = useState<Set<SettingToPropagate>>(
    new Set(['peaks', 'procedures']),
  );

  useEffect(() => {
    fetchExperiments(1);
  }, [fetchExperiments]);

  useEffect(() => {
    if (currentExperimentId != null && sourceId == null) {
      setSourceId(currentExperimentId);
    }
  }, [currentExperimentId, sourceId]);

  const handleToggleTarget = (id: number) => {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSetting = (s: SettingToPropagate) => {
    setSelectedSettings((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  };

  const handleStartBatch = () => {
    if (sourceId == null || selectedTargets.size === 0 || selectedSettings.size === 0) return;
    startBatch(sourceId, Array.from(selectedTargets), Array.from(selectedSettings));
  };

  const availableTargets = experiments.filter(
    (e) => e.id !== sourceId,
  );

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-4 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Batch Processor
      </h4>

      {/* Source experiment */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">
          Source Experiment
        </label>
        <select
          value={sourceId ?? ''}
          onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : null)}
          className={inputClass}
        >
          <option value="">Select source\u2026</option>
          {experiments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.sample_name || 'Unnamed'} — {e.file_name}
            </option>
          ))}
        </select>
      </div>

      {/* Settings to propagate */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">
          Settings to Propagate
        </label>
        <div className="space-y-1">
          {SETTINGS.map((s) => (
            <label
              key={s.value}
              className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedSettings.has(s.value)}
                onChange={() => handleToggleSetting(s.value)}
                className="mt-0.5"
              />
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="text-slate-400">{s.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Target experiments */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">
          Target Experiments ({selectedTargets.size} selected)
        </label>
        {availableTargets.length === 0 ? (
          <div className="text-xs text-slate-400 italic">
            No other experiments available. Upload more files first.
          </div>
        ) : (
          <div className="max-h-40 overflow-y-auto border border-slate-200 rounded p-1 space-y-0.5">
            {availableTargets.map((e) => (
              <label
                key={e.id}
                className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer px-1 py-0.5 rounded hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedTargets.has(e.id)}
                  onChange={() => handleToggleTarget(e.id)}
                />
                <span className="truncate">{e.sample_name || 'Unnamed'} — {e.file_name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Start button */}
      <button
        onClick={handleStartBatch}
        disabled={batchRunning || sourceId == null || selectedTargets.size === 0 || selectedSettings.size === 0}
        className="w-full text-xs px-3 py-2 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {batchRunning ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M5 12h14" />
            </svg>
            Processing\u2026
          </span>
        ) : (
          `Apply to ${selectedTargets.size} target(s)`
        )}
      </button>

      {/* Progress */}
      {batchRunning && batchJob && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{batchJob.message || 'Working\u2026'}</span>
            <span className="font-mono">{batchJob.progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, batchJob.progress))}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {batchError && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {batchError}
        </div>
      )}

      {/* Results */}
      {batchJob && batchJob.status === 'completed' && batchJob.target_results && (
        <div className="space-y-1">
          <h5 className="text-xs font-semibold text-slate-500 uppercase">Results</h5>
          {batchJob.target_results.map((r) => (
            <div
              key={r.experiment_id}
              className={`text-xs border rounded px-2 py-1 ${
                r.status === 'completed'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              <div className="font-medium">
                Experiment {r.experiment_id}: {r.status}
              </div>
              {r.summary && (
                <div className="text-slate-500 mt-0.5">
                  {Object.entries(r.summary).map(([k, v]) => `${k}: ${v}`).join(', ')}
                </div>
              )}
              {r.error && (
                <div className="text-red-600 mt-0.5">{r.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}