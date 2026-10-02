// ============================================================
// Chromatogram data types
// ============================================================

export interface MALSData {
  name: string;
  angles: number[];
  data: number[][]; // [time_index][angle_index]
  time?: number[]; // this detector's own time axis (minutes)
  instrument_class: string | null;
}

export interface RIData {
  name: string;
  data: number[];
  time?: number[]; // this detector's own time axis (minutes)
  instrument_class: string | null;
}

export interface UVData {
  name: string;
  wavelengths: number[];
  data: number[][]; // [time_index][channel_index]
  time?: number[]; // this detector's own time axis (minutes)
  instrument_class: string | null;
}

export interface ChromatogramResponse {
  time: number[];
  detectors: {
    MALS?: MALSData;
    RI?: RIData;
    UV?: UVData;
  };
  downsampled: boolean;
  downsample_factor: number | null;
  point_count: number | null;
  baseline_subtracted?: boolean;
}

// Selector state: which detectors/angles/wavelengths to display
export interface DetectorSelection {
  malsAngles: Set<number>; // selected angle indices
  ri: boolean;
  uvWavelengths: Set<number>; // selected wavelength indices
}

// Descriptor of all available detectors for an experiment
export interface DetectorDescriptor {
  type: 'MALS' | 'RI' | 'UV';
  name: string;
  subChannels?: { label: string; index: number }[];
}

export interface DetectorListResponse {
  detectors: DetectorDescriptor[];
}