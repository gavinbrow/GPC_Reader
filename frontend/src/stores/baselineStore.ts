import { create } from 'zustand';
import type {
  BaselineResponse,
  BaselineCreate,
  AutoBaselineRequest,
} from '../types/baseline';
import * as api from '../api/endpoints';
import { useExperimentStore } from './experimentStore';

interface BaselineStore {
  baselines: BaselineResponse[];
  loading: boolean;
  error: string | null;
  baselineSubtractedPreview: boolean;
  selectedBaselineDetector: string | null;
  versionConflict: { detector: string; message: string } | null;

  fetchBaselines: (experimentId: number) => Promise<void>;
  upsertBaseline: (
    experimentId: number,
    detector: string,
    body: BaselineCreate,
    version?: number,
  ) => Promise<boolean>;
  deleteBaseline: (
    experimentId: number,
    detector: string,
    version?: number,
  ) => Promise<boolean>;
  autoBaseline: (experimentId: number, params?: AutoBaselineRequest) => Promise<boolean>;
  setBaselineSubtractedPreview: (value: boolean) => void;
  setSelectedBaselineDetector: (detector: string | null) => void;
  clear: () => void;
}

export const useBaselineStore = create<BaselineStore>((set, get) => ({
  baselines: [],
  loading: false,
  error: null,
  baselineSubtractedPreview: false,
  selectedBaselineDetector: null,
  versionConflict: null,

  fetchBaselines: async (experimentId: number) => {
    set({ loading: true, error: null, versionConflict: null });
    try {
      const res = await api.listBaselines(experimentId);
      set({ baselines: res.baselines, loading: false });
      const sel = get().selectedBaselineDetector;
      const present = res.baselines.some((b) => b.detector_name === sel);
      if (!sel || !present) {
        const first = res.baselines.find((b) => b.detector_name)?.detector_name ?? null;
        set({ selectedBaselineDetector: first });
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load baselines',
      });
    }
  },

  upsertBaseline: async (
    experimentId: number,
    detector: string,
    body: BaselineCreate,
    version?: number,
  ) => {
    set({ error: null, versionConflict: null });
    try {
      const res = await api.upsertBaseline(experimentId, detector, body, version);
      const existing = get().baselines;
      const idx = existing.findIndex(
        (b) => b.detector_name === detector,
      );
      let next: BaselineResponse[];
      if (idx >= 0) {
        next = existing.slice();
        next[idx] = res;
      } else {
        next = [...existing, res];
      }
      set({ baselines: next, selectedBaselineDetector: detector });
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save baseline';
      const isConflict = /version|conflict/i.test(message);
      set({
        error: message,
        versionConflict: isConflict ? { detector, message } : null,
      });
      if (isConflict) {
        await get().fetchBaselines(experimentId);
      }
      return false;
    }
  },

  deleteBaseline: async (experimentId: number, detector: string, version?: number) => {
    set({ error: null, versionConflict: null });
    try {
      await api.deleteBaseline(experimentId, detector, version);
      const next = get().baselines.filter((b) => b.detector_name !== detector);
      set({ baselines: next });
      if (get().selectedBaselineDetector === detector) {
        const first = next.find((b) => b.detector_name)?.detector_name ?? null;
        set({ selectedBaselineDetector: first });
      }
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete baseline';
      const isConflict = /version|conflict/i.test(message);
      set({
        error: message,
        versionConflict: isConflict ? { detector, message } : null,
      });
      if (isConflict) {
        await get().fetchBaselines(experimentId);
      }
      return false;
    }
  },

  autoBaseline: async (experimentId: number, params?: AutoBaselineRequest) => {
    set({ loading: true, error: null, versionConflict: null });
    try {
      const res = await api.autoBaselines(experimentId, params);
      const byName = new Map(res.baselines.map((b) => [b.detector_name, b]));
      const merged: BaselineResponse[] = [];
      for (const b of get().baselines) {
        if (b.detector_name && byName.has(b.detector_name)) {
          merged.push(byName.get(b.detector_name) as BaselineResponse);
          byName.delete(b.detector_name);
        } else {
          merged.push(b);
        }
      }
      for (const b of byName.values()) merged.push(b);
      set({ baselines: merged, loading: false });
      const sel = get().selectedBaselineDetector;
      if (!sel && merged.length > 0) {
        const first = merged.find((b) => b.detector_name)?.detector_name ?? null;
        set({ selectedBaselineDetector: first });
      }
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to auto-detect baselines',
      });
      return false;
    }
  },

  setBaselineSubtractedPreview: (value: boolean) => set({ baselineSubtractedPreview: value }),

  setSelectedBaselineDetector: (detector: string | null) =>
    set({ selectedBaselineDetector: detector, versionConflict: null }),

  clear: () =>
    set({
      baselines: [],
      loading: false,
      error: null,
      baselineSubtractedPreview: false,
      selectedBaselineDetector: null,
      versionConflict: null,
    }),
}));