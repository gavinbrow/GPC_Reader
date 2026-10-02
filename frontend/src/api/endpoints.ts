import api from './client';
import type {
  ExperimentSummary,
  ExperimentDetail,
  PaginatedResponse,
  ExperimentListParams,
} from '../types/experiment';
import type {
  ChromatogramResponse,
  DetectorListResponse,
} from '../types/chromatogram';
import type {
  BaselineResponse,
  BaselineCreate,
  BaselineListResponse,
  AutoBaselineRequest,
  AutoBaselineResponse,
} from '../types/baseline';
import type {
  PeakResponse,
  PeakCreate,
  PeakUpdate,
  PeakListResponse,
  AutoPeakRequest,
  AutoPeakResponse,
  DnDcLibraryResponse,
} from '../types/peak';
import type {
  ProcedureStateResponse,
  ProcedureListResponse,
  ProcedureUpdateRequest,
  ProcedureRunRequest,
  AutoAnalyzeResponse,
  AsyncJobResponse,
} from '../types/procedures';
import type {
  PeakResultsResponse,
  MomentsResponse,
  MolarMassResponse,
  RadiusResponse,
  DistributionResponse,
  ResultsResponse,
  DistributionParams,
  AngularFitResponse,
  ConformationResponse,
  ConjugateResponse,
  ConjugateParams,
  BranchingResponse,
  BranchingParams,
  ViscometryResponse,
  CalibrationResponse,
  ParticleResponse,
  ParticleParams,
  PeakStatisticsListResponse,
  PeakStatisticsParams,
  DnDcDeterminationResponse,
  DnDcParams,
  ErrorAnalysisResponse,
  A2Response,
  ZimmPlotResponse,
  BatchA2Request,
  BatchA2Response,
  AbsorptionCorrectionRequest,
  AbsorptionCorrectionResponse,
  BackupListResponse,
  BackupCreateResponse,
} from '../types/results';

// ---- File upload ----
export async function uploadFiles(files: File[], onProgress?: (pct: number) => void) {
  const formData = new FormData();
  for (const f of files) {
    formData.append('files', f);
  }
  const res = await api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        onProgress(Math.round((e.loaded * 100) / e.total));
      }
    },
  });
  // Backend returns a single object for one file, or an array for multiple
  return Array.isArray(res.data) ? res.data : [res.data];
}

// ---- Experiment list ----
export async function listExperiments(
  params: ExperimentListParams = {},
): Promise<PaginatedResponse<ExperimentSummary>> {
  const res = await api.get('/files', {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 20,
      sample_name: params.sample_name ?? '',
      date_from: params.date_from ?? '',
      date_to: params.date_to ?? '',
    },
  });
  // Backend returns { experiments: [...], total, page, limit, pages }
  const d = res.data;
  return {
    items: d.experiments,
    total: d.total,
    page: d.page,
    limit: d.limit,
    pages: d.pages,
  };
}

// ---- Experiment detail ----
export async function getExperiment(id: number): Promise<ExperimentDetail> {
  const res = await api.get<ExperimentDetail>(`/files/${id}`);
  return res.data;
}

// ---- Delete experiment ----
export async function deleteExperiment(id: number): Promise<void> {
  await api.delete(`/files/${id}`);
}

// ---- Chromatogram ----
export async function getChromatogram(
  experimentId: number,
  baselineSubtracted = false,
): Promise<ChromatogramResponse> {
  const res = await api.get<ChromatogramResponse>(
    `/experiments/${experimentId}/chromatograms`,
    { params: { baseline_subtracted: baselineSubtracted } },
  );
  return res.data;
}

export async function getDetectorChromatogram(
  experimentId: number,
  detector: string,
): Promise<ChromatogramResponse> {
  const res = await api.get<ChromatogramResponse>(
    `/experiments/${experimentId}/chromatograms/${detector}`,
  );
  return res.data;
}

// ---- Detectors ----
export async function getDetectors(experimentId: number): Promise<DetectorListResponse> {
  const res = await api.get<DetectorListResponse>(
    `/experiments/${experimentId}/detectors`,
  );
  return res.data;
}

