// ============================================================
// Phase 6 types: batch, method templates, EASI tables
// (matching backend app/schemas/schemas.py Phase 6)
// ============================================================

export interface MethodTemplateResponse {
  id: number;
  name: string;
  description: string | null;
  template: string | null;
  is_public: boolean;
  shared_with: string | null;
  created_by: number | null;
  created_at: string | null;
}

export interface MethodTemplateListResponse {
  methods: MethodTemplateResponse[];
  total: number;
}

export interface MethodTemplateCreate {
  name: string;
  description?: string;
  template?: string;
  is_public?: boolean;
}

export interface MethodTemplateUpdate {
  name?: string;
  description?: string;
  template?: string;
  is_public?: boolean;
}

export type SettingToPropagate = 'baselines' | 'peaks' | 'peak_params' | 'procedures';

export interface BatchApplyRequest {
  source_experiment_id: number;
  target_experiment_ids: number[];
  settings_to_propagate: SettingToPropagate[];
}

export interface BatchJobResponse {
  job_id: string;
  status: string;
  source_experiment_id: number;
  target_count: number;
}

export interface BatchTargetResult {
  experiment_id: number;
  status: string;
  summary?: Record<string, number>;
  error?: string;
}

export interface BatchJobStatus {
  job_id: string;
  source_experiment_id: number;
  status: string;
  progress: number;
  message: string | null;
  error: string | null;
  target_results: BatchTargetResult[] | null;
}

export interface BatchJobListResponse {
  jobs: BatchJobStatus[];
  total: number;
}

export interface EasiTableCreateRequest {
  name: string;
  experiment_ids: number[];
  column_config?: string;
}

export interface EasiTableRow {
  experiment_id?: number;
  sample_name?: string;
  peak_number?: number;
  Mn?: number | null;
  Mw?: number | null;
  Mz?: number | null;
  Pd?: number | null;
  Rg_nm?: number | null;
  peak_area?: number | null;
  recovery?: number | null;
  error?: string;
  [key: string]: unknown;
}

export interface EasiTableResponse {
  id: number;
  name: string;
  experiment_ids: number[];
  columns: string[];
  rows: EasiTableRow[];
  created_at: string | null;
}

export interface EasiTableListResponse {
  tables: EasiTableResponse[];
  total: number;
}