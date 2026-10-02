import { create } from 'zustand';
import type { Experiment } from './afe8/types';
import { defaultMethod, type Method } from './analysis/method';
import { completeMethod, process, type Processed } from './analysis/pipeline';

export type ViewKind =
  | 'configuration'
  | 'basicCollection'
  | 'despiking'
  | 'baselines'
  | 'alignment'
  | 'bandBroadening'
  | 'normalization'
  | 'peaks'
  | 'molarMass'
  | 'resultsFitting'
  | 'distribution'
  | 'viscometry'
  | 'report'
  | 'peakResults'
  | 'peakStats'
  | 'sliceTable'
  | 'massVsTime'
  | 'conformation'
  | 'markHouwink'
  | 'storedResults'
  | 'log'
  | 'fileContents'
  | 'easiGraph'
  | 'easiTable'
  | 'about';

export const VIEW_TITLES: Record<ViewKind, string> = {
  configuration: 'Configuration',
  basicCollection: 'Basic Collection',
  despiking: 'Despiking',
  baselines: 'Baselines',
  alignment: 'Alignment',
  bandBroadening: 'Band Broadening',
  normalization: 'Normalization',
  peaks: 'Peaks',
  molarMass: 'Molar Mass & Radius from LS',
  resultsFitting: 'Results Fitting',
  distribution: 'Distribution Analysis',
  viscometry: 'Viscometry',
  report: 'Report',
  peakResults: 'Peak Results',
  peakStats: 'Peak Statistics',
  sliceTable: 'Slice Results',
  massVsTime: 'Molar Mass vs. Time',
  conformation: 'Conformation Plot',
  markHouwink: 'Mark-Houwink Plot',
  storedResults: 'Stored ASTRA Results',
  log: 'Experiment Log',
  fileContents: 'File Contents',
  easiGraph: 'EASI Graph',
  easiTable: 'EASI Table',
  about: 'About OpenMALS',
};

/** Views that edit the method and therefore show OK / Cancel / Apply. */
export const EDITING_VIEWS = new Set<ViewKind>([
  'configuration',
  'despiking',
  'baselines',
  'alignment',
  'bandBroadening',
  'normalization',
  'peaks',
  'molarMass',
  'resultsFitting',
  'distribution',
  'viscometry',
]);

export interface ExpEntry {
  experiment: Experiment;
  method: Method;
}

export interface Tab {
  id: string;
  expId?: string;
  view: ViewKind;
  /** Uncommitted edits made in this view. */
  draft?: Method;
}

export type NavPane = 'Experiments' | 'Sequences' | 'Profiles' | 'Instruments';
export type ChartCommand = 'zoomIn' | 'zoomOut' | 'reset' | 'png';

interface State {
  experiments: ExpEntry[];
  tabs: Tab[];
  activeTabId?: string;
  selectedExpId?: string;
  nav: NavPane;
  sidebarCollapsed: boolean;
  chartMode: 'zoom' | 'pan';
  chartCmd: { seq: number; cmd: ChartCommand };
  status: string;
  busy: boolean;
  error?: string;

  addExperiment(e: Experiment): void;
  closeExperiment(expId: string): void;
  selectExperiment(expId: string): void;
  openView(view: ViewKind, expId?: string): void;
  closeTab(tabId: string): void;
  activateTab(tabId: string): void;
  setDraft(tabId: string, m: Method | undefined): void;
  /** Commit a tab's draft to the experiment. */
  apply(tabId: string): void;
  setMethod(expId: string, m: Method): void;
  setNav(n: NavPane): void;
  toggleSidebar(): void;
  setChartMode(m: 'zoom' | 'pan'): void;
  chartCommand(cmd: ChartCommand): void;
  setStatus(s: string): void;
  setBusy(b: boolean): void;
  setError(e?: string): void;
}

let tabSeq = 0;

