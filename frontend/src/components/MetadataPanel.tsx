import { useState } from 'react';
import { useExperimentStore } from '../stores/experimentStore';
import type { SampleUpdate } from '../api/endpoints';
import type { ExperimentDetail, FluidConnection } from '../types/experiment';

function MetaSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50 px-4 py-2">
        {title}
      </h3>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-start py-1 gap-4">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span
        className={`text-xs text-slate-800 text-right break-words ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

/** An editable numeric metadata row: click to edit, commit on blur/Enter. */
function EditableMetaRow({
  label,
  value,
  unit,
  onSave,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  onSave: (v: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(value != null ? String(value) : '');
    setErr(null);
    setEditing(true);
  };

  const commit = async () => {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(parsed)) {
      setEditing(false);
      return;
    }
    if (parsed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave(parsed);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex justify-between items-center py-1 gap-4">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      {editing ? (
        <span className="flex items-center gap-1">
          <input
            type="number"
            step="any"
            autoFocus
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') setEditing(false);
            }}
            className="w-24 text-xs font-mono text-right px-1.5 py-0.5 border border-brand-400 rounded focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
          {unit && <span className="text-xs text-slate-400">{unit}</span>}
        </span>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          title="Click to edit"
          className="text-xs font-mono text-slate-800 text-right hover:bg-slate-100 rounded px-1 -mr-1 cursor-text"
        >
          {value != null ? value : '—'}
          {value != null && unit ? ` ${unit}` : ''}
        </button>
      )}
      {err && <span className="sr-only">{err}</span>}
    </div>
  );
}

export default function MetadataPanel() {
  const { experimentDetail, detailLoading, detailError, updateSampleConfig } = useExperimentStore();

  if (detailLoading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading metadata...
      </div>
    );
  }

  if (detailError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {detailError}
        </div>
      </div>
    );
  }

  if (!experimentDetail) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <svg className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <p className="text-sm">No experiment selected</p>
      </div>
    );
  }

  const saveSample = (fields: SampleUpdate) => updateSampleConfig(fields);

  const exp: ExperimentDetail = experimentDetail;
  const mals = exp.mals_config;
  const ri = exp.ri_config;
  const uv = exp.uv_config;
  const sample = exp.sample_config;
  const fluidPath = exp.fluid_path;
  const peaks = exp.peaks ?? [];

  const formatSize = (bytes: number | null) => {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDateTime = (dt: string | null) => {
    if (!dt) return '—';
    try {
      const d = new Date(dt);
      return d.toLocaleString();
    } catch {
      return dt;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-white">
      {/* File Info */}
      <MetaSection title="File Info">
        <MetaRow label="Original filename" value={exp.file_name} />
        <MetaRow label="File size" value={formatSize(exp.file_size)} mono />
        <MetaRow label="Collection time" value={formatDateTime(exp.collection_time)} />
        <MetaRow label="Processing time" value={formatDateTime(exp.processing_time)} />
        <MetaRow label="Operator" value={exp.operator_name?.trim() || '—'} />
        <MetaRow label="ASTRA version" value={exp.astra_version} mono />
      </MetaSection>

      {/* Sample */}
      {sample && (
        <MetaSection title="Sample">
          <MetaRow label="Name" value={sample.name} />
          <MetaRow label="Description" value={sample.description?.trim() || '—'} />
          <EditableMetaRow
            label="dn/dc"
            value={sample.dn_dc}
            unit="mL/g"
            onSave={(v) => saveSample({ dn_dc: v })}
          />
          <EditableMetaRow
            label="Concentration"
            value={sample.concentration}
            unit="mg/mL"
            onSave={(v) => saveSample({ concentration: v })}
          />
          <EditableMetaRow
            label="A2"
            value={sample.a2}
            unit="mol·mL/g²"
            onSave={(v) => saveSample({ a2: v })}
          />
          <EditableMetaRow
            label="Real RI"
            value={sample.real_ri}
            onSave={(v) => saveSample({ real_ri: v })}
          />
        </MetaSection>
      )}

      {/* Solvent */}
      <MetaSection title="Solvent">
        <MetaRow label="Name" value={exp.solvent_name} />
        <MetaRow label="Description" value={exp.solvent_description?.trim() || '—'} />
      </MetaSection>

      {/* Instruments */}
      <MetaSection title="Instruments">
        {mals && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-slate-600 mb-1">MALS</div>
            <MetaRow label="Name" value={mals.name} />
            <MetaRow label="Wavelength" value={mals.wavelength != null ? `${mals.wavelength} nm` : '—'} mono />
            <MetaRow label="Detectors" value={mals.num_detectors} mono />
            <MetaRow label="Angles" value={mals.detector_angles?.map((a) => `${a}°`).join(', ')} mono />
          </div>
        )}
        {ri && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-slate-600 mb-1">RI</div>
            <MetaRow label="Name" value={ri.name} />
            <MetaRow label="Wavelength" value={ri.wavelength != null ? `${ri.wavelength} nm` : '—'} mono />
          </div>
        )}
        {uv && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">UV</div>
            <MetaRow label="Name" value={uv.name} />
            <MetaRow label="Wavelengths" value={uv.wavelengths?.length > 0 ? uv.wavelengths.map((w) => `${w}nm`).join(', ') : '—'} mono />
          </div>
        )}
        {!mals && !ri && !uv && (
          <div className="text-xs text-slate-400">No instrument data available</div>
        )}
      </MetaSection>

      {/* Fluid Path */}
      {fluidPath && fluidPath.length > 0 && (
        <MetaSection title="Fluid Path">
          <div className="space-y-1">
            {fluidPath.map((conn: FluidConnection, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs text-slate-700">
                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{conn.source_instrument}</span>
                <svg className="h-3 w-3 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
                </svg>
                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{conn.destination_instrument}</span>
              </div>
            ))}
          </div>
        </MetaSection>
      )}

      {/* Peaks */}
      {peaks.length > 0 && (
        <MetaSection title="Peaks">
          <div className="overflow-x-auto -mx-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-1.5 text-left font-medium">#</th>
                  <th className="px-4 py-1.5 text-left font-medium">Name</th>
                  <th className="px-4 py-1.5 text-right font-medium">Start</th>
                  <th className="px-4 py-1.5 text-right font-medium">End</th>
                  <th className="px-4 py-1.5 text-right font-medium">dn/dc</th>
                  <th className="px-4 py-1.5 text-right font-medium">Mn</th>
                  <th className="px-4 py-1.5 text-right font-medium">Mw</th>
                </tr>
              </thead>
              <tbody>
                {peaks.map((peak, i: number) => (
                  <tr key={i} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-1.5 text-slate-500 font-mono">{peak.range_number}</td>
                    <td className="px-4 py-1.5 text-slate-700">{peak.range_name || '—'}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">{peak.range_start?.toFixed(2)}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">{peak.range_end?.toFixed(2)}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">{peak.dn_dc?.toFixed(4) ?? '—'}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">
                      {peak.mn != null ? peak.mn.toExponential(2) : '—'}
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-slate-600">
                      {peak.mw != null ? peak.mw.toExponential(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MetaSection>
      )}
    </div>
  );
}