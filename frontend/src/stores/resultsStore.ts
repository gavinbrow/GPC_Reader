import { create } from 'zustand';
import type {
  ResultsResponse,
  PeakResultsResponse,
  MolarMassResponse,
  RadiusResponse,
  DistributionResponse,
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
  AbsorptionCorrectionResponse,
  BackupListResponse,
  BackupCreateResponse,
} from '../types/results';
import * as api from '../api/endpoints';

interface ResultsStore {
  results: ResultsResponse | null;
  moments: PeakResultsResponse[] | null;
  molarMass: MolarMassResponse | null;
  radius: RadiusResponse | null;
  distributions: DistributionResponse[] | null;
  angularFit: AngularFitResponse | null;
  conformation: ConformationResponse | null;
  conjugate: ConjugateResponse | null;
  branching: BranchingResponse | null;
  viscometry: ViscometryResponse | null;
  calibration: CalibrationResponse | null;
  particle: ParticleResponse | null;
  peakStatistics: PeakStatisticsListResponse | null;
  dnDc: DnDcDeterminationResponse | null;
  errorAnalysis: ErrorAnalysisResponse[] | null;
  a2: A2Response | null;
  zimmPlot: ZimmPlotResponse | null;
  absorptionCorrection: AbsorptionCorrectionResponse | null;
  backups: BackupListResponse | null;
  backupResult: BackupCreateResponse | null;
  loading: boolean;
  error: string | null;

  fetchResults: (experimentId: number) => Promise<void>;
  fetchMoments: (experimentId: number) => Promise<void>;
  fetchMolarMass: (experimentId: number, peakId?: number) => Promise<void>;
  fetchRadius: (experimentId: number, peakId?: number) => Promise<void>;
  fetchDistributions: (
    experimentId: number,
    params?: DistributionParams,
  ) => Promise<void>;
  fetchAngularFit: (experimentId: number, peakId?: number) => Promise<void>;
  fetchConformation: (experimentId: number, peakId?: number) => Promise<void>;
  fetchConjugate: (experimentId: number, params?: ConjugateParams) => Promise<void>;
  fetchBranching: (experimentId: number, params?: BranchingParams) => Promise<void>;
  fetchViscometry: (experimentId: number, peakId?: number) => Promise<void>;
  fetchCalibration: (experimentId: number, peakId?: number, degree?: number) => Promise<void>;
  fetchParticle: (experimentId: number, params?: ParticleParams) => Promise<void>;
  fetchPeakStatistics: (experimentId: number, params?: PeakStatisticsParams) => Promise<void>;
  fetchDnDc: (experimentId: number, params?: DnDcParams) => Promise<void>;
  fetchErrorAnalysis: (experimentId: number, peakId?: number) => Promise<void>;
  fetchA2: (experimentId: number, peakId?: number) => Promise<void>;
  fetchZimmPlot: (experimentId: number, peakId?: number) => Promise<void>;
  fetchAbsorptionCorrection: (experimentId: number, body: import('../types/results').AbsorptionCorrectionRequest, peakId?: number) => Promise<void>;
  fetchBackups: () => Promise<void>;
  createBackup: () => Promise<void>;
  clear: () => void;
}

export const useResultsStore = create<ResultsStore>((set) => ({
  results: null,
  moments: null,
  molarMass: null,
  radius: null,
  distributions: null,
  angularFit: null,
  conformation: null,
  conjugate: null,
  branching: null,
  viscometry: null,
  calibration: null,
  particle: null,
  peakStatistics: null,
  dnDc: null,
  errorAnalysis: null,
  a2: null,
  zimmPlot: null,
  absorptionCorrection: null,
  backups: null,
  backupResult: null,
  loading: false,
  error: null,

  fetchResults: async (experimentId: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResults(experimentId);
      set({ results: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load results',
      });
    }
  },

  fetchMoments: async (experimentId: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsMoments(experimentId);
      set({ moments: res.peaks, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load moments',
      });
    }
  },

  fetchMolarMass: async (experimentId: number, peakId?: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsMolarMass(experimentId, peakId);
      set({ molarMass: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load molar mass',
      });
    }
  },

  fetchRadius: async (experimentId: number, peakId?: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsRadius(experimentId, peakId);
      set({ radius: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load radius',
      });
    }
  },

  fetchDistributions: async (
    experimentId: number,
    params?: DistributionParams,
  ) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsDistributions(experimentId, params);
      set({ distributions: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load distributions',
      });
    }
  },

  fetchAngularFit: async (experimentId: number, peakId?: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsAngularFit(experimentId, peakId);
      set({ angularFit: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load angular fit',
      });
    }
  },

  fetchConformation: async (experimentId: number, peakId?: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsConformation(experimentId, peakId);
      set({ conformation: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load conformation',
      });
    }
  },

  fetchConjugate: async (experimentId: number, params?: ConjugateParams) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsConjugate(experimentId, params);
      set({ conjugate: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load conjugate',
      });
    }
  },

  fetchBranching: async (experimentId: number, params?: BranchingParams) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsBranching(experimentId, params);
      set({ branching: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load branching',
      });
    }
  },

  fetchViscometry: async (experimentId: number, peakId?: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsViscometry(experimentId, peakId);
      set({ viscometry: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load viscometry',
      });
    }
  },

  fetchCalibration: async (
    experimentId: number,
    peakId?: number,
    degree?: number,
  ) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsCalibration(experimentId, peakId, degree);
      set({ calibration: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load calibration',
      });
    }
  },

  fetchParticle: async (experimentId: number, params?: ParticleParams) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsParticle(experimentId, params);
      set({ particle: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load particle',
      });
    }
  },

  fetchPeakStatistics: async (
    experimentId: number,
    params?: PeakStatisticsParams,
  ) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsPeakStatistics(experimentId, params);
      set({ peakStatistics: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load peak statistics',
      });
    }
  },

  fetchDnDc: async (experimentId: number, params?: DnDcParams) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsDnDc(experimentId, params);
      set({ dnDc: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load dn/dc',
      });
    }
  },

  fetchErrorAnalysis: async (experimentId: number, peakId?: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsErrorAnalysis(experimentId, peakId);
      set({ errorAnalysis: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load error analysis',
      });
    }
  },

  fetchA2: async (experimentId: number, peakId?: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getResultsA2(experimentId, peakId);
      set({ a2: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load A2',
      });
    }
  },

  fetchZimmPlot: async (experimentId: number, peakId?: number) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getZimmPlot(experimentId, peakId);
      set({ zimmPlot: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load Zimm plot',
      });
    }
  },

  fetchAbsorptionCorrection: async (
    experimentId: number,
    body: import('../types/results').AbsorptionCorrectionRequest,
    peakId?: number,
  ) => {
    set({ loading: true, error: null });
    try {
      const res = await api.postAbsorptionCorrection(experimentId, body, peakId);
      set({ absorptionCorrection: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to run absorption correction',
      });
    }
  },

  fetchBackups: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.listBackups();
      set({ backups: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load backups',
      });
    }
  },

  createBackup: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.createBackup();
      set({ backupResult: res, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to create backup',
      });
    }
  },

  clear: () =>
    set({
      results: null,
      moments: null,
      molarMass: null,
      radius: null,
      distributions: null,
      angularFit: null,
      conformation: null,
      conjugate: null,
      branching: null,
      viscometry: null,
      calibration: null,
      particle: null,
      peakStatistics: null,
      dnDc: null,
      errorAnalysis: null,
      a2: null,
      zimmPlot: null,
      absorptionCorrection: null,
      backups: null,
      backupResult: null,
      loading: false,
      error: null,
    }),
}));