export const useStore = create<State>((set, get) => ({
  experiments: [],
  tabs: [],
  nav: 'Experiments',
  sidebarCollapsed: false,
  chartMode: 'zoom',
  chartCmd: { seq: 0, cmd: 'reset' },
  status: 'Ready',
  busy: false,

  addExperiment(e) {
    const method = completeMethod(e, defaultMethod(e));
    set((s) => ({ experiments: [...s.experiments, { experiment: e, method }], selectedExpId: e.id, nav: 'Experiments' }));
    get().openView('basicCollection', e.id);
  },
  closeExperiment(expId) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.expId !== expId);
      const experiments = s.experiments.filter((x) => x.experiment.id !== expId);
      return {
        experiments,
        tabs,
        activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[tabs.length - 1]?.id,
        selectedExpId: s.selectedExpId === expId ? experiments[0]?.experiment.id : s.selectedExpId,
      };
    });
  },
  selectExperiment(expId) {
    set({ selectedExpId: expId });
  },
  openView(view, expId) {
    const s = get();
    const global = view === 'easiGraph' || view === 'easiTable' || view === 'about';
    const eid = global ? undefined : expId ?? s.selectedExpId;
    if (!global && !eid) return;
    const existing = s.tabs.find((t) => t.view === view && t.expId === eid);
    if (existing) {
      set({ activeTabId: existing.id, selectedExpId: eid ?? s.selectedExpId });
      return;
    }
    const tab: Tab = { id: `tab${++tabSeq}`, expId: eid, view };
    set({ tabs: [...s.tabs, tab], activeTabId: tab.id, selectedExpId: eid ?? s.selectedExpId });
  },
  closeTab(tabId) {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      let active = s.activeTabId;
      if (active === tabId) active = tabs[Math.min(idx, tabs.length - 1)]?.id;
      return { tabs, activeTabId: active };
    });
  },
  activateTab(tabId) {
    const t = get().tabs.find((x) => x.id === tabId);
    set({ activeTabId: tabId, selectedExpId: t?.expId ?? get().selectedExpId });
  },
  setDraft(tabId, m) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, draft: m } : t)) }));
  },
  apply(tabId) {
    const t = get().tabs.find((x) => x.id === tabId);
    if (!t?.draft || !t.expId) return;
    get().setMethod(t.expId, t.draft);
    set((s) => ({ tabs: s.tabs.map((x) => (x.id === tabId ? { ...x, draft: undefined } : x)) }));
  },
  setMethod(expId, m) {
    set((s) => ({
      experiments: s.experiments.map((x) => (x.experiment.id === expId ? { ...x, method: m } : x)),
      // Drafts of other views of this experiment are based on the old method: drop them.
      tabs: s.tabs.map((t) => (t.expId === expId && t.draft && t.draft !== m ? { ...t, draft: undefined } : t)),
      status: 'Processing complete',
    }));
  },
  setNav(n) {
    set({ nav: n });
  },
  toggleSidebar() {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
  },
  setChartMode(m) {
    set({ chartMode: m });
  },
  chartCommand(cmd) {
    set((s) => ({ chartCmd: { seq: s.chartCmd.seq + 1, cmd } }));
  },
  setStatus(status) {
    set({ status });
  },
  setBusy(busy) {
    set({ busy });
  },
  setError(error) {
    set({ error });
  },
}));

/* ------------------------------------------------------------------ */
/* Derived data                                                        */
/* ------------------------------------------------------------------ */

const processedCache = new WeakMap<Method, { e: Experiment; p: Processed }>();

/** Process (memoised per method object). */
export function processedFor(e: Experiment, m: Method): Processed {
  const hit = processedCache.get(m);
  if (hit && hit.e === e) return hit.p;
  const p = process(e, m);
  processedCache.set(m, { e, p });
  return p;
}

export function entryOf(expId: string | undefined): ExpEntry | undefined {
  if (!expId) return undefined;
  return useStore.getState().experiments.find((x) => x.experiment.id === expId);
}