// ---- Instruments ----
export async function getInstruments(experimentId: number) {
  const res = await api.get(`/experiments/${experimentId}/instruments`);
  return res.data;
}

// ---- Solvent ----
export async function getSolvent(experimentId: number) {
  const res = await api.get(`/experiments/${experimentId}/solvent`);
  return res.data;
}

// ---- Sample ----
export async function getSample(experimentId: number) {
  const res = await api.get(`/experiments/${experimentId}/sample`);
  return res.data;
}

export interface DetectorProcessing {
  shift?: number; // inter-detector alignment: time shift in minutes
  broaden?: number; // band broadening: Gaussian sigma in minutes
}

export interface ProcessingConfig {
  MALS?: DetectorProcessing;
  RI?: DetectorProcessing;
  UV?: DetectorProcessing;
}

export interface SampleUpdate {
  dn_dc?: number;
  concentration?: number;
  a2?: number;
  real_ri?: number;
  processing?: ProcessingConfig;
}

export async function updateSample(experimentId: number, body: SampleUpdate) {
  const res = await api.patch(`/experiments/${experimentId}/sample`, body);
  return res.data;
}

// ---- Fluid path ----
export async function getFluidPath(experimentId: number) {
  const res = await api.get(`/experiments/${experimentId}/fluid-path`);
  return res.data;
}

// ---- Baselines ----
export async function listBaselines(experimentId: number): Promise<BaselineListResponse> {
  const res = await api.get<BaselineListResponse>(
    `/experiments/${experimentId}/baselines`,
  );
  return res.data;
}

export async function upsertBaseline(
  experimentId: number,
  detector: string,
  body: BaselineCreate,
  version?: number,
): Promise<BaselineResponse> {
  const headers: Record<string, string> = {};
  if (version !== undefined) headers['X-Resource-Version'] = String(version);
  const res = await api.put<BaselineResponse>(
    `/experiments/${experimentId}/baselines/${detector}`,
    body,
    { headers },
  );
  return res.data;
}

export async function deleteBaseline(
  experimentId: number,
  detector: string,
  version?: number,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (version !== undefined) headers['X-Resource-Version'] = String(version);
  await api.delete(`/experiments/${experimentId}/baselines/${detector}`, { headers });
}

export async function autoBaselines(
  experimentId: number,
  params?: AutoBaselineRequest,
): Promise<AutoBaselineResponse> {
  const res = await api.post<AutoBaselineResponse>(
    `/experiments/${experimentId}/baselines/auto`,
    params ?? {},
  );
  return res.data;
}

// ---- Peaks ----
export async function listPeaks(experimentId: number): Promise<PeakListResponse> {
  const res = await api.get<PeakListResponse>(`/experiments/${experimentId}/peaks`);
  return res.data;
}

export async function createPeak(
  experimentId: number,
  body: PeakCreate,
): Promise<PeakResponse> {
  const res = await api.post<PeakResponse>(`/experiments/${experimentId}/peaks`, body);
  return res.data;
}

export async function getPeak(experimentId: number, peakId: number): Promise<PeakResponse> {
  const res = await api.get<PeakResponse>(
    `/experiments/${experimentId}/peaks/${peakId}`,
  );
  return res.data;
}

export async function updatePeak(
  experimentId: number,
  peakId: number,
  body: PeakUpdate,
  version?: number,
): Promise<PeakResponse> {
  const headers: Record<string, string> = {};
  if (version !== undefined) headers['X-Resource-Version'] = String(version);
  const res = await api.put<PeakResponse>(
    `/experiments/${experimentId}/peaks/${peakId}`,
    body,
    { headers },
  );
  return res.data;
}

export async function deletePeak(
  experimentId: number,
  peakId: number,
  version?: number,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (version !== undefined) headers['X-Resource-Version'] = String(version);
  await api.delete(`/experiments/${experimentId}/peaks/${peakId}`, { headers });
}

