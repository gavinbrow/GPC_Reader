// ============================================================
// Analysis results types (matching backend app/schemas/schemas.py)
// ============================================================

export interface PeakResultsResponse {
  peak_id: number;
  range_number: number | null;
  range_name: string | null;
  range_start: number | null;
  range_end: number | null;
  mn: number | null;
  mw: number | null;
  mz: number | null;
  polydispersity: number | null;
  rms_radius: number | null;
  peak_area: number | null;
  recovery: number | null;
  version: number;
}

export interface MomentsResponse {
  peaks: PeakResultsResponse[];
  total: number;
}

export interface MolarMassSliceResponse {
  peak_id: number;
  time: (number | null)[];
  molar_mass: (number | null)[];
  concentration: (number | null)[];
  fit_model: string | null;
  fit_degree: number | null;
}

export interface AngularFitSliceResponse {
  peak_id: number;
  time: (number | null)[];
  chi2: (number | null)[];
  n_angles_used: (number | null)[];
  fit_model: string | null;
  fit_degree: number | null;
}

export interface AngularFitResponse {
  peaks: AngularFitSliceResponse[];
  total: number;
}

export interface MolarMassResponse {
  peaks: MolarMassSliceResponse[];
  total: number;
}

export interface RadiusSliceResponse {
  peak_id: number;
  time: (number | null)[];
  radius: (number | null)[];
  concentration: (number | null)[];
}

export interface RadiusResponse {
  peaks: RadiusSliceResponse[];
  total: number;
}

export interface DistributionResponse {
  peak_id: number;
  bin_centers: (number | null)[];
  weights: (number | null)[];
  bin_edges: (number | null)[];
  distribution_type: string;
  n_bins: number;
  cumulative: (number | null)[];
  bandwidth: number | null;
  kernel: string | null;
  method: string | null;
}

export interface ResultsResponse {
  experiment_id: number;
  peaks: PeakResultsResponse[];
  has_slice_data: boolean;
  message: string;
}

export interface DistributionParams {
  type?: 'diff' | 'cum';
  bins?: 'auto' | number;
  smoothing?: number;
  bandwidth?: number;
  kernel?: string;
  range_min?: number;
  range_max?: number;
}

// ============================================================
// Phase 4 advanced analysis types
// (matching backend app/schemas/schemas.py Phase 4 section)
// ============================================================

export interface ConformationSliceResponse {
  peak_id: number;
  log_m: (number | null)[];
  log_rg: (number | null)[];
  slope: number | null;
  intercept: number | null;
  r_squared: number | null;
  n_points: number | null;
  conformation_class: string | null;
}

export interface ConformationResponse {
  peaks: ConformationSliceResponse[];
  total: number;
}

export interface ConjugateSliceResponse {
  peak_id: number;
  time: (number | null)[];
  total_molar_mass: (number | null)[];
  protein_fraction: (number | null)[];
  modifier_fraction: (number | null)[];
  protein_molar_mass: (number | null)[];
  modifier_molar_mass: (number | null)[];
}

export interface ConjugateResponse {
  peaks: ConjugateSliceResponse[];
  total: number;
}

export interface BranchingSliceResponse {
  peak_id: number;
  molar_mass: (number | null)[];
  branching_ratio_g: (number | null)[];
  branch_units_per_molecule: (number | null)[];
  long_chain_branch_freq: (number | null)[];
  branching_type: string | null;
}

export interface BranchingResponse {
  peaks: BranchingSliceResponse[];
  total: number;
}

export interface ViscometrySliceResponse {
  peak_id: number;
  time: (number | null)[];
  intrinsic_viscosity: (number | null)[];
  specific_viscosity: (number | null)[];
  hydrodynamic_radius: (number | null)[];
  universal_molar_mass: (number | null)[];
}

export interface ViscometryResponse {
  peaks: ViscometrySliceResponse[];
  total: number;
  mhs_K: number | null;
  mhs_a: number | null;
  mhs_r_squared: number | null;
}

export interface CalibrationResponse {
  elution_volume: (number | null)[];
  log_m: (number | null)[];
  fit_log_m: (number | null)[];
  coefficients: (number | null)[];
  r_squared: number | null;
  calibration_type: string | null;
}

export interface ParticleSliceResponse {
  peak_id: number;
  molar_mass: (number | null)[];
  geometric_radius: (number | null)[];
  number_density: (number | null)[];
  number_fraction: (number | null)[];
  total_count: number | null;
}

export interface ParticleResponse {
  peaks: ParticleSliceResponse[];
  total: number;
}

export interface PeakStatisticsResponse {
  peak_id: number;
  retention_time: number | null;
  peak_max: number | null;
  width_baseline: number | null;
  width_half_height: number | null;
  asymmetry_factor: number | null;
  tailing_factor: number | null;
  plate_count: number | null;
  resolution: number | null;
}

export interface PeakStatisticsListResponse {
  peaks: PeakStatisticsResponse[];
  total: number;
}

export interface DnDcDeterminationResponse {
  dn_dc_value: number | null;
  method: string | null;
  message: string | null;
}

export interface ErrorAnalysisResponse {
  peak_id: number;
  molar_mass_uncertainty: (number | null)[];
  concentration_uncertainty: (number | null)[];
  snr: number | null;
  reduced_chi2: number | null;
  r_squared: number | null;
}

export interface ConjugateParams {
  peak_id?: number;
  dn_dc_protein?: number;
  dn_dc_modifier?: number;
  uv_ext_protein?: number;
  uv_ext_modifier?: number;
  cell_length?: number;
}

export interface BranchingParams {
  peak_id?: number;
  branching_type?: 'tri' | 'tetra' | 'star' | 'comb';
  linear_reference_m?: string;
  linear_reference_rg?: string;
}

export interface ParticleParams {
  peak_id?: number;
  sample_ri?: number;
  solvent_ri?: number;
}

export interface PeakStatisticsParams {
  peak_id?: number;
  detector?: 'RI' | 'MALS' | 'UV';
}

export interface DnDcParams {
  method?: 'concentration' | 'calibration';
  ri_area?: number;
  flow_rate?: number;
  injected_mass?: number;
  ri_calibration_constant?: number;
}

// ---------------------------------------------------------------------------
// Phase 8 — A2 / Zimm plot / Absorption correction
// ---------------------------------------------------------------------------
export interface A2Response {
  a2: number | null;
  mw: number | null;
  rg: number | null;
  n_points: number;
  r_squared: number | null;
  fit_quality: string | null;
  method: string | null;
}

export interface ZimmPlotResponse {
  x: number[];
  y: number[];
  angles: number[];
  concentrations: number[];
  k_scale: number;
  a2: number | null;
  mw: number | null;
  rg: number | null;
}

export interface BatchA2Request {
  concentrations: number[];
  rayleigh_ratio_zero: number[];
  optical_constant: number;
}

export interface BatchA2Response {
  a2: number | null;
  mw: number | null;
  slope: number | null;
  intercept: number | null;
  r_squared: number | null;
  n_points: number;
}

export interface AbsorptionCorrectionRequest {
  forward_monitor: number[];
  time_axis: number[];
  peak_start: number;
  peak_end: number;
  baseline_pct?: number;
}

export interface AbsorptionCorrectionResponse {
  corrected_molar_mass: (number | null)[];
  transmittance: (number | null)[];
  correction_factor_mean: number | null;
  absorption_detected: boolean;
  message: string | null;
}

export interface BackupInfo {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: string;
}

export interface BackupListResponse {
  backups: BackupInfo[];
  total: number;
}

export interface BackupCreateResponse {
  path: string;
  size_bytes: number;
  created_at: string;
}