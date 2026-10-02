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
  /** The method was changed since the file was opened (not saved to a method file). */
  modified?: boolean;
}

export interface Tab {
  id: string;
  expId?: string;
  view: ViewKind;
  /** Uncommitted edits made in this view. */
  draft?: Method;
  /** Undo / redo stacks of this view's edits (methods before / after each edit). */
  past?: Method[];
  future?: Method[];
}

const UNDO_LIMIT = 100;

/** Small persisted UI preferences (best effort: storage can be unavailable). */
function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`openmals.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(`openmals.${key}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
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
  sidebarWidth: number;
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
  /** Close several tabs; asks for confirmation when any of them has unapplied changes. */
  closeTabs(tabIds: string[]): void;
  activateTab(tabId: string): void;
  /** Activate the next (+1) or previous (-1) tab. */
  cycleTab(dir: number): void;
  setDraft(tabId: string, m: Method | undefined): void;
  /** Record an edit (undoable) and make it the tab's draft. */
  editDraft(tabId: string, m: Method): void;
  undo(tabId: string): void;
  redo(tabId: string): void;
  /** Commit a tab's draft to the experiment. */
  apply(tabId: string): void;
  setMethod(expId: string, m: Method): void;
  setNav(n: NavPane): void;
  toggleSidebar(): void;
  setSidebarWidth(w: number): void;
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
  sidebarCollapsed: loadPref('sidebarCollapsed', false),
  sidebarWidth: loadPref('sidebarWidth', 270),
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
    const s0 = get();
    const entry = s0.experiments.find((x) => x.experiment.id === expId);
    const dirty = s0.tabs.some((t) => t.expId === expId && t.draft);
    if (entry && dirty && !confirm(`${entry.experiment.name} has views with changes that were not applied. Close it anyway?`)) return;
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
  closeTabs(tabIds) {
    const ids = new Set(tabIds);
    const dirty = get().tabs.filter((t) => ids.has(t.id) && t.draft).length;
    if (dirty && !confirm(`${dirty} view${dirty > 1 ? 's have' : ' has'} changes that were not applied. Close and discard them?`)) return;
    set((s) => {
      const tabs = s.tabs.filter((t) => !ids.has(t.id));
      let active = s.activeTabId;
      if (active && ids.has(active)) {
        const idx = s.tabs.findIndex((t) => t.id === active);
        const after = s.tabs.slice(idx).find((t) => !ids.has(t.id));
        active = (after ?? tabs[tabs.length - 1])?.id;
      }
      return { tabs, activeTabId: active };
    });
  },
  activateTab(tabId) {
    const t = get().tabs.find((x) => x.id === tabId);
    set({ activeTabId: tabId, selectedExpId: t?.expId ?? get().selectedExpId });
  },
  cycleTab(dir) {
    const { tabs, activeTabId } = get();
    if (!tabs.length) return;
    const i = tabs.findIndex((t) => t.id === activeTabId);
    get().activateTab(tabs[(i + dir + tabs.length) % tabs.length].id);
  },
  setDraft(tabId, m) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, draft: m, ...(m ? {} : { past: undefined, future: undefined }) } : t)) }));
  },
  editDraft(tabId, m) {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const cur = t.draft ?? s.experiments.find((x) => x.experiment.id === t.expId)?.method;
        if (!cur || cur === m) return t;
        return { ...t, draft: m, past: [...(t.past ?? []), cur].slice(-UNDO_LIMIT), future: [] };
      }),
    }));
  },
  undo(tabId) {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.past?.length) return t;
        const committed = s.experiments.find((x) => x.experiment.id === t.expId)?.method;
        const cur = t.draft ?? committed;
        const prev = t.past[t.past.length - 1];
        return { ...t, draft: prev === committed ? undefined : prev, past: t.past.slice(0, -1), future: cur ? [...(t.future ?? []), cur] : t.future };
      }),
    }));
  },
  redo(tabId) {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.future?.length) return t;
        const committed = s.experiments.find((x) => x.experiment.id === t.expId)?.method;
        const cur = t.draft ?? committed;
        const next = t.future[t.future.length - 1];
        return { ...t, draft: next === committed ? undefined : next, future: t.future.slice(0, -1), past: cur ? [...(t.past ?? []), cur] : t.past };
      }),
    }));
  },
  apply(tabId) {
    const t = get().tabs.find((x) => x.id === tabId);
    if (!t?.draft || !t.expId) return;
    get().setMethod(t.expId, t.draft);
    set((s) => ({ tabs: s.tabs.map((x) => (x.id === tabId ? { ...x, draft: undefined, past: undefined, future: undefined } : x)), status: 'Changes applied' }));
  },
  setMethod(expId, m) {
    set((s) => ({
      experiments: s.experiments.map((x) => (x.experiment.id === expId ? { ...x, method: m, modified: x.modified || x.method !== m } : x)),
      // Drafts of other views of this experiment are based on the old method: drop them.
      tabs: s.tabs.map((t) => (t.expId === expId && t.draft && t.draft !== m ? { ...t, draft: undefined, past: undefined, future: undefined } : t)),
      status: 'Processing complete',
    }));
  },
  setNav(n) {
    set({ nav: n });
  },
  toggleSidebar() {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
    savePref('sidebarCollapsed', get().sidebarCollapsed);
  },
  setSidebarWidth(w) {
    const width = Math.round(Math.min(Math.max(w, 180), Math.max(220, window.innerWidth * 0.6)));
    set({ sidebarWidth: width });
    savePref('sidebarWidth', width);
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