export async function autoDetectPeaks(
  experimentId: number,
  params?: AutoPeakRequest,
): Promise<AutoPeakResponse> {
  const res = await api.post<AutoPeakResponse>(
    `/experiments/${experimentId}/peaks/auto`,
    params ?? {},
  );
  return res.data;
}

// ---- dn/dc library ----
export async function getDnDcLibrary(
  polymer?: string,
  solvent?: string,
): Promise<DnDcLibraryResponse> {
  const res = await api.get<DnDcLibraryResponse>('/dndc/library', {
    params: { polymer: polymer ?? '', solvent: solvent ?? '' },
  });
  return res.data;
}

// ---- Export .afe8 ----
export async function exportExperiment(
  experimentId: number,
  options?: { include_baselines?: boolean; include_peaks?: boolean; include_results?: boolean; include_procedures?: boolean },
): Promise<Blob> {
  const res = await api.post(`/files/${experimentId}/export`, options ?? undefined, {
    responseType: 'blob',
  });
  return res.data as Blob;
}

// ---- Save As .afe8 ----
export async function saveAsExperiment(
  experimentId: number,
  newFileName?: string,
  options?: { include_baselines?: boolean; include_peaks?: boolean; include_results?: boolean; include_procedures?: boolean },
): Promise<Blob> {
  const body = newFileName || options
    ? { new_file_name: newFileName ?? null, options: options ?? undefined }
    : undefined;
  const res = await api.post(`/files/${experimentId}/save-as`, body, {
    responseType: 'blob',
  });
  return res.data as Blob;
}

// ---- Procedures ----
export async function getProcedures(
  experimentId: number,
): Promise<ProcedureListResponse> {
  const res = await api.get<ProcedureListResponse>(
    `/experiments/${experimentId}/procedures`,
  );
  return res.data;
}

export async function updateProcedure(
  experimentId: number,
  name: string,
  body: ProcedureUpdateRequest,
  version?: number,
): Promise<ProcedureStateResponse> {
  const headers: Record<string, string> = {};
  if (version !== undefined) headers['X-Resource-Version'] = String(version);
  const res = await api.put<ProcedureStateResponse>(
    `/experiments/${experimentId}/procedures/${name}`,
    body,
    { headers },
  );
  return res.data;
}

export async function runAllProcedures(
  experimentId: number,
  body?: ProcedureRunRequest,
): Promise<AutoAnalyzeResponse> {
  const res = await api.post<AutoAnalyzeResponse>(
    `/experiments/${experimentId}/procedures/run`,
    body ?? {},
  );
  return res.data;
}

export async function runSingleProcedure(
  experimentId: number,
  name: string,
  body?: ProcedureRunRequest,
): Promise<AutoAnalyzeResponse> {
  const res = await api.post<AutoAnalyzeResponse>(
    `/experiments/${experimentId}/procedures/${name}/run`,
    body ?? {},
  );
  return res.data;
}

export async function autoAnalyze(
  experimentId: number,
): Promise<AutoAnalyzeResponse> {
  const res = await api.post<AutoAnalyzeResponse>(
    `/experiments/${experimentId}/auto-analyze`,
  );
  return res.data;
}

export async function runAsyncAnalysis(
  experimentId: number,
): Promise<AsyncJobResponse> {
  const res = await api.post<AsyncJobResponse>(
    `/experiments/${experimentId}/procedures/run-async`,
  );
  return res.data;
}

// ---- Results ----
export async function getResults(
  experimentId: number,
): Promise<ResultsResponse> {
  const res = await api.get<ResultsResponse>(
    `/experiments/${experimentId}/results`,
  );
  return res.data;
}

export async function getResultsPeaks(
  experimentId: number,
): Promise<PeakResultsResponse[]> {
  const res = await api.get<PeakResultsResponse[]>(
    `/experiments/${experimentId}/results/peaks`,
  );
  return res.data;
}

export async function getResultsMoments(
  experimentId: number,
): Promise<MomentsResponse> {
  const res = await api.get<MomentsResponse>(
    `/experiments/${experimentId}/results/moments`,
  );
  return res.data;
}

