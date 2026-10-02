// ============================================================
// Report types (matching backend app/schemas/schemas.py Phase 5)
// ============================================================

export interface ReportTemplateResponse {
  id: number;
  name: string;
  template_config: string | null;
  is_default: boolean;
  created_at: string | null;
}

export interface ReportTemplateListResponse {
  templates: ReportTemplateResponse[];
  total: number;
}

export interface ReportTemplateCreate {
  name: string;
  template_config?: string;
  is_default?: boolean;
}

export interface ReportTemplateUpdate {
  name?: string;
  template_config?: string;
  is_default?: boolean;
}

export type ReportFormat = 'pdf' | 'html' | 'csv' | 'xlsx';

export interface ReportGenerateRequest {
  format: ReportFormat;
  title?: string;
  notes?: string;
  include_slice_data?: boolean;
  template_id?: number;
}

export interface ReportJobResponse {
  job_id: string;
  status: string;
  experiment_id: number;
}

export interface ReportJobStatus {
  job_id: string;
  experiment_id: number;
  status: string;
  format: string | null;
  progress: number;
  message: string | null;
  error: string | null;
  file_path: string | null;
  file_size: number | null;
}