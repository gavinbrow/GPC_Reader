// ============================================================
// Procedure chain types (matching backend app/schemas/schemas.py)
// ============================================================

import type { PeakResponse } from './peak';

export interface ProcedureStateResponse {
  id: number;
  experiment_id: number;
  procedure_name: string | null;
  procedure_order: number | null;
  is_enabled: boolean;
  has_been_run: boolean;
  parameters: Record<string, unknown> | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProcedureListResponse {
  procedures: ProcedureStateResponse[];
  total: number;
}

export interface ProcedureUpdateRequest {
  is_enabled?: boolean;
  parameters?: Record<string, unknown> | null;
}

export interface ProcedureRunRequest {
  peak_id?: number | null;
}

export interface AutoAnalyzeResponse {
  experiment_id: number;
  peaks: PeakResponse[];
  procedure_states: ProcedureStateResponse[];
  message: string;
}

export interface AsyncJobResponse {
  job_id: string;
  status: string;
  experiment_id: number;
}

export const PROCEDURE_NAMES = [
  'despiking',
  'baseline',
  'alignment',
  'normalization',
  'physical_units',
  'concentration',
  'molar_mass',
  'moments',
  'peak_areas',
  'distributions',
  'band_broadening',
] as const;

export type ProcedureName = (typeof PROCEDURE_NAMES)[number];

export const PROCEDURE_LABELS: Record<ProcedureName, string> = {
  despiking: 'Despiking',
  baseline: 'Baseline Subtraction',
  alignment: 'Interdetector Alignment',
  normalization: 'MALS Normalization',
  physical_units: 'Physical Units Conversion',
  concentration: 'Concentration Conversion',
  molar_mass: 'Molar Mass Fit',
  moments: 'Moments Calculation',
  peak_areas: 'Peak Areas',
  distributions: 'Distributions',
  band_broadening: 'Band Broadening Correction',
};