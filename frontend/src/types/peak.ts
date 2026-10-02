// ============================================================
// Peak types (matching backend app/schemas/schemas.py)
// ============================================================

export type LSModel = 0 | 1 | 2;

export interface PeakResponse {
  id: number;
  range_number: number | null;
  range_name: string | null;
  range_start: number | null;
  range_end: number | null;
  dn_dc: number | null;
  uv_extinction: number | null;
  concentration: number | null;
  injected_mass: number | null;
  real_ri: number | null;
  ls_model: number | null;
  ls_fit_degree: number | null;
  radius_type: number | null;
  a2: number | null;
  mn: number | null;
  mw: number | null;
  mz: number | null;
  polydispersity: number | null;
  rms_radius: number | null;
  peak_area: number | null;
  recovery: number | null;
  is_auto: boolean | null;
  version: number;
  created_at: string | null;
  warnings: string[];
}

export interface PeakCreate {
  range_start: number;
  range_end: number;
  range_number?: number | null;
  range_name?: string | null;
  dn_dc?: number | null;
  uv_extinction?: number | null;
  concentration?: number | null;
  injected_mass?: number | null;
  real_ri?: number | null;
  ls_model?: number | null;
  ls_fit_degree?: number | null;
  radius_type?: number | null;
  a2?: number | null;
  is_auto?: boolean;
}

export interface PeakUpdate {
  range_start?: number;
  range_end?: number;
  range_number?: number | null;
  range_name?: string | null;
  dn_dc?: number | null;
  uv_extinction?: number | null;
  concentration?: number | null;
  injected_mass?: number | null;
  real_ri?: number | null;
  ls_model?: number | null;
  ls_fit_degree?: number | null;
  radius_type?: number | null;
  a2?: number | null;
  is_auto?: boolean | null;
}

export interface PeakListResponse {
  peaks: PeakResponse[];
  total: number;
}

export interface AutoPeakRequest {
  detector?: string | null;
  threshold?: number | null;
  baseline_percent?: number;
  min_peak_width?: number;
}

export interface AutoPeakResponse {
  peaks: PeakResponse[];
  message: string;
}

export interface DnDcLibraryEntry {
  polymer: string;
  solvent: string;
  dn_dc: number;
  source: string;
  notes: string;
}

export interface DnDcLibraryResponse {
  entries: DnDcLibraryEntry[];
  total: number;
}