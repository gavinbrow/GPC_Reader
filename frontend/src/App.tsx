import { useEffect, useState } from 'react';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import DetectorSelector from './components/chromatogram/DetectorSelector';
import ChromatogramPlot from './components/chromatogram/ChromatogramPlot';
import MolarMassPlot from './components/plots/MolarMassPlot';
import RadiusPlot from './components/plots/RadiusPlot';
import DifferentialDistribution from './components/plots/DifferentialDistribution';
import CumulativeDistribution from './components/plots/CumulativeDistribution';
import AngularFitPlot from './components/plots/AngularFitPlot';
import ConformationPlot from './components/plots/ConformationPlot';
import MarkHouwinkPlot from './components/plots/MarkHouwinkPlot';
import CalibrationCurve from './components/plots/CalibrationCurve';
import NumberDensityPlot from './components/plots/NumberDensityPlot';
import EASIGraph from './components/plots/EASIGraph';
import ZimmPlot from './components/plots/ZimmPlot';
import MetadataPanel from './components/MetadataPanel';
import PeakPanel from './components/analysis/PeakPanel';
import FitPanel from './components/analysis/FitPanel';
import ProcedureChain from './components/analysis/ProcedureChain';
import ConjugatePanel from './components/analysis/ConjugatePanel';
import BranchingPanel from './components/analysis/BranchingPanel';
import ViscometryPanel from './components/analysis/ViscometryPanel';
import CalibrationPanel from './components/analysis/CalibrationPanel';
import ParticlePanel from './components/analysis/ParticlePanel';
import DnDcDeterminationPanel from './components/analysis/DnDcDeterminationPanel';
import AbsorptionCorrectionPanel from './components/analysis/AbsorptionCorrectionPanel';
import PeakStatisticsTable from './components/tables/PeakStatisticsTable';
import ResultsTable from './components/results/ResultsTable';
import ReportPreview from './components/reports/ReportPreview';
import ReportDesigner from './components/reports/ReportDesigner';
import ReportExport from './components/reports/ReportExport';
import BatchProcessor from './components/batch/BatchProcessor';
import MethodManager from './components/batch/MethodManager';
import EASITable from './components/tables/EASITable';
import BatchUpload from './components/upload/BatchUpload';
import ErrorBoundary from './components/ErrorBoundary';
import { useExperimentStore } from './stores/experimentStore';
import { useBaselineStore } from './stores/baselineStore';
import { usePeakStore } from './stores/peakStore';
import { useProcedureStore } from './stores/procedureStore';
import { useResultsStore } from './stores/resultsStore';
import { useReportsStore } from './stores/reportsStore';
import { useBatchStore } from './stores/batchStore';

type RightTabId = 'metadata' | 'peaks' | 'analysis' | 'results' | 'advanced' | 'reports' | 'batch';

const RIGHT_TABS: { id: RightTabId; label: string }[] = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'peaks', label: 'Peaks' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'results', label: 'Results' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'reports', label: 'Reports' },
  { id: 'batch', label: 'Batch' },
];

type CenterTabId =
  | 'chromatogram'
  | 'molar-mass'
  | 'radius'
  | 'distribution'
  | 'angular-fit'
  | 'conformation'
  | 'mark-houwink'
  | 'calibration'
  | 'number-density'
  | 'zimm-plot'
  | 'report-preview'
  | 'easi-graph';

const CENTER_TABS: { id: CenterTabId; label: string }[] = [
  { id: 'chromatogram', label: 'Chromatogram' },
  { id: 'molar-mass', label: 'Molar Mass' },
  { id: 'radius', label: 'Radius' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'angular-fit', label: 'Angular Fit' },
  { id: 'conformation', label: 'Conformation' },
  { id: 'mark-houwink', label: 'Mark-Houwink' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'number-density', label: 'Number Density' },
  { id: 'zimm-plot', label: 'Zimm Plot' },
  { id: 'report-preview', label: 'Report Preview' },
  { id: 'easi-graph', label: 'EASI Graph' },
];

