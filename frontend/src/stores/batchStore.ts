import { create } from 'zustand';
import type {
  MethodTemplateResponse,
  MethodTemplateListResponse,
  MethodTemplateCreate,
  MethodTemplateUpdate,
  SettingToPropagate,
  BatchApplyRequest,
  BatchJobStatus,
  BatchJobListResponse,
  EasiTableResponse,
  EasiTableListResponse,
  EasiTableCreateRequest,
} from '../types/batch';
import * as api from '../api/endpoints';

interface BatchStore {
  methods: MethodTemplateResponse[];
  methodsLoading: boolean;
  methodsError: string | null;

  batchJob: BatchJobStatus | null;
  batchRunning: boolean;
  batchError: string | null;

  batchJobs: BatchJobStatus[];

  easiTables: EasiTableResponse[];
  easiLoading: boolean;
  easiError: string | null;
  currentEasiTable: EasiTableResponse | null;

  fetchMethods: () => Promise<void>;
  createMethod: (body: MethodTemplateCreate) => Promise<void>;
  updateMethod: (methodId: number, body: MethodTemplateUpdate) => Promise<void>;
  deleteMethod: (methodId: number) => Promise<void>;
  applyMethod: (experimentId: number, methodId: number) => Promise<void>;

  startBatch: (sourceExperimentId: number, targetExperimentIds: number[], settings: SettingToPropagate[]) => Promise<void>;
  pollBatch: (jobId: string) => Promise<void>;
  fetchBatchJobs: () => Promise<void>;
  cancelBatch: (jobId: string) => Promise<void>;

  fetchEasiTables: () => Promise<void>;
  createEasiTable: (body: EasiTableCreateRequest) => Promise<void>;
  fetchEasiTable: (easiId: number) => Promise<void>;
  exportEasiTable: (easiId: number) => Promise<void>;
  deleteEasiTable: (easiId: number) => Promise<void>;

  clear: () => void;
}

export const useBatchStore = create<BatchStore>((set, get) => ({
  methods: [],
  methodsLoading: false,
  methodsError: null,
  batchJob: null,
  batchRunning: false,
  batchError: null,
  batchJobs: [],
  easiTables: [],
  easiLoading: false,
  easiError: null,
  currentEasiTable: null,

  fetchMethods: async () => {
    set({ methodsLoading: true, methodsError: null });
    try {
      const res: MethodTemplateListResponse = await api.listMethodTemplates();
      set({ methods: res.methods, methodsLoading: false });
    } catch (err) {
      set({
        methodsLoading: false,
        methodsError: err instanceof Error ? err.message : 'Failed to load method templates',
      });
    }
  },

  createMethod: async (body: MethodTemplateCreate) => {
    set({ methodsError: null });
    try {
      await api.createMethodTemplate(body);
      await get().fetchMethods();
    } catch (err) {
      set({
        methodsError: err instanceof Error ? err.message : 'Failed to create method template',
      });
    }
  },

  updateMethod: async (methodId: number, body: MethodTemplateUpdate) => {
    set({ methodsError: null });
    try {
      await api.updateMethodTemplate(methodId, body);
      await get().fetchMethods();
    } catch (err) {
      set({
        methodsError: err instanceof Error ? err.message : 'Failed to update method template',
      });
    }
  },

  deleteMethod: async (methodId: number) => {
    set({ methodsError: null });
    try {
      await api.deleteMethodTemplate(methodId);
      await get().fetchMethods();
    } catch (err) {
      set({
        methodsError: err instanceof Error ? err.message : 'Failed to delete method template',
      });
    }
  },

  applyMethod: async (experimentId: number, methodId: number) => {
    set({ batchError: null });
    try {
      await api.applyMethodTemplate(experimentId, methodId);
    } catch (err) {
      set({
        batchError: err instanceof Error ? err.message : 'Failed to apply method',
      });
    }
  },

  startBatch: async (
    sourceExperimentId: number,
    targetExperimentIds: number[],
    settings: SettingToPropagate[],
  ) => {
    set({ batchRunning: true, batchError: null, batchJob: null });
    try {
      const reqBody: BatchApplyRequest = {
        source_experiment_id: sourceExperimentId,
        target_experiment_ids: targetExperimentIds,
        settings_to_propagate: settings,
      };
      const jobResp = await api.batchApply(reqBody);
      await get().pollBatch(jobResp.job_id);
    } catch (err) {
      set({
        batchRunning: false,
        batchError: err instanceof Error ? err.message : 'Failed to start batch',
      });
    }
  },

  pollBatch: async (jobId: string) => {
    const maxAttempts = 120;
    const delay = 500;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const status = await api.getBatchStatus(jobId);
        set({ batchJob: status });
        if (status.status === 'completed') {
          set({ batchRunning: false });
          return;
        }
        if (status.status === 'failed' || status.status === 'cancelled') {
          set({
            batchRunning: false,
            batchError: status.error || `Batch ${status.status}`,
          });
          return;
        }
      } catch (err) {
        set({
          batchRunning: false,
          batchError: err instanceof Error ? err.message : 'Failed to poll batch status',
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    set({ batchRunning: false, batchError: 'Batch timed out' });
  },

  fetchBatchJobs: async () => {
    try {
      const res: BatchJobListResponse = await api.listBatchJobs();
      set({ batchJobs: res.jobs });
    } catch {
    }
  },

  cancelBatch: async (jobId: string) => {
    try {
      await api.cancelBatchJob(jobId);
      await get().fetchBatchJobs();
    } catch (err) {
      set({
        batchError: err instanceof Error ? err.message : 'Failed to cancel batch',
      });
    }
  },

  fetchEasiTables: async () => {
    set({ easiLoading: true, easiError: null });
    try {
      const res: EasiTableListResponse = await api.listEasiTables();
      set({ easiTables: res.tables, easiLoading: false });
    } catch (err) {
      set({
        easiLoading: false,
        easiError: err instanceof Error ? err.message : 'Failed to load EASI tables',
      });
    }
  },

  createEasiTable: async (body: EasiTableCreateRequest) => {
    set({ easiError: null });
    try {
      const table = await api.createEasiTable(body);
      set({ currentEasiTable: table });
      await get().fetchEasiTables();
    } catch (err) {
      set({
        easiError: err instanceof Error ? err.message : 'Failed to create EASI table',
      });
    }
  },

  fetchEasiTable: async (easiId: number) => {
    set({ easiLoading: true, easiError: null });
    try {
      const table = await api.getEasiTable(easiId);
      set({ currentEasiTable: table, easiLoading: false });
    } catch (err) {
      set({
        easiLoading: false,
        easiError: err instanceof Error ? err.message : 'Failed to load EASI table',
      });
    }
  },

  exportEasiTable: async (easiId: number) => {
    try {
      const blob = await api.exportEasiTable(easiId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `easi_table_${easiId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      set({
        easiError: err instanceof Error ? err.message : 'Failed to export EASI table',
      });
    }
  },

  deleteEasiTable: async (easiId: number) => {
    try {
      await api.deleteEasiTable(easiId);
      await get().fetchEasiTables();
    } catch (err) {
      set({
        easiError: err instanceof Error ? err.message : 'Failed to delete EASI table',
      });
    }
  },

  clear: () =>
    set({
      methods: [],
      methodsLoading: false,
      methodsError: null,
      batchJob: null,
      batchRunning: false,
      batchError: null,
      batchJobs: [],
      easiTables: [],
      easiLoading: false,
      easiError: null,
      currentEasiTable: null,
    }),
}));