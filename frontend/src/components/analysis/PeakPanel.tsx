/**
 * PeakPanel — right-pane peak list + per-peak parameter editor.
 *
 * Shows a table of all peaks (range #, name, start/end, dn/dc, Mn, Mw) and,
 * when a peak is selected, an editable form with fields dn_dc,
 * uv_extinction, concentration, injected_mass, ls_model (Zimm/Debye/Berry),
 * ls_fit_degree (1/2), radius_type. Save calls peakStore.updatePeak;
 * Delete calls peakStore.deletePeak. dn/dc warnings from the PeakResponse
 * `warnings` field are surfaced as amber banners.
 */
import { useEffect, useMemo, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { usePeakStore } from '../../stores/peakStore';
import type { PeakResponse, PeakUpdate } from '../../types/peak';

const LS_MODELS: { value: number; label: string }[] = [
  { value: 0, label: 'Zimm' },
  { value: 1, label: 'Debye' },
  { value: 2, label: 'Berry' },
];

const LS_FIT_DEGREES: { value: number; label: string }[] = [
  { value: 1, label: '1 (linear)' },
  { value: 2, label: '2 (second-order)' },
];

const RADIUS_TYPES: { value: number; label: string }[] = [
  { value: 0, label: 'RMS' },
  { value: 1, label: 'Rg' },
  { value: 2, label: 'Hydrodynamic' },
];

function fmtNum(v: number | null | undefined, digits = 4): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function fmtSci(v: number | null | undefined, digits = 2): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toExponential(digits) : '—';
}

interface FieldProps {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
}

function NumberField({ label, value, onChange, step }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-0.5">{label}</span>
      <input
        type="number"
        step={step ?? 'any'}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') onChange(null);
          else {
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }
        }}
        className="w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
      />
    </label>
  );
}

