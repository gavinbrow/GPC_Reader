/**
 * ReportExport — quick export buttons for PDF/HTML/CSV/Excel.
 *
 * Compact panel with four format buttons. Each triggers generate + poll +
 * auto-download. Shows inline progress and error/success banners.
 */
import { useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useReportsStore } from '../../stores/reportsStore';
import type { ReportFormat } from '../../types/reports';

const FORMATS: { value: ReportFormat; label: string; ext: string; icon: JSX.Element }[] = [
  {
    value: 'pdf',
    label: 'PDF',
    ext: 'pdf',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    value: 'html',
    label: 'HTML',
    ext: 'html',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    value: 'csv',
    label: 'CSV',
    ext: 'csv',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m-6 8h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    value: 'xlsx',
    label: 'Excel',
    ext: 'xlsx',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6M3 5h18M3 5v14a2 2 0 002 2h14a2 2 0 002-2V5M3 5l2-2h14l2 2" />
      </svg>
    ),
  },
];

export default function ReportExport() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const experimentDetail = useExperimentStore((s) => s.experimentDetail);
  const generating = useReportsStore((s) => s.generating);
  const jobStatus = useReportsStore((s) => s.jobStatus);
  const generateError = useReportsStore((s) => s.generateError);
  const generateReport = useReportsStore((s) => s.generateReport);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeFormat, setActiveFormat] = useState<ReportFormat | null>(null);

  const handleExport = async (fmt: ReportFormat) => {
    if (currentExperimentId == null) return;
    setActiveFormat(fmt);
    setSuccessMsg(null);
    const title = `Astra Reader Report \u2014 ${experimentDetail?.sample_name || experimentDetail?.file_name || ''}`;
    await generateReport(currentExperimentId, fmt, title, undefined, true);

    const store = useReportsStore.getState();
    if (store.jobStatus && store.jobStatus.status === 'completed') {
      const ext = FORMATS.find((f) => f.value === fmt)?.ext || fmt;
      const baseName =
        experimentDetail?.file_name && experimentDetail.file_name.length > 0
          ? experimentDetail.file_name.replace(/\.afe8$/i, '')
          : `experiment_${currentExperimentId}`;
      await store.downloadReport(currentExperimentId, store.jobStatus.job_id, `${baseName}_report.${ext}`);
      setSuccessMsg(`${fmt.toUpperCase()} report downloaded`);
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to export a report.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Quick Export
      </h4>

      <div className="grid grid-cols-2 gap-2">
        {FORMATS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleExport(f.value)}
            disabled={generating}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded border border-slate-300 text-slate-700 hover:border-brand-400 hover:bg-brand-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating && activeFormat === f.value ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M5 12h14" />
              </svg>
            ) : (
              f.icon
            )}
            {f.label}
          </button>
        ))}
      </div>

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

      {generateError && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {generateError}
        </div>
      )}

      {successMsg && (
        <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
          {successMsg}
        </div>
      )}
    </div>
  );
}