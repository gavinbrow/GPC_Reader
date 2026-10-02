/**
 * ProcedureChain — right-pane visual pipeline of the 11 analysis procedures.
 *
 * Lists each procedure in chain order with an enable/disable toggle, a
 * "has been run" indicator, and an expandable parameter section. Parameter
 * edits are persisted via procedureStore.updateProcedure, sending the full
 * merged parameters object. Most procedures are automatic (no editable
 * parameters); despiking, alignment, molar_mass, distributions, and
 * band_broadening expose configurable fields. The molar_mass fit_model and
 * fit_degree here are defaults — per-peak overrides come from peak.ls_model.
 */
import { useEffect, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useProcedureStore } from '../../stores/procedureStore';
import {
  PROCEDURE_NAMES,
  PROCEDURE_LABELS,
  type ProcedureName,
  type ProcedureStateResponse,
} from '../../types/procedures';

const DESPIKING_LEVELS: { value: string; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy', label: 'Heavy' },
];

const ALIGNMENT_REFS: { value: string; label: string }[] = [
  { value: 'RI', label: 'RI' },
  { value: 'MALS', label: 'MALS' },
];

interface ParamRowProps {
  procedure: ProcedureStateResponse;
  onParamChange: (
    procedure: ProcedureStateResponse,
    params: Record<string, unknown>,
  ) => void;
}

