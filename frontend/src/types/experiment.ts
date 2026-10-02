// ============================================================
// Experiment metadata types
// ============================================================

export interface ExperimentSummary {
  id: number;
  file_name: string;
  sample_name: string | null;
  solvent_name: string | null;
  operator_name: string | null;
  collection_time: string | null;
  processing_time: string | null;
  astra_version: string | null;
  file_size: number | null;
  file_hash: string | null;
  created_at: string | null;
  updated_at: string | null;
  version: number;
}

// ---- JSON config shapes (returned by the detail endpoint) ----

export interface MALSConfig {
  name: string;
  description: string | null;
  temperature: number | null;
  wavelength: number | null;
  num_detectors: number | null;
  calibration_constant: number | null;
  detector_angles: number[];
  normalization_coefficients: number[];
  instrumental_term: number | null;
  mixing_term: number | null;
  firmware_version: string | null;
}

export interface RIConfig {
  name: string;
  temperature: number | null;
  wavelength: number | null;
  calibration_constant: number | null;
}

export interface UVConfig {
  name: string;
  description: string | null;
  cell_length: number | null;
  active_channel: number | null;
  wavelengths: number[];
}

export interface ViscometerConfig {
  name: string;
  temperature: number | null;
  dilution_factor: number | null;
  use_specific_viscosity: boolean;
  enable_dilution_correction: boolean;
}

export interface SampleConfig {
  name: string;
  description: string | null;
  dn_dc: number;
  a2: number;
  wavelength: number;
  uv_extinction_coefficient: number;
  concentration: number;
  reference_temperature: number;
  real_ri: number;
  imaginary_ri: number;
  mhs_k: number;
  mhs_a: number;
  primary_uv_wavelength: number;
  secondary_uv_wavelength: number;
}

export interface FluidConnection {
  name: string;
  description: string | null;
  source_instrument: string;
  destination_instrument: string;
  interdetector_volume: number;
  temperature: number;
}

export interface PeakInfo {
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
  ls_model: string | null;
  ls_fit_degree: number | null;
  radius_type: string | null;
  a2: number | null;
  mn: number | null;
  mw: number | null;
  mz: number | null;
  polydispersity: number | null;
  rms_radius: number | null;
  peak_area: number | null;
  recovery: number | null;
  is_auto: boolean | null;
}

export interface ExperimentDetail {
  id: number;
  file_name: string;
  original_path: string | null;
  file_size: number | null;
  file_hash: string | null;
  sample_name: string | null;
  solvent_name: string | null;
  solvent_description: string | null;
  operator_name: string | null;
  collection_time: string | null;
  processing_time: string | null;
  astra_version: string | null;
  mals_config: MALSConfig | null;
  ri_config: RIConfig | null;
  uv_config: UVConfig | null;
  viscometer_config: ViscometerConfig | null;
  sample_config: SampleConfig | null;
  fluid_path: FluidConnection[] | null;
  peaks: PeakInfo[];
  raw_data_path: string | null;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
  version: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ExperimentListParams {
  page?: number;
  limit?: number;
  sample_name?: string;
  date_from?: string;
  date_to?: string;
}