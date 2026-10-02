import { create } from 'zustand';
import type {
  ExperimentSummary,
  ExperimentDetail,
} from '../types/experiment';
import type {
  ChromatogramResponse,
  DetectorDescriptor,
} from '../types/chromatogram';
import * as api from '../api/endpoints';

interface DetectorSelectionState {
  malsAngles: Set<number>;
  ri: boolean;
  uvWavelengths: Set<number>;
}

interface ExperimentStore {
  // ---- Experiment list ----
  experiments: ExperimentSummary[];
  totalExperiments: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  searchQuery: string;
  listLoading: boolean;
  listError: string | null;

  // ---- Current experiment ----
  currentExperimentId: number | null;
  experimentDetail: ExperimentDetail | null;
  detailLoading: boolean;
  detailError: string | null;

  // ---- Chromatogram ----
  chromatogram: ChromatogramResponse | null;
  chromatogramBaselineSubtracted: ChromatogramResponse | null;
  chromatogramLoading: boolean;
  chromatogramError: string | null;

  // ---- Detectors ----
  detectorDescriptors: DetectorDescriptor[];
  detectorSelection: DetectorSelectionState;

  // ---- Unsaved changes ----
  isDirty: boolean;
  lastSavedAt: string | null;

  // ---- Actions ----
  fetchExperiments: (page?: number) => Promise<void>;
  setSearchQuery: (q: string) => void;
  searchExperiments: () => Promise<void>;
  setPage: (page: number) => Promise<void>;

  selectExperiment: (id: number) => Promise<void>;
  loadExperimentData: (id: number) => Promise<void>;
  deleteExperiment: (id: number) => Promise<void>;
  updateSampleConfig: (fields: api.SampleUpdate) => Promise<void>;

  setDetectorDescriptors: (descs: DetectorDescriptor[]) => void;
  toggleMalsAngle: (index: number) => void;
  toggleRI: () => void;
  toggleUVWavelength: (index: number) => void;
  setMalsGroup: (on: boolean) => void;
  setUVGroup: (on: boolean) => void;
  selectAllDetectors: () => void;
  deselectAllDetectors: () => void;

  fetchBaselineSubtractedChromatogram: (id: number) => Promise<void>;
  clearBaselineSubtractedChromatogram: () => void;

  markDirty: () => void;
  markClean: () => void;
}

