import { useCallback, useMemo } from 'react';
import type { Method } from '../analysis/method';
import type { Processed } from '../analysis/pipeline';
import { processedFor, useStore, type Tab } from '../store';
import type { Experiment } from '../afe8/types';

export interface ViewContext {
  tab: Tab;
  experiment: Experiment;
  /** Method shown in this view (draft if edited, otherwise committed). */
  method: Method;
  committed: Method;
  processed: Processed;
  dirty: boolean;
  /** Replace the draft method (functional update). */
  update(fn: (m: Method) => Method): void;
}

/** Everything a procedure view needs; must only be used for tabs bound to an experiment. */
export function useViewContext(tab: Tab): ViewContext | null {
  const entry = useStore((s) => s.experiments.find((x) => x.experiment.id === tab.expId));
  const setDraft = useStore((s) => s.setDraft);
  const method = tab.draft ?? entry?.method;
  const processed = useMemo(() => (entry && method ? processedFor(entry.experiment, method) : null), [entry, method]);
  const update = useCallback(
    (fn: (m: Method) => Method) => {
      const cur = useStore.getState().tabs.find((t) => t.id === tab.id);
      const e = useStore.getState().experiments.find((x) => x.experiment.id === tab.expId);
      if (!cur || !e) return;
      setDraft(tab.id, fn(cur.draft ?? e.method));
    },
    [tab.id, tab.expId, setDraft],
  );
  if (!entry || !method || !processed) return null;
  return { tab, experiment: entry.experiment, method, committed: entry.method, processed, dirty: !!tab.draft, update };
}
