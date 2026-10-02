/**
 * ReportPreview — inline HTML report preview.
 *
 * Fetches an HTML report for the current experiment and renders it in an
 * iframe so the user can see a live preview before downloading.
 */
import { useEffect, useRef, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';
import * as api from '../../api/endpoints';

export default function ReportPreview() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const results = useResultsStore((s) => s.results);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handlePreview = async () => {
    if (currentExperimentId == null) return;
    setLoading(true);
    setError(null);
    try {
      const jobResp = await api.generateReport(currentExperimentId, { format: 'html' });
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        const status = await api.getReportStatus(currentExperimentId, jobResp.job_id);
        if (status.status === 'completed') {
          const blob = await api.downloadReport(currentExperimentId, jobResp.job_id);
          const text = await blob.text();
          setPreviewHtml(text);
          setLoading(false);
          return;
        }
        if (status.status === 'failed') {
          setError(status.error || 'Preview generation failed');
          setLoading(false);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      setError('Preview generation timed out');
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate preview');
      setLoading(false);
    }
  };

  useEffect(() => {
    setPreviewHtml(null);
    setError(null);
  }, [currentExperimentId]);


  if (currentExperimentId == null) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-400 italic">
        Select an experiment to preview a report.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-slate-50">
        <button
          onClick={handlePreview}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Generating\u2026' : 'Generate Preview'}
        </button>
        {results && (
          <span className="text-xs text-slate-400">
            {results.peaks.length} peak{results.peaks.length !== 1 ? 's' : ''} available
          </span>
        )}
      </div>

      {error && (
        <div className="m-4 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M5 12h14" />
            </svg>
            Generating preview\u2026
          </div>
        </div>
      )}

      {!loading && previewHtml && (
        <iframe
          ref={iframeRef}
          title="Report Preview"
          className="flex-1 w-full border-0"
          // srcDoc renders the generated HTML even under a sandbox (an opaque
          // origin makes contentDocument.write a no-op, which left this blank).
          srcDoc={previewHtml}
          sandbox="allow-same-origin"
        />
      )}

      {!loading && !previewHtml && !error && (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400 italic">
          Click "Generate Preview" to see an HTML report.
        </div>
      )}
    </div>
  );
}