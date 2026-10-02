/**
 * processingStore — live per-detector alignment (time shift) and band
 * broadening (Gaussian sigma) for the chromatogram display.
 *
 * The store holds the *active* values so the plot updates instantly as the user
 * drags. Persistence to the experiment's ``sample_config.processing`` is done
 * (debounced) by the AlignmentControls component via
 * ``experimentStore.updateSampleConfig``.
 */
import { create } from 'zustand';
import type { ProcessingConfig, DetectorProcessing } from '../api/endpoints';

export type ProcessingDetector = 'MALS' | 'RI' | 'UV';
export type ProcessingField = 'shift' | 'broaden';

interface ProcessingStore {
  processing: ProcessingConfig;
  /** Replace the whole config (e.g. when loading from the selected experiment). */
  loadFromConfig: (cfg: ProcessingConfig | null | undefined) => void;
  /** Update a single field for a detector. */
  setField: (det: ProcessingDetector, field: ProcessingField, value: number) => void;
  /** Clear all corrections. */
  reset: () => void;
}

const EMPTY: ProcessingConfig = {};

function sanitize(cfg: ProcessingConfig | null | undefined): ProcessingConfig {
  if (!cfg || typeof cfg !== 'object') return {};
  const out: ProcessingConfig = {};
  (['MALS', 'RI', 'UV'] as ProcessingDetector[]).forEach((det) => {
    const p = cfg[det];
    if (p && typeof p === 'object') {
      const entry: DetectorProcessing = {};
      if (typeof p.shift === 'number' && Number.isFinite(p.shift)) entry.shift = p.shift;
      if (typeof p.broaden === 'number' && Number.isFinite(p.broaden)) entry.broaden = p.broaden;
      if (Object.keys(entry).length) out[det] = entry;
    }
  });
  return out;
}

export const useProcessingStore = create<ProcessingStore>((set) => ({
  processing: EMPTY,

  loadFromConfig: (cfg) => set({ processing: sanitize(cfg) }),

  setField: (det, field, value) =>
    set((state) => {
      const next: ProcessingConfig = { ...state.processing };
      const entry: DetectorProcessing = { ...(next[det] ?? {}) };
      entry[field] = value;
      next[det] = entry;
      return { processing: next };
    }),

  reset: () => set({ processing: EMPTY }),
}));
