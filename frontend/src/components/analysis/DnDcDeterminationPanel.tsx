/**
 * DnDcDeterminationPanel — dn/dc determination from known concentration or
 * RI calibration constant.
 *
 * Two modes:
 *  - "concentration" (online): dn/dc = ri_area * flow_rate / injected_mass
 *  - "calibration" (third-party RI): dn/dc = ri_calibration_constant / (ri_peak_area * flow_rate)
 *
 * Calls fetchDnDc with the selected method and input parameters.
 * Shows the result and a warning if dn/dc is outside the typical 0.05-0.30 mL/g range.
 */
import { useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';

const selectClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';
const inputClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

function fmtSci(v: number | null | undefined, digits = 4): string {
  if (v == null) return '\u2014';
  return Number.isFinite(v) ? v.toExponential(digits) : '\u2014';
}

const METHODS: { value: 'concentration' | 'calibration'; label: string }[] = [
  { value: 'concentration', label: 'Online (100% mass recovery)' },
  { value: 'calibration', label: 'RI Calibration Constant' },
];

export default function DnDcDeterminationPanel() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const dnDc = useResultsStore((s) => s.dnDc);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchDnDc = useResultsStore((s) => s.fetchDnDc);

  const [method, setMethod] = useState<'concentration' | 'calibration'>('concentration');
  const [riArea, setRiArea] = useState<string>('');
  const [flowRate, setFlowRate] = useState<string>('');
  const [injectedMass, setInjectedMass] = useState<string>('');
  const [riCalibConst, setRiCalibConst] = useState<string>('');

  const handleDetermine = () => {
    if (currentExperimentId == null) return;
    const params: Record<string, unknown> = { method };
    if (riArea) params.ri_area = parseFloat(riArea);
    if (flowRate) params.flow_rate = parseFloat(flowRate);
    if (method === 'concentration' && injectedMass) {
      params.injected_mass = parseFloat(injectedMass);
    }
    if (method === 'calibration' && riCalibConst) {
      params.ri_calibration_constant = parseFloat(riCalibConst);
    }
    fetchDnDc(currentExperimentId, params as any);
  };

  const dnDcValue = dnDc?.dn_dc_value ?? null;
  const showWarning =
    dnDcValue != null &&
    Number.isFinite(dnDcValue) &&
    (dnDcValue < 0.05 || dnDcValue > 0.3);

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to determine dn/dc.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        dn/dc Determination
      </h4>

      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">Method</span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as 'concentration' | 'calibration')}
          className={selectClass}
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-xs text-slate-500 mb-0.5">RI Peak Area</span>
          <input
            type="number"
            value={riArea}
            onChange={(e) => setRiArea(e.target.value)}
            placeholder="e.g. 1.5e6"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-0.5">Flow Rate (mL/min)</span>
          <input
            type="number"
            value={flowRate}
            onChange={(e) => setFlowRate(e.target.value)}
            placeholder="e.g. 1.0"
            className={inputClass}
          />
        </label>
        {method === 'concentration' ? (
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">Injected Mass (g)</span>
            <input
              type="number"
              value={injectedMass}
              onChange={(e) => setInjectedMass(e.target.value)}
              placeholder="e.g. 5e-4"
              className={inputClass}
            />
          </label>
        ) : (
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">RI Calibration Const.</span>
            <input
              type="number"
              value={riCalibConst}
              onChange={(e) => setRiCalibConst(e.target.value)}
              placeholder="e.g. 3.0e-6"
              className={inputClass}
            />
          </label>
        )}
      </div>

      <button
        onClick={handleDetermine}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {loading ? 'Determining\u2026' : 'Determine dn/dc'}
      </button>

      {error && !dnDc && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {dnDc && (
        <div className="space-y-1 text-xs">
          <div>
            <span className="text-slate-400">dn/dc:</span>{' '}
            <span className="font-mono text-slate-700">
              {fmtSci(dnDc.dn_dc_value)} mL/g
            </span>
          </div>
          <div>
            <span className="text-slate-400">Method:</span>{' '}
            <span className="font-mono text-slate-700">{dnDc.method ?? '\u2014'}</span>
          </div>
          {dnDc.message && (
            <div className="text-slate-500 italic">{dnDc.message}</div>
          )}
          {showWarning && (
            <div className="p-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-xs">
              {'\u26a0'} dn/dc is outside the typical range (0.05{'\u2013'}0.30 mL/g). Verify your inputs.
            </div>
          )}
        </div>
      )}
    </div>
  );
}