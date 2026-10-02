import { create } from 'zustand';
import type {
  ProcedureStateResponse,
  ProcedureUpdateRequest,
  AutoAnalyzeResponse,
} from '../types/procedures';
import * as api from '../api/endpoints';
import { useExperimentStore } from './experimentStore';

let wsInstance: WebSocket | null = null;

interface VersionConflict {
  procedureName: string;
  message: string;
}

interface ProcedureStore {
  procedures: ProcedureStateResponse[];
  loading: boolean;
  error: string | null;
  versionConflict: VersionConflict | null;

  isRunning: boolean;
  progressPct: number;
  progressMessage: string;
  progressProcedure: string;
  runError: string | null;
  lastRunResult: AutoAnalyzeResponse | null;

  fetchProcedures: (experimentId: number) => Promise<void>;
  updateProcedure: (
    experimentId: number,
    name: string,
    body: ProcedureUpdateRequest,
    version?: number,
  ) => Promise<boolean>;
  runAllProcedures: (
    experimentId: number,
    peakId?: number,
  ) => Promise<boolean>;
  runAutoAnalyze: (experimentId: number) => Promise<boolean>;
  runAsyncAnalysis: (experimentId: number) => Promise<void>;
  clearProgress: () => void;
  clear: () => void;
}

function closeWs() {
  if (wsInstance) {
    try {
      wsInstance.close();
    } catch {
      // ignore
    }
    wsInstance = null;
  }
}

export const useProcedureStore = create<ProcedureStore>((set, get) => ({
  procedures: [],
  loading: false,
  error: null,
  versionConflict: null,

  isRunning: false,
  progressPct: 0,
  progressMessage: '',
  progressProcedure: '',
  runError: null,
  lastRunResult: null,

  fetchProcedures: async (experimentId: number) => {
    set({ loading: true, error: null, versionConflict: null });
    try {
      const res = await api.getProcedures(experimentId);
      set({ procedures: res.procedures, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load procedures',
      });
    }
  },

  updateProcedure: async (
    experimentId: number,
    name: string,
    body: ProcedureUpdateRequest,
    version?: number,
  ) => {
    set({ error: null, versionConflict: null });
    try {
      const res = await api.updateProcedure(experimentId, name, body, version);
      const next = get().procedures.map((p) =>
        p.procedure_name === name ? res : p,
      );
      set({ procedures: next });
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update procedure';
      const isConflict = /version|conflict/i.test(message);
      set({
        error: message,
        versionConflict: isConflict ? { procedureName: name, message } : null,
      });
      if (isConflict) {
        await get().fetchProcedures(experimentId);
      }
      return false;
    }
  },

  runAllProcedures: async (experimentId: number, peakId?: number) => {
    set({ isRunning: true, runError: null, progressPct: 0 });
    try {
      const res = await api.runAllProcedures(experimentId, peakId != null ? { peak_id: peakId } : undefined);
      set({
        isRunning: false,
        progressPct: 100,
        lastRunResult: res,
        procedures: res.procedure_states,
      });
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      set({
        isRunning: false,
        runError: err instanceof Error ? err.message : 'Failed to run procedures',
      });
      return false;
    }
  },

  runAutoAnalyze: async (experimentId: number) => {
    set({ isRunning: true, runError: null, progressPct: 0 });
    try {
      const res = await api.autoAnalyze(experimentId);
      set({
        isRunning: false,
        progressPct: 100,
        lastRunResult: res,
        procedures: res.procedure_states,
      });
      useExperimentStore.getState().markDirty();
      return true;
    } catch (err) {
      set({
        isRunning: false,
        runError: err instanceof Error ? err.message : 'Auto-analyze failed',
      });
      return false;
    }
  },

  runAsyncAnalysis: async (experimentId: number) => {
    closeWs();
    set({
      isRunning: true,
      progressPct: 0,
      progressMessage: '',
      progressProcedure: '',
      runError: null,
    });
    try {
      await api.runAsyncAnalysis(experimentId);
    } catch (err) {
      set({
        isRunning: false,
        runError: err instanceof Error ? err.message : 'Failed to start analysis',
      });
      return;
    }

    // The backend analysis is now running in a background thread regardless of
    // whether we can stream its progress.  We *try* to stream via WebSocket for
    // a live progress bar, but if the WS never connects (e.g. a proxy that does
    // not forward WS upgrades) we fall back to polling the results endpoint so
    // the run still finishes cleanly instead of hanging at 0%.
    let settled = false;
    let openTimer: ReturnType<typeof setTimeout> | null = null;

    const pollForCompletion = async () => {
      set({ progressMessage: 'Finishing…' });
      for (let i = 0; i < 60; i++) {
        if (settled && get().isRunning === false) return;
        try {
          const res = await api.getResults(experimentId);
          if (res && res.peaks.some((p) => p.mw != null)) {
            if (!settled) {
              settled = true;
              set({ isRunning: false, progressPct: 100 });
            }
            return;
          }
        } catch {
          // keep polling
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!settled) {
        settled = true;
        set({ isRunning: false, runError: 'Analysis timed out' });
      }
    };

    const fallback = () => {
      if (settled) return;
      closeWs();
      void pollForCompletion();
    };

    const protocol =
      window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/experiments/${experimentId}/progress`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      fallback();
      return;
    }
    wsInstance = ws;

    // If the WS has not opened shortly after connecting, assume it will not and
    // switch to polling.
    openTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) fallback();
    }, 4000);

    ws.onopen = () => {
      if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
      }
    };

    ws.onmessage = (ev) => {
      let payload: unknown;
      try {
        payload = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      const msg = payload as {
        type: string;
        procedure?: string;
        pct?: number;
        message?: string;
        results_url?: string;
      };
      if (msg.type === 'progress') {
        set({
          progressProcedure: msg.procedure ?? '',
          progressPct: typeof msg.pct === 'number' ? msg.pct : get().progressPct,
          progressMessage: msg.message ?? '',
        });
      } else if (msg.type === 'complete') {
        settled = true;
        set({ isRunning: false, progressPct: 100 });
        closeWs();
      } else if (msg.type === 'error') {
        settled = true;
        set({
          isRunning: false,
          runError: msg.message ?? 'Analysis failed',
        });
        closeWs();
      }
    };

    ws.onerror = () => {
      // Do not surface an error — the backend run is still going; fall back to
      // polling so results load once it finishes.
      fallback();
    };

    ws.onclose = () => {
      if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
      }
      if (!settled && get().isRunning) {
        fallback();
      }
      if (wsInstance === ws) wsInstance = null;
    };
  },

  clearProgress: () =>
    set({
      isRunning: false,
      progressPct: 0,
      progressMessage: '',
      progressProcedure: '',
      runError: null,
    }),

  clear: () => {
    closeWs();
    set({
      procedures: [],
      loading: false,
      error: null,
      versionConflict: null,
      isRunning: false,
      progressPct: 0,
      progressMessage: '',
      progressProcedure: '',
      runError: null,
      lastRunResult: null,
    });
  },
}));