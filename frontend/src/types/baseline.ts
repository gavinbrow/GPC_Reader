// ============================================================
// Baseline types (matching backend app/schemas/schemas.py)
// ============================================================

export type BaselineType = 0 | 1 | 2;

export interface BaselineResponse {
  id: number;
  experiment_id: number;
  detector_name: string | null;
  detector_class: string | null;
  baseline_type: BaselineType | null;
  x1: number | null;
  x2: number | null;
  y1: number | null;
  y2: number | null;
  slope: number | null;
  intercept: number | null;
  std_dev: number | null;
  is_auto: boolean | null;
  version: number;
  created_at: string | null;
}

export interface BaselineCreate {
  detector_name: string;
  detector_class: string | null;
  baseline_type: BaselineType;
  x1: number | null;
  x2: number | null;
  y1: number | null;
  y2: number | null;
  is_auto: boolean;
}

export interface BaselineUpdate {
  baseline_type?: BaselineType;
  x1?: number | null;
  x2?: number | null;
  y1?: number | null;
  y2?: number | null;
  is_auto?: boolean;
}

export interface BaselineListResponse {
  baselines: BaselineResponse[];
  total: number;
}

export interface AutoBaselineRequest {
  width_std_dev?: number;
  num_passes?: number;
}

export interface AutoBaselineResponse {
  baselines: BaselineResponse[];
  message: string;
}