export async function getResultsMolarMass(
  experimentId: number,
  peakId?: number,
): Promise<MolarMassResponse> {
  const res = await api.get<MolarMassResponse>(
    `/experiments/${experimentId}/results/molar-mass`,
    { params: peakId != null ? { peak_id: peakId } : {} },
  );
  return res.data;
}

export async function getResultsRadius(
  experimentId: number,
  peakId?: number,
): Promise<RadiusResponse> {
  const res = await api.get<RadiusResponse>(
    `/experiments/${experimentId}/results/radius`,
    { params: peakId != null ? { peak_id: peakId } : {} },
  );
  return res.data;
}

export async function getResultsDistributions(
  experimentId: number,
  params?: DistributionParams,
): Promise<DistributionResponse[]> {
  const res = await api.get<DistributionResponse[]>(
    `/experiments/${experimentId}/results/distributions`,
    { params: params ?? {} },
  );
  return res.data;
}

export async function getResultsAngularFit(
  experimentId: number,
  peakId?: number,
): Promise<AngularFitResponse> {
  const res = await api.get<AngularFitResponse>(
    `/experiments/${experimentId}/results/angular-fit`,
    { params: peakId != null ? { peak_id: peakId } : {} },
  );
  return res.data;
}

export async function exportCsv(
  experimentId: number,
  dataType: 'raw' | 'processed',
): Promise<Blob> {
  const res = await api.get(`/experiments/${experimentId}/export/csv`, {
    params: { data_type: dataType },
    responseType: 'blob',
  });
  return res.data as Blob;
}

// ---- Phase 4 advanced results ----
export async function getResultsConformation(
  experimentId: number,
  peakId?: number,
): Promise<ConformationResponse> {
  const res = await api.get<ConformationResponse>(
    `/experiments/${experimentId}/results/conformation`,
    { params: peakId != null ? { peak_id: peakId } : {} },
  );
  return res.data;
}

export async function getResultsConjugate(
  experimentId: number,
  params?: ConjugateParams,
): Promise<ConjugateResponse> {
  const res = await api.get<ConjugateResponse>(
    `/experiments/${experimentId}/results/conjugate`,
    { params: params ?? {} },
  );
  return res.data;
}

export async function getResultsBranching(
  experimentId: number,
  params?: BranchingParams,
): Promise<BranchingResponse> {
  const res = await api.get<BranchingResponse>(
    `/experiments/${experimentId}/results/branching`,
    { params: params ?? {} },
  );
  return res.data;
}

export async function getResultsViscometry(
  experimentId: number,
  peakId?: number,
): Promise<ViscometryResponse> {
  const res = await api.get<ViscometryResponse>(
    `/experiments/${experimentId}/results/viscometry`,
    { params: peakId != null ? { peak_id: peakId } : {} },
  );
  return res.data;
}

export async function getResultsCalibration(
  experimentId: number,
  peakId?: number,
  degree?: number,
): Promise<CalibrationResponse> {
  const p: Record<string, number> = {};
  if (peakId != null) p.peak_id = peakId;
  if (degree != null) p.degree = degree;
  const res = await api.get<CalibrationResponse>(
    `/experiments/${experimentId}/results/calibration`,
    { params: p },
  );
  return res.data;
}

export async function getResultsParticle(
  experimentId: number,
  params?: ParticleParams,
): Promise<ParticleResponse> {
  const res = await api.get<ParticleResponse>(
    `/experiments/${experimentId}/results/particle`,
    { params: params ?? {} },
  );
  return res.data;
}

export async function getResultsPeakStatistics(
  experimentId: number,
  params?: PeakStatisticsParams,
): Promise<PeakStatisticsListResponse> {
  const res = await api.get<PeakStatisticsListResponse>(
    `/experiments/${experimentId}/results/peak-statistics`,
    { params: params ?? {} },
  );
  return res.data;
}

export async function getResultsDnDc(
  experimentId: number,
  params?: DnDcParams,
): Promise<DnDcDeterminationResponse> {
  const res = await api.get<DnDcDeterminationResponse>(
    `/experiments/${experimentId}/results/dn-dc`,
    { params: params ?? {} },
  );
  return res.data;
}