function ParamSection({ procedure, onParamChange }: ParamRowProps) {
  const name = procedure.procedure_name as ProcedureName;
  const params = (procedure.parameters ?? {}) as Record<string, unknown>;

  if (name === 'despiking') {
    return (
      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">Level</span>
        <select
          value={(params.level as string) ?? 'off'}
          onChange={(e) =>
            onParamChange(procedure, { ...params, level: e.target.value })
          }
          className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
        >
          {DESPIKING_LEVELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (name === 'alignment') {
    return (
      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">
          Reference detector
        </span>
        <select
          value={(params.reference_detector as string) ?? 'RI'}
          onChange={(e) =>
            onParamChange(procedure, {
              ...params,
              reference_detector: e.target.value,
            })
          }
          className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
        >
          {ALIGNMENT_REFS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (name === 'molar_mass') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">Fit model</span>
            <select
              value={(params.fit_model as string) ?? 'zimm'}
              onChange={(e) =>
                onParamChange(procedure, {
                  ...params,
                  fit_model: e.target.value,
                })
              }
              className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
            >
              <option value="zimm">Zimm</option>
              <option value="debye">Debye</option>
              <option value="berry">Berry</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">
              Fit degree
            </span>
            <select
              value={String(params.fit_degree ?? 1)}
              onChange={(e) =>
                onParamChange(procedure, {
                  ...params,
                  fit_degree: Number(e.target.value),
                })
              }
              className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
            >
              <option value="1">1 (linear)</option>
              <option value="2">2 (quadratic)</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-400 italic">
          Per-peak fit model overrides this default (see Fit panel in Peaks tab)
        </p>
      </div>
    );
  }

  if (name === 'distributions') {
    const nBins = (params.n_bins as number) ?? 50;
    const logScale = (params.log_scale as boolean) ?? true;
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs text-slate-500 mb-0.5">
            Number of bins
          </span>
          <input
            type="number"
            min={5}
            max={200}
            value={nBins}
            onChange={(e) => {
              const n = Number(e.target.value);
              onParamChange(procedure, {
                ...params,
                n_bins: Number.isFinite(n) ? Math.max(5, Math.min(200, n)) : 50,
              });
            }}
            className="w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600 pt-4">
          <input
            type="checkbox"
            checked={logScale}
            onChange={(e) =>
              onParamChange(procedure, {
                ...params,
                log_scale: e.target.checked,
              })
            }
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
          />
          Log scale
        </label>
      </div>
    );
  }

  if (name === 'band_broadening') {
    const enabled = (params.enabled as boolean) ?? false;
    const vMixing = (params.V_mixing as number) ?? 0;
    const flowRate = (params.flow_rate as number) ?? 0;
    return (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onParamChange(procedure, {
                ...params,
                enabled: e.target.checked,
              })
            }
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
          />
          Enable band broadening correction
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">
              V_mixing (mL)
            </span>
            <input
              type="number"
              min={0}
              step="any"
              value={vMixing}
              onChange={(e) => {
                const n = Number(e.target.value);
                onParamChange(procedure, {
                  ...params,
                  V_mixing: Number.isFinite(n) ? n : 0,
                });
              }}
              className="w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">
              Flow rate (mL/min)
            </span>
            <input
              type="number"
              min={0}
              step="any"
              value={flowRate}
              onChange={(e) => {
                const n = Number(e.target.value);
                onParamChange(procedure, {
                  ...params,
                  flow_rate: Number.isFinite(n) ? n : 0,
                });
              }}
              className="w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs text-slate-400 italic">
      Automatic — no parameters
    </div>
  );
}

interface RowProps {
  procedure: ProcedureStateResponse;
  onParamChange: (
    procedure: ProcedureStateResponse,
    params: Record<string, unknown>,
  ) => void;
  onToggleEnabled: (procedure: ProcedureStateResponse) => void;
}

function ProcedureRow({
  procedure,
  onParamChange,
  onToggleEnabled,
}: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const name = procedure.procedure_name as ProcedureName;
  const label = PROCEDURE_LABELS[name] ?? name;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-2 px-4 py-2">
        <input
          type="checkbox"
          checked={procedure.is_enabled}
          onChange={() => onToggleEnabled(procedure)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
          title="Enable/disable procedure"
        />
        <span className="flex-1 text-xs font-medium text-slate-700">
          {label}
        </span>
        {procedure.has_been_run ? (
          <svg
            className="h-4 w-4 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <title>Has been run</title>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        ) : (
          <span
            className="h-3 w-3 rounded-full border border-slate-300 bg-slate-100"
            title="Not run yet"
          />
        )}
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-slate-400 hover:text-slate-600 p-0.5"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 4.5l7.5 7.5-7.5 7.5"
            />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-1 bg-slate-50/50">
          <ParamSection
            procedure={procedure}
            onParamChange={onParamChange}
          />
        </div>
      )}
    </div>
  );
}

export default function ProcedureChain() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const {
    procedures,
    loading,
    error,
    versionConflict,
    fetchProcedures,
    updateProcedure,
  } = useProcedureStore();

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchProcedures(currentExperimentId);
  }, [currentExperimentId, fetchProcedures]);

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <svg
          className="h-12 w-12 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c.251.023.501.05.75.082m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.07 1.07a3 3 0 01-2.121.879H5.8a3 3 0 01-2.121-.879L2.6 15.3M19.8 15.3l1.7 1.7M5 14.5L2.6 15.3m2.4-.8l1.7 1.7"
          />
        </svg>
        <p className="text-sm">Select an experiment to view procedures</p>
      </div>
    );
  }

  if (loading && procedures.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading procedures...
      </div>
    );
  }

  if (error && procedures.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      </div>
    );
  }

  const handleParamChange = (
    procedure: ProcedureStateResponse,
    params: Record<string, unknown>,
  ) => {
    if (currentExperimentId == null) return;
    updateProcedure(
      currentExperimentId,
      procedure.procedure_name as string,
      { parameters: params },
      procedure.version,
    );
  };

  const handleToggleEnabled = (procedure: ProcedureStateResponse) => {
    if (currentExperimentId == null) return;
    updateProcedure(
      currentExperimentId,
      procedure.procedure_name as string,
      { is_enabled: !procedure.is_enabled },
      procedure.version,
    );
  };

  const byName = new Map(
    procedures.map((p) => [p.procedure_name, p]),
  );
  const ordered: ProcedureStateResponse[] = [];
  for (const n of PROCEDURE_NAMES) {
    const p = byName.get(n);
    if (p) ordered.push(p);
  }

  if (ordered.length === 0) {
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
            d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
          />
        </svg>
        <p className="text-xs">No procedures</p>
        <p className="text-xs mt-1">Procedures will be created on first analysis run</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Procedure Chain {ordered.length > 0 && `(${ordered.length})`}
        </h3>
      </div>

      {error && procedures.length > 0 && (
        <div className="mx-4 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
      {versionConflict && (
        <div className="mx-4 mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Version conflict on {versionConflict.procedureName}: {versionConflict.message}. Procedures reloaded.
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {ordered.map((p) => (
          <ProcedureRow
            key={p.id}
            procedure={p}
            onParamChange={handleParamChange}
            onToggleEnabled={handleToggleEnabled}
          />
        ))}
      </div>
    </div>
  );
}