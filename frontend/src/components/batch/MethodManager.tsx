/**
 * MethodManager — save/load/manage reusable analysis method templates.
 *
 * Lists existing method templates, allows creating new ones (capturing the
 * current experiment as a source), and applying a method to the current
 * experiment.
 */
import { useEffect, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useBatchStore } from '../../stores/batchStore';
import type { SettingToPropagate } from '../../types/batch';

const inputClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

const SETTING_OPTIONS: { value: SettingToPropagate; label: string }[] = [
  { value: 'baselines', label: 'Baselines' },
  { value: 'peaks', label: 'Peaks' },
  { value: 'peak_params', label: 'Peak Params' },
  { value: 'procedures', label: 'Procedures' },
];

export default function MethodManager() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const methods = useBatchStore((s) => s.methods);
  const methodsLoading = useBatchStore((s) => s.methodsLoading);
  const methodsError = useBatchStore((s) => s.methodsError);
  const batchError = useBatchStore((s) => s.batchError);
  const fetchMethods = useBatchStore((s) => s.fetchMethods);
  const createMethod = useBatchStore((s) => s.createMethod);
  const deleteMethod = useBatchStore((s) => s.deleteMethod);
  const applyMethod = useBatchStore((s) => s.applyMethod);

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [selectedSettings, setSelectedSettings] = useState<Set<SettingToPropagate>>(
    new Set(['peaks', 'procedures']),
  );

  useEffect(() => {
    fetchMethods();
  }, [fetchMethods]);

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

  const handleCreate = () => {
    if (!newName.trim() || currentExperimentId == null) return;
    const templateJson = JSON.stringify({
      source_experiment_id: currentExperimentId,
      settings_to_propagate: Array.from(selectedSettings),
    });
    createMethod({
      name: newName.trim(),
      description: newDesc.trim() || undefined,
      template: templateJson,
    });
    setNewName('');
    setNewDesc('');
  };

  const handleApply = (methodId: number) => {
    if (currentExperimentId == null) return;
    applyMethod(currentExperimentId, methodId);
  };

  const handleDelete = (methodId: number) => {
    deleteMethod(methodId);
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to manage methods.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-4 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Method Templates
      </h4>

      {(methodsError || batchError) && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {methodsError || batchError}
        </div>
      )}

      {/* Existing methods */}
      {methodsLoading && (
        <div className="text-xs text-slate-400">Loading methods\u2026</div>
      )}
      {methods.length === 0 && !methodsLoading && (
        <div className="text-xs text-slate-400 italic">No saved method templates.</div>
      )}
      {methods.map((m) => (
        <div key={m.id} className="border border-slate-200 rounded p-2 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-700 truncate">{m.name}</div>
              {m.description && (
                <div className="text-xs text-slate-400 truncate">{m.description}</div>
              )}
              {m.is_public && (
                <span className="text-xs text-brand-600 font-semibold">public</span>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => handleApply(m.id)}
                className="text-xs px-2 py-0.5 rounded bg-brand-600 text-white hover:bg-brand-700"
              >
                Apply
              </button>
              <button
                onClick={() => handleDelete(m.id)}
                className="text-xs px-2 py-0.5 rounded text-red-500 hover:text-red-700 border border-red-200"
              >
                Del
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Create new method */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Save Current as Method
        </h5>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Method name..."
          className={inputClass}
        />
        <input
          type="text"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Description (optional)..."
          className={inputClass}
        />
        <div className="flex flex-wrap gap-2">
          {SETTING_OPTIONS.map((s) => (
            <label
              key={s.value}
              className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedSettings.has(s.value)}
                onChange={() => handleToggleSetting(s.value)}
              />
              {s.label}
            </label>
          ))}
        </div>
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="w-full text-xs px-3 py-2 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save Method Template
        </button>
      </div>
    </div>
  );
}