export const useExperimentStore = create<ExperimentStore>((set, get) => ({
  // ---- State ----
  experiments: [],
  totalExperiments: 0,
  currentPage: 1,
  totalPages: 1,
  pageSize: 20,
  searchQuery: '',
  listLoading: false,
  listError: null,

  currentExperimentId: null,
  experimentDetail: null,
  detailLoading: false,
  detailError: null,

  chromatogram: null,
  chromatogramBaselineSubtracted: null,
  chromatogramLoading: false,
  chromatogramError: null,

  detectorDescriptors: [],
  detectorSelection: {
    malsAngles: new Set(),
    ri: true,
    uvWavelengths: new Set(),
  },

  isDirty: false,
  lastSavedAt: null,

  // ---- Actions ----
  fetchExperiments: async (page?: number) => {
    const state = get();
    const targetPage = page ?? state.currentPage;
    set({ listLoading: true, listError: null });
    try {
      const res = await api.listExperiments({
        page: targetPage,
        limit: state.pageSize,
        sample_name: state.searchQuery,
      });
      set({
        experiments: res.items,
        totalExperiments: res.total,
        currentPage: res.page,
        totalPages: res.pages,
        listLoading: false,
      });
    } catch (err) {
      set({
        listLoading: false,
        listError: err instanceof Error ? err.message : 'Failed to load experiments',
      });
    }
  },

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  searchExperiments: async () => {
    set({ currentPage: 1 });
    await get().fetchExperiments(1);
  },

  setPage: async (page: number) => {
    await get().fetchExperiments(page);
  },

  selectExperiment: async (id: number) => {
    set({
      currentExperimentId: id,
      experimentDetail: null,
      chromatogram: null,
      chromatogramBaselineSubtracted: null,
      detailLoading: true,
      chromatogramLoading: true,
      detailError: null,
      chromatogramError: null,
      isDirty: false,
    });
    // Load detail and chromatogram in parallel
    get().loadExperimentData(id);
  },

  loadExperimentData: async (id: number) => {
    // Detail
    try {
      const detail = await api.getExperiment(id);
      set({ experimentDetail: detail, detailLoading: false });
    } catch (err) {
      set({
        detailLoading: false,
        detailError: err instanceof Error ? err.message : 'Failed to load experiment',
      });
    }
    // Chromatogram
    try {
      const chrom = await api.getChromatogram(id);
      set({ chromatogram: chrom, chromatogramLoading: false });
      // Build detector descriptors from chromatogram data
      const descs: DetectorDescriptor[] = [];
      if (chrom.detectors.MALS) {
        descs.push({
          type: 'MALS',
          name: chrom.detectors.MALS.name,
          subChannels: chrom.detectors.MALS.angles.map((a, i) => ({
            label: `${a}°`,
            index: i,
          })),
        });
      }
      if (chrom.detectors.RI) {
        descs.push({
          type: 'RI',
          name: chrom.detectors.RI.name,
        });
      }
      if (chrom.detectors.UV) {
        descs.push({
          type: 'UV',
          name: chrom.detectors.UV.name,
          subChannels: chrom.detectors.UV.wavelengths.map((w, i) => ({
            label: `${w}nm`,
            index: i,
          })),
        });
      }
      // Initialize selection: select all by default
      set({
        detectorDescriptors: descs,
        detectorSelection: {
          malsAngles: new Set(
            chrom.detectors.MALS?.angles.map((_, i) => i) ?? [],
          ),
          ri: true,
          uvWavelengths: new Set(
            chrom.detectors.UV?.wavelengths.map((_, i) => i) ?? [],
          ),
        },
      });
    } catch (err) {
      set({
        chromatogramLoading: false,
        chromatogramError: err instanceof Error ? err.message : 'Failed to load chromatogram',
      });
    }
  },

  updateSampleConfig: async (fields: api.SampleUpdate) => {
    const id = get().currentExperimentId;
    if (id == null) return;
    const res = await api.updateSample(id, fields);
    const detail = get().experimentDetail;
    if (detail) {
      set({
        experimentDetail: { ...detail, sample_config: res.sample_config },
        isDirty: false,
      });
    }
  },

  deleteExperiment: async (id: number) => {
    try {
      await api.deleteExperiment(id);
      // If we just deleted the currently selected one, clear it
      if (get().currentExperimentId === id) {
        set({
          currentExperimentId: null,
          experimentDetail: null,
          chromatogram: null,
          chromatogramBaselineSubtracted: null,
        });
      }
      // Refresh the list
      await get().fetchExperiments();
    } catch (err) {
      set({
        listError: err instanceof Error ? err.message : 'Failed to delete experiment',
      });
    }
  },

  setDetectorDescriptors: (descs: DetectorDescriptor[]) => {
    set({ detectorDescriptors: descs });
  },

  toggleMalsAngle: (index: number) => {
    const sel = { ...get().detectorSelection };
    const next = new Set(sel.malsAngles);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    set({ detectorSelection: { ...sel, malsAngles: next } });
  },

  toggleRI: () => {
    const sel = { ...get().detectorSelection };
    set({ detectorSelection: { ...sel, ri: !sel.ri } });
  },

  toggleUVWavelength: (index: number) => {
    const sel = { ...get().detectorSelection };
    const next = new Set(sel.uvWavelengths);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    set({ detectorSelection: { ...sel, uvWavelengths: next } });
  },

  setMalsGroup: (on: boolean) => {
    const sel = { ...get().detectorSelection };
    const mals = get().detectorDescriptors.find((d) => d.type === 'MALS');
    const all = mals?.subChannels?.map((s) => s.index) ?? [];
    set({
      detectorSelection: {
        ...sel,
        malsAngles: new Set(on ? all : []),
      },
    });
  },

  setUVGroup: (on: boolean) => {
    const sel = { ...get().detectorSelection };
    const uv = get().detectorDescriptors.find((d) => d.type === 'UV');
    const all = uv?.subChannels?.map((s) => s.index) ?? [];
    set({
      detectorSelection: {
        ...sel,
        uvWavelengths: new Set(on ? all : []),
      },
    });
  },

  selectAllDetectors: () => {
    const descs = get().detectorDescriptors;
    const mals = descs.find((d) => d.type === 'MALS');
    const uv = descs.find((d) => d.type === 'UV');
    set({
      detectorSelection: {
        malsAngles: new Set(mals?.subChannels?.map((s) => s.index) ?? []),
        ri: true,
        uvWavelengths: new Set(uv?.subChannels?.map((s) => s.index) ?? []),
      },
    });
  },

  deselectAllDetectors: () => {
    set({
      detectorSelection: {
        malsAngles: new Set(),
        ri: false,
        uvWavelengths: new Set(),
      },
    });
  },

  fetchBaselineSubtractedChromatogram: async (id: number) => {
    try {
      const chrom = await api.getChromatogram(id, true);
      set({ chromatogramBaselineSubtracted: chrom });
    } catch (err) {
      set({
        chromatogramBaselineSubtracted: null,
        chromatogramError: err instanceof Error ? err.message : 'Failed to load baseline-subtracted chromatogram',
      });
    }
  },

  clearBaselineSubtractedChromatogram: () => {
    set({ chromatogramBaselineSubtracted: null });
  },

  markDirty: () => {
    set({ isDirty: true });
  },

  markClean: () => {
    set({ isDirty: false, lastSavedAt: new Date().toISOString() });
  },
}));