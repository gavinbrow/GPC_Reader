/**
 * EASITable — multi-run comparison table with CSV/clipboard export.
 *
 * Select experiments to compare, create an EASI table, and view the results
 * in a sortable table. Supports CSV export via the backend.
 */
import { useEffect, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useBatchStore } from '../../stores/batchStore';
import type { EasiTableRow } from '../../types/batch';

function fmtNum(v: unknown): string {
  if (v == null) return '\u2014';
  if (typeof v !== 'number') return String(v);
  if (!isFinite(v)) return '\u2014';
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0)) {
    return v.toExponential(2);
  }
  return v.toFixed(2);
}

const TABLE_COLUMNS: { key: string; label: string }[] = [
  { key: 'sample_name', label: 'Sample' },
  { key: 'peak_number', label: 'Peak' },
  { key: 'Mn', label: 'Mn (g/mol)' },
  { key: 'Mw', label: 'Mw (g/mol)' },
  { key: 'Mz', label: 'Mz (g/mol)' },
  { key: 'Pd', label: 'Pd' },
  { key: 'Rg_nm', label: 'Rg (nm)' },
  { key: 'peak_area', label: 'Area' },
];

export default function EASITable() {
  const experiments = useExperimentStore((s) => s.experiments);
  const currentEasiTable = useBatchStore((s) => s.currentEasiTable);
  const easiTables = useBatchStore((s) => s.easiTables);
  const easiLoading = useBatchStore((s) => s.easiLoading);
  const easiError = useBatchStore((s) => s.easiError);
  const fetchExperiments = useExperimentStore((s) => s.fetchExperiments);
  const createEasiTable = useBatchStore((s) => s.createEasiTable);
  const fetchEasiTables = useBatchStore((s) => s.fetchEasiTables);
  const exportEasiTable = useBatchStore((s) => s.exportEasiTable);
  const deleteEasiTable = useBatchStore((s) => s.deleteEasiTable);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [tableName, setTableName] = useState('');

  useEffect(() => {
    fetchExperiments(1);
    fetchEasiTables();
  }, [fetchExperiments, fetchEasiTables]);

  const handleToggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreate = () => {
    if (!tableName.trim() || selectedIds.size < 2) return;
    createEasiTable({
      name: tableName.trim(),
      experiment_ids: Array.from(selectedIds),
    });
    setTableName('');
  };

  const handleExport = (easiId: number) => {
    exportEasiTable(easiId);
  };

  const handleDelete = (easiId: number) => {
    deleteEasiTable(easiId);
  };

  const rows: EasiTableRow[] = currentEasiTable?.rows || [];

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-4 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        EASI Table
      </h4>

      {easiError && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {easiError}
        </div>
      )}

      {/* Create new EASI table */}
      <div className="space-y-2">
        <input
          type="text"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="Table name..."
          className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
        />
        <div className="text-xs text-slate-500">
          Select {selectedIds.size} experiment(s) to compare:
        </div>
        <div className="max-h-32 overflow-y-auto border border-slate-200 rounded p-1 space-y-0.5">
          {experiments.map((e) => (
            <label
              key={e.id}
              className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer px-1 py-0.5 rounded hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(e.id)}
                onChange={() => handleToggle(e.id)}
              />
              <span className="truncate">{e.sample_name || 'Unnamed'} \u2014 {e.file_name}</span>
            </label>
          ))}
        </div>
        <button
          onClick={handleCreate}
          disabled={!tableName.trim() || selectedIds.size < 2}
          className="w-full text-xs px-3 py-2 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create EASI Table ({selectedIds.size} experiments)
        </button>
      </div>

      {/* Saved EASI tables */}
      {easiTables.length > 0 && (
        <div className="border-t border-slate-100 pt-3 space-y-1">
          <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Saved Tables
          </h5>
          {easiTables.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between text-xs border border-slate-200 rounded px-2 py-1"
            >
              <span className="text-slate-700 truncate">{t.name} ({t.experiment_ids.length} exps)</span>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => handleExport(t.id)}
                  className="text-xs px-2 py-0.5 rounded bg-brand-600 text-white hover:bg-brand-700"
                >
                  CSV
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="text-xs px-2 py-0.5 rounded text-red-500 hover:text-red-700 border border-red-200"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Current EASI table data */}
      {easiLoading && (
        <div className="text-xs text-slate-400">Loading table data\u2026</div>
      )}
      {rows.length > 0 && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            {currentEasiTable?.name || 'Table Data'}
          </h5>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className="text-left px-2 py-1 border border-slate-200 bg-slate-100 font-semibold text-slate-600"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {TABLE_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className="px-2 py-1 border border-slate-200 text-right font-mono"
                      >
                        {col.key === 'sample_name'
                          ? (row[col.key] as string) || '\u2014'
                          : col.key === 'peak_number'
                            ? row[col.key] != null ? String(row[col.key]) : '\u2014'
                            : fmtNum(row[col.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}