export async function getResultsErrorAnalysis(
  experimentId: number,
  peakId?: number,
): Promise<ErrorAnalysisResponse[]> {
  const res = await api.get<ErrorAnalysisResponse[]>(
    `/experiments/${experimentId}/results/error-analysis`,
    { params: peakId != null ? { peak_id: peakId } : {} },
  );
  return res.data;
}

// ---- Phase 5: Reports ----
import type {
  ReportTemplateResponse,
  ReportTemplateListResponse,
  ReportTemplateCreate,
  ReportTemplateUpdate,
  ReportGenerateRequest,
  ReportJobResponse,
  ReportJobStatus,
} from '../types/reports';

export async function listReportTemplates(): Promise<ReportTemplateListResponse> {
  const res = await api.get<ReportTemplateListResponse>('/reports/templates');
  return res.data;
}

export async function createReportTemplate(
  body: ReportTemplateCreate,
): Promise<ReportTemplateResponse> {
  const res = await api.post<ReportTemplateResponse>('/reports/templates', body);
  return res.data;
}

export async function getReportTemplate(
  templateId: number,
): Promise<ReportTemplateResponse> {
  const res = await api.get<ReportTemplateResponse>(`/reports/templates/${templateId}`);
  return res.data;
}

export async function updateReportTemplate(
  templateId: number,
  body: ReportTemplateUpdate,
): Promise<ReportTemplateResponse> {
  const res = await api.put<ReportTemplateResponse>(`/reports/templates/${templateId}`, body);
  return res.data;
}

export async function deleteReportTemplate(
  templateId: number,
): Promise<void> {
  await api.delete(`/reports/templates/${templateId}`);
}

export async function generateReport(
  experimentId: number,
  body: ReportGenerateRequest,
): Promise<ReportJobResponse> {
  const res = await api.post<ReportJobResponse>(
    `/experiments/${experimentId}/reports/generate`,
    body,
  );
  return res.data;
}

export async function getReportStatus(
  experimentId: number,
  jobId: string,
): Promise<ReportJobStatus> {
  const res = await api.get<ReportJobStatus>(
    `/experiments/${experimentId}/reports/${jobId}/status`,
  );
  return res.data;
}

export async function downloadReport(
  experimentId: number,
  jobId: string,
): Promise<Blob> {
  const res = await api.get(
    `/experiments/${experimentId}/reports/${jobId}/download`,
    { responseType: 'blob' },
  );
  return res.data as Blob;
}

// ---- Phase 6: Method templates ----
import type {
  MethodTemplateResponse,
  MethodTemplateListResponse,
  MethodTemplateCreate,
  MethodTemplateUpdate,
  BatchApplyRequest,
  BatchJobResponse,
  BatchJobStatus,
  BatchJobListResponse,
  EasiTableCreateRequest,
  EasiTableResponse,
  EasiTableListResponse,
} from '../types/batch';

export async function listMethodTemplates(): Promise<MethodTemplateListResponse> {
  const res = await api.get<MethodTemplateListResponse>('/methods');
  return res.data;
}

export async function createMethodTemplate(
  body: MethodTemplateCreate,
): Promise<MethodTemplateResponse> {
  const res = await api.post<MethodTemplateResponse>('/methods', body);
  return res.data;
}

export async function getMethodTemplate(
  methodId: number,
): Promise<MethodTemplateResponse> {
  const res = await api.get<MethodTemplateResponse>(`/methods/${methodId}`);
  return res.data;
}

export async function updateMethodTemplate(
  methodId: number,
  body: MethodTemplateUpdate,
): Promise<MethodTemplateResponse> {
  const res = await api.put<MethodTemplateResponse>(`/methods/${methodId}`, body);
  return res.data;
}

export async function deleteMethodTemplate(
  methodId: number,
): Promise<void> {
  await api.delete(`/methods/${methodId}`);
}

