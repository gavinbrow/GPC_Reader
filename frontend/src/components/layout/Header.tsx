import { useEffect, useRef, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useProcedureStore } from '../../stores/procedureStore';
import { useResultsStore } from '../../stores/resultsStore';
import { usePeakStore } from '../../stores/peakStore';
import * as api from '../../api/endpoints';

export default function Header() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const experimentDetail = useExperimentStore((s) => s.experimentDetail);
  const isDirty = useExperimentStore((s) => s.isDirty);
  const markClean = useExperimentStore((s) => s.markClean);
  const [exporting, setExporting] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const isRunning = useProcedureStore((s) => s.isRunning);
  const progressPct = useProcedureStore((s) => s.progressPct);
  const progressMessage = useProcedureStore((s) => s.progressMessage);
  const progressProcedure = useProcedureStore((s) => s.progressProcedure);
  const runError = useProcedureStore((s) => s.runError);
  const runAsyncAnalysis = useProcedureStore((s) => s.runAsyncAnalysis);
  const clearProgress = useProcedureStore((s) => s.clearProgress);

  const fetchResults = useResultsStore((s) => s.fetchResults);
  const fetchMolarMass = useResultsStore((s) => s.fetchMolarMass);
  const fetchRadius = useResultsStore((s) => s.fetchRadius);
  const fetchDistributions = useResultsStore((s) => s.fetchDistributions);
  const fetchAngularFit = useResultsStore((s) => s.fetchAngularFit);
  const fetchConformation = useResultsStore((s) => s.fetchConformation);
  const fetchViscometry = useResultsStore((s) => s.fetchViscometry);
  const fetchCalibration = useResultsStore((s) => s.fetchCalibration);
  const fetchPeakStatistics = useResultsStore((s) => s.fetchPeakStatistics);
  const fetchErrorAnalysis = useResultsStore((s) => s.fetchErrorAnalysis);
  const fetchA2 = useResultsStore((s) => s.fetchA2);
  const fetchPeaks = usePeakStore((s) => s.fetchPeaks);

  const [analysisComplete, setAnalysisComplete] = useState(false);
  const prevIsRunning = useRef(false);

  useEffect(() => {
    const wasRunning = prevIsRunning.current;
    prevIsRunning.current = isRunning;
    if (wasRunning && !isRunning && !runError) {
      setAnalysisComplete(true);
      const t = setTimeout(() => setAnalysisComplete(false), 4000);
      if (currentExperimentId != null) {
        fetchResults(currentExperimentId);
        fetchMolarMass(currentExperimentId);
        fetchRadius(currentExperimentId);
        fetchDistributions(currentExperimentId);
        fetchAngularFit(currentExperimentId);
        fetchConformation(currentExperimentId);
        fetchViscometry(currentExperimentId);
        fetchCalibration(currentExperimentId);
        fetchPeakStatistics(currentExperimentId, { detector: 'RI' });
        fetchErrorAnalysis(currentExperimentId);
        fetchA2(currentExperimentId);
        fetchPeaks(currentExperimentId);
      }
      return () => clearTimeout(t);
    }
    if (!isRunning && runError) {
      const t = setTimeout(() => clearProgress(), 6000);
      return () => clearTimeout(t);
    }
  }, [isRunning, runError, currentExperimentId, fetchResults, fetchMolarMass, fetchRadius, fetchDistributions, fetchAngularFit, fetchConformation, fetchViscometry, fetchCalibration, fetchPeakStatistics, fetchErrorAnalysis, fetchA2, fetchPeaks, clearProgress]);

  const handleExport = async () => {
    if (currentExperimentId == null) return;
    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const blob = await api.exportExperiment(currentExperimentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName =
        experimentDetail?.file_name && experimentDetail.file_name.length > 0
          ? experimentDetail.file_name.replace(/\.afe8$/i, '')
          : `experiment_${currentExperimentId}`;
      a.href = url;
      a.download = `${baseName}.afe8`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      markClean();
      setExportSuccess('Saved .afe8 download started');
      setTimeout(() => setExportSuccess(null), 4000);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleSaveAs = async (fileName: string) => {
    if (currentExperimentId == null) return;
    setExporting(true);
    setExportError(null);
    setSaveAsOpen(false);
    try {
      const blob = await api.saveAsExperiment(currentExperimentId, fileName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.endsWith('.afe8') ? fileName : `${fileName}.afe8`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportSuccess('Save As download started');
      setTimeout(() => setExportSuccess(null), 4000);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Save As failed');
    } finally {
      setExporting(false);
    }
  };

  const handleAnalyze = () => {
    if (currentExperimentId == null) return;
    setAnalysisComplete(false);
    runAsyncAnalysis(currentExperimentId);
  };

  const procLabel = progressProcedure
    ? progressProcedure.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

  return (
    <header className="flex flex-col bg-brand-900 text-white shadow-md">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-brand-100"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12h4l3-9 4 18 3-9h4" />
          </svg>
          <div>
            <h1 className="text-xl font-bold tracking-tight">ASTRA Reader</h1>
            <p className="text-xs text-brand-300">Chromatogram Analysis</p>
          </div>
          {isDirty && (
            <span className="flex items-center gap-1 text-xs text-amber-300 bg-amber-950/40 px-2 py-1 rounded border border-amber-700/50" title="You have unsaved changes">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              Unsaved changes
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {exportError && (
            <span className="text-xs text-red-300 bg-red-950/40 px-2 py-1 rounded border border-red-700/50">
              {exportError}
            </span>
          )}
          {exportSuccess && (
            <span className="text-xs text-green-300 bg-green-950/40 px-2 py-1 rounded border border-green-700/50">
              {exportSuccess}
            </span>
          )}
          {analysisComplete && (
            <span className="text-xs text-green-300 bg-green-950/40 px-2 py-1 rounded border border-green-700/50">
              Analysis complete
            </span>
          )}
          {runError && (
            <span className="text-xs text-red-300 bg-red-950/40 px-2 py-1 rounded border border-red-700/50">
              {runError}
            </span>
          )}
          <button
            onClick={handleAnalyze}
            disabled={currentExperimentId == null || isRunning}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-brand-400 hover:bg-brand-300 disabled:bg-brand-800 disabled:cursor-not-allowed transition-colors font-semibold text-brand-950"
            title="Run the full analysis pipeline with progress"
          >
            {isRunning ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3v18M5 12h14"
                  />
                </svg>
                Analyzing…
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
                  />
                </svg>
                One-Click Analysis
              </>
            )}
          </button>
          {saveAsOpen && (
            <div className="flex items-center gap-1.5 bg-brand-800 px-2 py-1 rounded">
              <input
                type="text"
                placeholder="file name…"
                defaultValue=""
                className="text-xs px-2 py-0.5 rounded bg-brand-950 text-white border border-brand-700 placeholder-brand-400 w-32 focus:outline-none focus:ring-1 focus:ring-brand-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveAs((e.target as HTMLInputElement).value || 'copy');
                  } else if (e.key === 'Escape') {
                    setSaveAsOpen(false);
                  }
                }}
                autoFocus
              />
              <button
                onClick={(e) => {
                  const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                  handleSaveAs(input?.value || 'copy');
                }}
                className="text-xs px-2 py-0.5 rounded bg-brand-400 text-brand-950 font-semibold hover:bg-brand-300"
              >
                Save
              </button>
              <button
                onClick={() => setSaveAsOpen(false)}
                className="text-xs px-1 py-0.5 text-brand-300 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}
          <button
            onClick={() => setSaveAsOpen(true)}
            disabled={currentExperimentId == null || exporting || saveAsOpen}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-brand-700 hover:bg-brand-600 disabled:bg-brand-800 disabled:cursor-not-allowed transition-colors"
            title="Save a copy of the .afe8 with a new name"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992V18.75A2.25 2.25 0 0118.75 21H5.25A2.25 2.25 0 013 18.75V5.25A2.25 2.25 0 015.25 3h9.402v4.992"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 3v4.992h4.992M3 16.5h4.5v4.5"
              />
            </svg>
            Save As
          </button>
          <button
            onClick={handleExport}
            disabled={currentExperimentId == null || exporting}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 disabled:bg-brand-800 disabled:cursor-not-allowed transition-colors"
            title="Save a modified .afe8 file with current baselines, peaks, and results"
          >
            {exporting ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3v18M5 12h14"
                  />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                Save .afe8
              </>
            )}
          </button>
          <div className="text-xs text-brand-300 hidden sm:block">
            Phase 8 &middot; Production
          </div>
        </div>
      </div>
      {isRunning && (
        <div className="px-6 py-1.5 bg-brand-950/60 border-t border-brand-800">
          <div className="flex items-center justify-between text-xs text-brand-200 mb-1">
            <span>
              {procLabel ? `${procLabel}` : 'Working…'}
              {progressMessage ? ` — ${progressMessage}` : ''}
            </span>
            <span className="font-mono">{Math.round(progressPct)}%</span>
          </div>
          <div className="h-1.5 bg-brand-800 rounded overflow-hidden">
            <div
              className="h-full bg-brand-400 transition-all duration-200"
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
        </div>
      )}
    </header>
  );
}