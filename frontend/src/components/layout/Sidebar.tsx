import { useState, useEffect, useCallback } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import FileUpload from '../upload/FileUpload';

export default function Sidebar() {
  const {
    experiments,
    totalExperiments,
    currentPage,
    totalPages,
    searchQuery,
    listLoading,
    listError,
    currentExperimentId,
    fetchExperiments,
    setSearchQuery,
    searchExperiments,
    setPage,
    selectExperiment,
    deleteExperiment,
  } = useExperimentStore();

  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    // Load on mount
    fetchExperiments(1);
  }, [fetchExperiments]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(localSearch);
    searchExperiments();
  };

  const handleExperimentClick = useCallback(
    (id: number) => {
      selectExperiment(id);
    },
    [selectExperiment],
  );

  const handleDelete = (id: number) => {
    deleteExperiment(id);
    setConfirmDeleteId(null);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatSize = (bytes: number | null) => {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      {/* Upload section */}
      <FileUpload />

      {/* Search */}
      <div className="px-4 py-3 border-b border-slate-200">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search sample name..."
            className="flex-1 text-sm px-3 py-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {/* Experiment count */}
      <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
        {totalExperiments} experiment{totalExperiments !== 1 ? 's' : ''}
        {totalExperiments > 0 && ` · Page ${currentPage} of ${totalPages}`}
      </div>

      {/* Error */}
      {listError && (
        <div className="mx-4 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {listError}
        </div>
      )}

      {/* Experiment list */}
      <div className="flex-1 overflow-y-auto">
        {listLoading && experiments.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
            Loading...
          </div>
        ) : experiments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm">
            <p>No experiments yet</p>
            <p className="text-xs mt-1">Upload .afe8 files to get started</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {experiments.map((exp) => (
              <li
                key={exp.id}
                className={`group px-4 py-3 cursor-pointer transition-colors ${
                  currentExperimentId === exp.id
                    ? 'bg-brand-50 border-l-4 border-brand-600'
                    : 'hover:bg-slate-50 border-l-4 border-transparent'
                }`}
                onClick={() => handleExperimentClick(exp.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {exp.sample_name || 'Unnamed sample'}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {exp.file_name}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{formatDate(exp.collection_time)}</span>
                      <span>·</span>
                      <span>{formatSize(exp.file_size)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmDeleteId === exp.id) {
                        handleDelete(exp.id);
                      } else {
                        setConfirmDeleteId(exp.id);
                        setTimeout(() => setConfirmDeleteId(null), 3000);
                      }
                    }}
                    className={`shrink-0 p-1.5 rounded transition-all ${
                      confirmDeleteId === exp.id
                        ? 'bg-red-500 text-white'
                        : 'text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100'
                    }`}
                    title={confirmDeleteId === exp.id ? 'Click again to confirm' : 'Delete experiment'}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
                {confirmDeleteId === exp.id && (
                  <div className="mt-1 text-xs text-red-600 font-medium">
                    Click again to confirm deletion
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-white">
          <button
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
            className="px-3 py-1.5 text-sm rounded border border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-500">
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
            className="px-3 py-1.5 text-sm rounded border border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}