import { create } from 'zustand';
import type { PeakResponse, PeakCreate, PeakUpdate, AutoPeakRequest } from '../types/peak';
import * as api from '../api/endpoints';
import { useExperimentStore } from './experimentStore';

interface PeakStore {
  peaks: PeakResponse[];
  loading: boolean;
  error: string | null;
  selectedPeakId: number | null;
  versionConflict: { peakId: number; message: string } | null;

  fetchPeaks: (experimentId: number) => Promise<void>;
  createPeak: (experimentId: number, body: PeakCreate) => Promise<PeakResponse | null>;
  updatePeak: (
    experimentId: number,
    peakId: number,
    body: PeakUpdate,
    version?: number,
  ) => Promise<boolean>;
  deletePeak: (experimentId: number, peakId: number, version?: number) => Promise<boolean>;
  autoDetectPeaks: (experimentId: number, params?: AutoPeakRequest) => Promise<boolean>;
  setSelectedPeakId: (id: number | null) => void;
  clear: () => void;
}

export const usePeakStore = create<PeakStore>((set, get) => ({
  peaks: [],
  loading: false,
  error: null,
  selectedPeakId: null,
  versionConflict: null,

  fetchPeaks: async (experimentId: number) => {
    set({ loading: true, error: null, versionConflict: null });
    try {
      const res = await api.listPeaks(experimentId);
      set({ peaks: res.peaks, loading: false });
      const sel = get().selectedPeakId;
      const present = res.peaks.some((p) => p.id === sel);
      if (sel === null || !present) {
        set({ selectedPeakId: res.peaks[0]?.id ?? null });
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load peaks',
      });
    }
  },

  createPeak: async (experimentId: number, body: PeakCreate) => {
    set({ error: null, versionConflict: null });
    try {
      const res = await api.createPeak(experimentId, body);
      set({ peaks: [...get().peaks, res], selectedPeakId: res.id });
      useExperimentStore.getState().markDirty();
      return res;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to create peak',
      });
      return null;
    }
  },

  updatePeak: async (
    experimentId: number,
    peakId: number,
    body: PeakUpdate,
    version?: number,
  ) => {
    set({ error: null, versionConflict: null });
    try {
      const res = await api.updatePeak(experimentId, peakId, body, version);
      const next = get().peaks.map((p) => (p.id === peakId ? res : p));
      set({ peaks: next });
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update peak';
      const isConflict = /version|conflict/i.test(message);
      set({
        error: message,
        versionConflict: isConflict ? { peakId, message } : null,
      });
      if (isConflict) {
        await get().fetchPeaks(experimentId);
      }
      return false;
    }
  },

  deletePeak: async (experimentId: number, peakId: number, version?: number) => {
    set({ error: null, versionConflict: null });
    try {
      await api.deletePeak(experimentId, peakId, version);
      const next = get().peaks.filter((p) => p.id !== peakId);
      set({ peaks: next });
      if (get().selectedPeakId === peakId) {
        set({ selectedPeakId: next[0]?.id ?? null });
      }
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete peak';
      const isConflict = /version|conflict/i.test(message);
      set({
        error: message,
        versionConflict: isConflict ? { peakId, message } : null,
      });
      if (isConflict) {
        await get().fetchPeaks(experimentId);
      }
      return false;
    }
  },

  autoDetectPeaks: async (experimentId: number, params?: AutoPeakRequest) => {
    set({ loading: true, error: null, versionConflict: null });
    try {
      const res = await api.autoDetectPeaks(experimentId, params);
      const byRange = new Map(
        res.peaks.map((p) => [p.range_number, p]),
      );
      const merged: PeakResponse[] = [];
      for (const p of get().peaks) {
        const key = p.range_number;
        if (key !== null && byRange.has(key)) {
          merged.push(byRange.get(key) as PeakResponse);
          byRange.delete(key);
        } else {
          merged.push(p);
        }
      }
      for (const p of byRange.values()) merged.push(p);
      merged.sort((a, b) => (a.range_number ?? 0) - (b.range_number ?? 0));
      set({ peaks: merged, loading: false });
      const sel = get().selectedPeakId;
      if (sel === null || !merged.some((p) => p.id === sel)) {
        set({ selectedPeakId: merged[0]?.id ?? null });
      }
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to auto-detect peaks',
      });
      return false;
    }
  },

  setSelectedPeakId: (id: number | null) =>
    set({ selectedPeakId: id, versionConflict: null }),

  clear: () =>
    set({
      peaks: [],
      loading: false,
      error: null,
      selectedPeakId: null,
      versionConflict: null,
    }),
}));