export default function PeakPanel() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const {
    peaks,
    loading,
    error,
    selectedPeakId,
    versionConflict,
    fetchPeaks,
    updatePeak,
    deletePeak,
    setSelectedPeakId,
  } = usePeakStore();

  const [form, setForm] = useState<PeakUpdate>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedPeak = useMemo(
    () => peaks.find((p) => p.id === selectedPeakId) ?? null,
    [peaks, selectedPeakId],
  );

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchPeaks(currentExperimentId);
  }, [currentExperimentId, fetchPeaks]);

  useEffect(() => {
    if (!selectedPeak) {
      setForm({});
      return;
    }
    setForm({
      dn_dc: selectedPeak.dn_dc ?? null,
      uv_extinction: selectedPeak.uv_extinction ?? null,
      concentration: selectedPeak.concentration ?? null,
      injected_mass: selectedPeak.injected_mass ?? null,
      ls_model: selectedPeak.ls_model ?? null,
      ls_fit_degree: selectedPeak.ls_fit_degree ?? null,
      radius_type: selectedPeak.radius_type ?? null,
    });
  }, [selectedPeak]);

  const handleSave = async () => {
    if (currentExperimentId == null || !selectedPeak) return;
    setSaving(true);
    const body: PeakUpdate = {};
    (Object.keys(form) as (keyof PeakUpdate)[]).forEach((k) => {
      const cur = form[k] as number | null;
      const orig = selectedPeak[k as keyof PeakResponse] as number | null;
      if (cur !== orig && (cur !== null || orig != null)) {
        (body as Record<string, unknown>)[k as string] = cur;
      }
    });
    if (Object.keys(body).length === 0) {
      setSaving(false);
      return;
    }
    await updatePeak(currentExperimentId, selectedPeak.id, body, selectedPeak.version);
    setSaving(false);
  };

  const handleDelete = async () => {
    if (currentExperimentId == null || !selectedPeak) return;
    setDeleting(true);
    await deletePeak(currentExperimentId, selectedPeak.id, selectedPeak.version);
    setDeleting(false);
  };

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <svg className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 13.125 4.5 13.125 7.5 9.375C10.5 5.625 13.5 18.375 16.5 14.625C18 12.75 19.5 12.375 21 12.375" />
        </svg>
        <p className="text-sm">Select an experiment to view peaks</p>
      </div>
    );
  }

  if (loading && peaks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading peaks...
      </div>
    );
  }

  if (error && peaks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Peaks {peaks.length > 0 && `(${peaks.length})`}
        </h3>
      </div>

      {error && peaks.length > 0 && (
        <div className="mx-4 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
      {versionConflict && (
        <div className="mx-4 mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Version conflict on peak {versionConflict.peakId}: {versionConflict.message}. Peaks reloaded.
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {peaks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 py-10">
            <svg className="h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6 0V5a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 5v12.25m18 0H3m18 0a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 17.25" />
            </svg>
            <p className="text-xs">No peaks yet</p>
            <p className="text-xs mt-1">Use the Peak toolbar to draw or auto-detect peaks</p>
          </div>
        ) : (
          <>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-1.5 text-left font-medium">#</th>
                  <th className="px-4 py-1.5 text-left font-medium">Name</th>
                  <th className="px-4 py-1.5 text-right font-medium">Start</th>
                  <th className="px-4 py-1.5 text-right font-medium">End</th>
                  <th className="px-4 py-1.5 text-right font-medium">dn/dc</th>
                  <th className="px-4 py-1.5 text-right font-medium">Mw</th>
                </tr>
              </thead>
              <tbody>
                {peaks.map((peak) => (
                  <tr
                    key={peak.id}
                    onClick={() => setSelectedPeakId(peak.id)}
                    className={`cursor-pointer border-b border-slate-100 last:border-b-0 ${
                      peak.id === selectedPeakId
                        ? 'bg-brand-50 border-l-4 border-brand-600'
                        : 'hover:bg-slate-50 border-l-4 border-transparent'
                    }`}
                  >
                    <td className="px-4 py-1.5 text-slate-500 font-mono">{peak.range_number ?? '—'}</td>
                    <td className="px-4 py-1.5 text-slate-700">{peak.range_name || '—'}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">{fmtNum(peak.range_start, 2)}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">{fmtNum(peak.range_end, 2)}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">{fmtNum(peak.dn_dc, 4)}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">{fmtSci(peak.mw, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selectedPeak && (
              <div className="border-t-2 border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-700">
                    Peak #{selectedPeak.range_number ?? selectedPeak.id}
                    {selectedPeak.range_name ? ` · ${selectedPeak.range_name}` : ''}
                  </h4>
                  <span className="text-xs text-slate-400 font-mono">
                    v{selectedPeak.version}
                    {selectedPeak.is_auto && ' · auto'}
                  </span>
                </div>

                {selectedPeak.warnings.length > 0 && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 space-y-0.5">
                    {selectedPeak.warnings.map((w, i) => (
                      <div key={i}>{w}</div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="dn/dc (mL/g)"
                    value={form.dn_dc ?? null}
                    onChange={(v) => setForm((f) => ({ ...f, dn_dc: v }))}
                    step={0.001}
                  />
                  <NumberField
                    label="UV extinction (mL/g·cm)"
                    value={form.uv_extinction ?? null}
                    onChange={(v) => setForm((f) => ({ ...f, uv_extinction: v }))}
                    step={0.1}
                  />
                  <NumberField
                    label="Concentration (mg/mL)"
                    value={form.concentration ?? null}
                    onChange={(v) => setForm((f) => ({ ...f, concentration: v }))}
                    step={0.01}
                  />
                  <NumberField
                    label="Injected mass (mg)"
                    value={form.injected_mass ?? null}
                    onChange={(v) => setForm((f) => ({ ...f, injected_mass: v }))}
                    step={0.001}
                  />

                  <label className="block">
                    <span className="block text-xs text-slate-500 mb-0.5">LS model</span>
                    <select
                      value={form.ls_model ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          ls_model: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
                    >
                      <option value="">—</option>
                      {LS_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="block text-xs text-slate-500 mb-0.5">LS fit degree</span>
                    <select
                      value={form.ls_fit_degree ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          ls_fit_degree: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
                    >
                      <option value="">—</option>
                      {LS_FIT_DEGREES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block col-span-2">
                    <span className="block text-xs text-slate-500 mb-0.5">Radius type</span>
                    <select
                      value={form.radius_type ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          radius_type: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
                    >
                      <option value="">—</option>
                      {RADIUS_TYPES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {selectedPeak.mn != null || selectedPeak.mw != null ? (
                  <div className="grid grid-cols-4 gap-2 pt-1 text-xs">
                    <div>
                      <div className="text-slate-400">Mn</div>
                      <div className="font-mono text-slate-700">{fmtSci(selectedPeak.mn)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Mw</div>
                      <div className="font-mono text-slate-700">{fmtSci(selectedPeak.mw)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Mz</div>
                      <div className="font-mono text-slate-700">{fmtSci(selectedPeak.mz)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Pd</div>
                      <div className="font-mono text-slate-700">{fmtNum(selectedPeak.polydispersity, 2)}</div>
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-xs px-3 py-1.5 rounded border border-red-300 bg-white text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Delete Peak'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}