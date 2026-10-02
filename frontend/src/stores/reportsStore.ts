import { create } from 'zustand';
import type {
  ReportTemplateResponse,
  ReportTemplateListResponse,
  ReportTemplateCreate,
  ReportTemplateUpdate,
  ReportJobStatus,
  ReportFormat,
} from '../types/reports';
import * as api from '../api/endpoints';

interface ReportsStore {
  templates: ReportTemplateResponse[];
  templatesLoading: boolean;
  templatesError: string | null;

  jobStatus: ReportJobStatus | null;
  generating: boolean;
  generateError: string | null;

  fetchTemplates: () => Promise<void>;
  createTemplate: (body: ReportTemplateCreate) => Promise<void>;
  updateTemplate: (templateId: number, body: ReportTemplateUpdate) => Promise<void>;
  deleteTemplate: (templateId: number) => Promise<void>;

  generateReport: (experimentId: number, format: ReportFormat, title?: string, notes?: string, includeSliceData?: boolean) => Promise<void>;
  pollReport: (experimentId: number, jobId: string) => Promise<void>;
  downloadReport: (experimentId: number, jobId: string, fileName: string) => Promise<void>;

  clear: () => void;
}

export const useReportsStore = create<ReportsStore>((set, get) => ({
  templates: [],
  templatesLoading: false,
  templatesError: null,
  jobStatus: null,
  generating: false,
  generateError: null,

  fetchTemplates: async () => {
    set({ templatesLoading: true, templatesError: null });
    try {
      const res: ReportTemplateListResponse = await api.listReportTemplates();
      set({ templates: res.templates, templatesLoading: false });
    } catch (err) {
      set({
        templatesLoading: false,
        templatesError: err instanceof Error ? err.message : 'Failed to load templates',
      });
    }
  },

  createTemplate: async (body: ReportTemplateCreate) => {
    set({ templatesError: null });
    try {
      await api.createReportTemplate(body);
      await get().fetchTemplates();
    } catch (err) {
      set({
        templatesError: err instanceof Error ? err.message : 'Failed to create template',
      });
    }
  },

  updateTemplate: async (templateId: number, body: ReportTemplateUpdate) => {
    set({ templatesError: null });
    try {
      await api.updateReportTemplate(templateId, body);
      await get().fetchTemplates();
    } catch (err) {
      set({
        templatesError: err instanceof Error ? err.message : 'Failed to update template',
      });
    }
  },

  deleteTemplate: async (templateId: number) => {
    set({ templatesError: null });
    try {
      await api.deleteReportTemplate(templateId);
      await get().fetchTemplates();
    } catch (err) {
      set({
        templatesError: err instanceof Error ? err.message : 'Failed to delete template',
      });
    }
  },

  generateReport: async (
    experimentId: number,
    format: ReportFormat,
    title?: string,
    notes?: string,
    includeSliceData?: boolean,
  ) => {
    set({ generating: true, generateError: null, jobStatus: null });
    try {
      const jobResp = await api.generateReport(experimentId, {
        format,
        title,
        notes,
        include_slice_data: includeSliceData ?? true,
      });
      await get().pollReport(experimentId, jobResp.job_id);
    } catch (err) {
      set({
        generating: false,
        generateError: err instanceof Error ? err.message : 'Failed to generate report',
      });
    }
  },

  pollReport: async (experimentId: number, jobId: string) => {
    const maxAttempts = 60;
    const delay = 500;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const status = await api.getReportStatus(experimentId, jobId);
        set({ jobStatus: status });
        if (status.status === 'completed') {
          set({ generating: false });
          return;
        }
        if (status.status === 'failed') {
          set({
            generating: false,
            generateError: status.error || 'Report generation failed',
          });
          return;
        }
      } catch (err) {
        set({
          generating: false,
          generateError: err instanceof Error ? err.message : 'Failed to poll report status',
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    set({ generating: false, generateError: 'Report generation timed out' });
  },

  downloadReport: async (experimentId: number, jobId: string, fileName: string) => {
    try {
      const blob = await api.downloadReport(experimentId, jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      set({
        generateError: err instanceof Error ? err.message : 'Failed to download report',
      });
    }
  },

  clear: () =>
    set({
      templates: [],
      templatesLoading: false,
      templatesError: null,
      jobStatus: null,
      generating: false,
      generateError: null,
    }),
}));