export default function App() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const clearBaselines = useBaselineStore((s) => s.clear);
  const clearPeaks = usePeakStore((s) => s.clear);
  const clearProcedures = useProcedureStore((s) => s.clear);
  const clearResults = useResultsStore((s) => s.clear);
  const clearReports = useReportsStore((s) => s.clear);
  const clearBatch = useBatchStore((s) => s.clear);
  const [rightTab, setRightTab] = useState<RightTabId>('metadata');
  const [centerTab, setCenterTab] = useState<CenterTabId>('chromatogram');

  useEffect(() => {
    clearBaselines();
    clearPeaks();
    clearProcedures();
    clearResults();
    clearReports();
    clearBatch();
  }, [currentExperimentId, clearBaselines, clearPeaks, clearProcedures, clearResults, clearReports, clearBatch]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-80 shrink-0 overflow-hidden flex flex-col">
          <Sidebar />
        </aside>

        {/* Center: chromatogram / molar mass / radius / distributions / angular fit / report preview */}
        <main className="flex-1 flex flex-col overflow-hidden bg-white">
          <div className="flex overflow-x-auto border-b border-slate-200 bg-slate-50">
            {CENTER_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCenterTab(tab.id)}
                className={`shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-wide py-2 px-4 transition-colors ${
                  centerTab === tab.id
                    ? 'text-brand-700 border-b-2 border-brand-600 bg-white'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <ErrorBoundary resetKey={centerTab} label="This view failed to render">
          {centerTab === 'chromatogram' ? (
            <>
              <DetectorSelector />
              <div className="flex-1 overflow-hidden p-2">
                <ChromatogramPlot />
              </div>
            </>
          ) : centerTab === 'molar-mass' ? (
            <div className="flex-1 overflow-hidden p-2">
              <MolarMassPlot />
            </div>
          ) : centerTab === 'radius' ? (
            <div className="flex-1 overflow-hidden p-2">
              <RadiusPlot />
            </div>
          ) : centerTab === 'distribution' ? (
            <div className="flex-1 overflow-hidden p-2 flex flex-col gap-2">
              <div className="flex-1 overflow-hidden border border-slate-200 rounded min-h-0">
                <DifferentialDistribution />
              </div>
              <div className="flex-1 overflow-hidden border border-slate-200 rounded min-h-0">
                <CumulativeDistribution />
              </div>
            </div>
          ) : centerTab === 'angular-fit' ? (
            <div className="flex-1 overflow-hidden p-2">
              <AngularFitPlot />
            </div>
          ) : centerTab === 'conformation' ? (
            <div className="flex-1 overflow-hidden p-2">
              <ConformationPlot />
            </div>
          ) : centerTab === 'mark-houwink' ? (
            <div className="flex-1 overflow-hidden p-2">
              <MarkHouwinkPlot />
            </div>
          ) : centerTab === 'calibration' ? (
            <div className="flex-1 overflow-hidden p-2">
              <CalibrationCurve />
            </div>
          ) : centerTab === 'number-density' ? (
            <div className="flex-1 overflow-hidden p-2">
              <NumberDensityPlot />
            </div>
          ) : centerTab === 'zimm-plot' ? (
            <div className="flex-1 overflow-hidden p-2">
              <ZimmPlot />
            </div>
          ) : centerTab === 'easi-graph' ? (
            <div className="flex-1 overflow-hidden p-2">
              <EASIGraph />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden p-2">
              <ReportPreview />
            </div>
          )}
          </ErrorBoundary>
        </main>

        {/* Right: metadata / peaks / analysis / results / advanced / reports tabs */}
        <aside className="w-96 shrink-0 overflow-hidden border-l border-slate-200 flex flex-col">
          <div className="flex border-b border-slate-200 bg-slate-50">
            {RIGHT_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={`flex-1 text-xs font-semibold uppercase tracking-wide py-2 transition-colors ${
                  rightTab === tab.id
                    ? 'text-brand-700 border-b-2 border-brand-600 bg-white'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {rightTab === 'metadata' ? (
              <MetadataPanel />
            ) : rightTab === 'peaks' ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex-1 overflow-hidden">
                  <PeakPanel />
                </div>
                <div className="overflow-y-auto">
                  <FitPanel />
                </div>
              </div>
            ) : rightTab === 'analysis' ? (
              <ProcedureChain />
            ) : rightTab === 'results' ? (
              <ResultsTable />
            ) : rightTab === 'advanced' ? (
              <div className="h-full overflow-y-auto">
                <ConjugatePanel />
                <BranchingPanel />
                <ViscometryPanel />
                <CalibrationPanel />
                <ParticlePanel />
                <DnDcDeterminationPanel />
                <AbsorptionCorrectionPanel />
                <PeakStatisticsTable />
              </div>
            ) : rightTab === 'reports' ? (
              <div className="h-full overflow-y-auto">
                <ReportDesigner />
                <ReportExport />
              </div>
            ) : (
              <div className="h-full overflow-y-auto">
                <BatchUpload />
                <BatchProcessor />
                <MethodManager />
                <EASITable />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}