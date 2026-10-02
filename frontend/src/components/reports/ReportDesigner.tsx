/**
 * ReportDesigner — report configuration, section selection, and generation.
 *
 * Provides format selector (PDF/HTML/CSV/Excel), title input, notes textarea,
 * include-slice-data checkbox, and a "Generate Report" button that calls
 * reportsStore.generateReport(). On completion, shows a download button.
 * Also includes a template management section (list, create, delete).
 */
import { useEffect, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useReportsStore } from '../../stores/reportsStore';
import type { ReportFormat } from '../../types/reports';

const inputClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

const FORMATS: { value: ReportFormat; label: string; ext: string }[] = [
  { value: 'pdf', label: 'PDF', ext: 'pdf' },
  { value: 'html', label: 'HTML', ext: 'html' },
  { value: 'csv', label: 'CSV', ext: 'csv' },
  { value: 'xlsx', label: 'Excel', ext: 'xlsx' },
];

export default function ReportDesigner() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const experimentDetail = useExperimentStore((s) => s.experimentDetail);
  const templates = useReportsStore((s) => s.templates);
  const templatesLoading = useReportsStore((s) => s.templatesLoading);
  const templatesError = useReportsStore((s) => s.templatesError);
  const jobStatus = useReportsStore((s) => s.jobStatus);
  const generating = useReportsStore((s) => s.generating);
  const generateError = useReportsStore((s) => s.generateError);
  const fetchTemplates = useReportsStore((s) => s.fetchTemplates);
  const createTemplate = useReportsStore((s) => s.createTemplate);
  const deleteTemplate = useReportsStore((s) => s.deleteTemplate);
  const generateReport = useReportsStore((s) => s.generateReport);
  const downloadReport = useReportsStore((s) => s.downloadReport);

  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [includeSliceData, setIncludeSliceData] = useState(true);
  const [newTemplateName, setNewTemplateName] = useState('');

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleGenerate = () => {
    if (currentExperimentId == null) return;
    const effectiveTitle =
      title.trim() ||
      `Astra Reader Report \u2014 ${experimentDetail?.sample_name || experimentDetail?.file_name || `Experiment ${currentExperimentId}`}`;
    generateReport(currentExperimentId, format, effectiveTitle, notes.trim() || undefined, includeSliceData);
  };

  const handleDownload = () => {
    if (currentExperimentId == null || jobStatus == null) return;
    const ext = FORMATS.find((f) => f.value === (jobStatus.format || format))?.ext || 'pdf';
    const baseName =
      experimentDetail?.file_name && experimentDetail.file_name.length > 0
        ? experimentDetail.file_name.replace(/\.afe8$/i, '')
        : `experiment_${currentExperimentId}`;
    downloadReport(currentExperimentId, jobStatus.job_id, `${baseName}_report.${ext}`);
  };

  const handleCreateTemplate = () => {
    if (!newTemplateName.trim()) return;
    createTemplate({ name: newTemplateName.trim(), template_config: JSON.stringify({ format, includeSliceData }) });
    setNewTemplateName('');
  };

  const handleDeleteTemplate = (id: number) => {
    deleteTemplate(id);
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to generate a report.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-4 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Report Designer
      </h4>

      {/* Format selector */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">Format</label>
        <div className="flex gap-2 flex-wrap">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFormat(f.value)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                format === f.value
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">
          Title <span className="text-slate-400">(optional)</span>
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Astra Reader Report \u2014 ${experimentDetail?.sample_name || '...'}`}
          className={inputClass}
        />
      </label>

      {/* Notes */}
      <label className="block">
        <span className="block text-xs text-slate-500 mb-0.5">
          Notes <span className="text-slate-400">(optional)</span>
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Summary notes for the report..."
          className={inputClass}
        />
      </label>

      {/* Include slice data */}
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={includeSliceData}
          onChange={(e) => setIncludeSliceData(e.target.checked)}
          className="rounded"
        />
        Include per-slice data (M, Rg, concentration)
      </label>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="w-full text-xs px-3 py-2 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {generating ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M5 12h14" />
            </svg>
            Generating\u2026
          </span>
        ) : (
          `Generate ${FORMATS.find((f) => f.value === format)?.label} Report`
        )}
      </button>

      {/* Progress */}
      {generating && jobStatus && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{jobStatus.message || 'Working\u2026'}</span>
            <span className="font-mono">{jobStatus.progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, jobStatus.progress))}%` }}
            />
          </div>
        </div>
      )}

      {/* Errors */}
      {generateError && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {generateError}
        </div>
      )}

      {/* Download button */}
      {jobStatus && jobStatus.status === 'completed' && !generating && (
        <button
          onClick={handleDownload}
          className="w-full text-xs px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download Report ({jobStatus.file_size ? `${(jobStatus.file_size / 1024).toFixed(1)} KB` : ''})
        </button>
      )}

      {/* Template management */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Report Templates
        </h5>

        {templatesError && (
          <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {templatesError}
          </div>
        )}

        {templatesLoading && (
          <div className="text-xs text-slate-400">Loading templates\u2026</div>
        )}

        {templates.length === 0 && !templatesLoading && (
          <div className="text-xs text-slate-400 italic">No saved templates.</div>
        )}

        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-xs border border-slate-200 rounded px-2 py-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-slate-700 truncate">{t.name}</span>
              {t.is_default && (
                <span className="text-xs text-brand-600 font-semibold shrink-0">default</span>
              )}
            </div>
            <button
              onClick={() => handleDeleteTemplate(t.id)}
              className="text-xs text-red-500 hover:text-red-700 shrink-0"
            >
              Delete
            </button>
          </div>
        ))}

        {/* Create new template */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newTemplateName}
            onChange={(e) => setNewTemplateName(e.target.value)}
            placeholder="New template name..."
            className={inputClass}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTemplate(); }}
          />
          <button
            onClick={handleCreateTemplate}
            disabled={!newTemplateName.trim()}
            className="text-xs px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 shrink-0"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}