export async function applyMethodTemplate(
  experimentId: number,
  methodId: number,
): Promise<{ message: string; summary: Record<string, number> }> {
  const res = await api.post(`/experiments/${experimentId}/methods/${methodId}/apply`);
  return res.data;
}

// ---- Phase 6: Batch processing ----
export async function batchApply(body: BatchApplyRequest): Promise<BatchJobResponse> {
  const res = await api.post<BatchJobResponse>('/batch/apply', body);
  return res.data;
}

export async function getBatchStatus(jobId: string): Promise<BatchJobStatus> {
  const res = await api.get<BatchJobStatus>(`/batch/${jobId}/status`);
  return res.data;
}

export async function getBatchResults(jobId: string): Promise<BatchJobStatus> {
  const res = await api.get<BatchJobStatus>(`/batch/${jobId}/results`);
  return res.data;
}

export async function listBatchJobs(): Promise<BatchJobListResponse> {
  const res = await api.get<BatchJobListResponse>('/batch');
  return res.data;
}

export async function cancelBatchJob(jobId: string): Promise<void> {
  await api.delete(`/batch/${jobId}`);
}

// ---- Phase 6: EASI tables ----
export async function createEasiTable(
  body: EasiTableCreateRequest,
): Promise<EasiTableResponse> {
  const res = await api.post<EasiTableResponse>('/easi-table', body);
  return res.data;
}

export async function getEasiTable(easiId: number): Promise<EasiTableResponse> {
  const res = await api.get<EasiTableResponse>(`/easi-table/${easiId}`);
  return res.data;
}

export async function listEasiTables(): Promise<EasiTableListResponse> {
  const res = await api.get<EasiTableListResponse>('/easi-table');
  return res.data;
}

export async function exportEasiTable(easiId: number): Promise<Blob> {
  const res = await api.get(`/easi-table/${easiId}/export`, { responseType: 'blob' });
  return res.data as Blob;
}

export async function deleteEasiTable(easiId: number): Promise<void> {
  await api.delete(`/easi-table/${easiId}`);
}

// ---- Phase 8: A2 / Zimm plot / Absorption correction / System ----
export async function getResultsA2(experimentId: number, peakId?: number): Promise<A2Response> {
  const params = peakId ? { peak_id: peakId } : {};
  const res = await api.get<A2Response>(`/experiments/${experimentId}/results/a2`, { params });
  return res.data;
}

export async function postBatchA2(experimentId: number, body: BatchA2Request): Promise<BatchA2Response> {
  const res = await api.post<BatchA2Response>(`/experiments/${experimentId}/results/a2/batch`, body);
  return res.data;
}

export async function getZimmPlot(experimentId: number, peakId?: number): Promise<ZimmPlotResponse> {
  const params = peakId ? { peak_id: peakId } : {};
  const res = await api.get<ZimmPlotResponse>(`/experiments/${experimentId}/results/zimm-plot`, { params });
  return res.data;
}

export async function postAbsorptionCorrection(
  experimentId: number,
  body: AbsorptionCorrectionRequest,
  peakId?: number,
): Promise<AbsorptionCorrectionResponse> {
  const params = peakId ? { peak_id: peakId } : {};
  const res = await api.post<AbsorptionCorrectionResponse>(
    `/experiments/${experimentId}/results/absorption-correction`,
    body,
    { params },
  );
  return res.data;
}

export async function getDbIntegrity(): Promise<{ status: string; message: string }> {
  const res = await api.get<{ status: string; message: string }>('/system/health/db');
  return res.data;
}

export async function createBackup(): Promise<BackupCreateResponse> {
  const res = await api.post<BackupCreateResponse>('/system/backup');
  return res.data;
}

export async function listBackups(): Promise<BackupListResponse> {
  const res = await api.get<BackupListResponse>('/system/backups');
  return res.data;
}

export async function cleanupBackups(retentionDays = 30): Promise<{ deleted_count: number }> {
  const res = await api.delete<{ deleted_count: number }>(`/system/backups/cleanup`, {
    params: { retention_days: retentionDays },
  });
  return res.data;
}