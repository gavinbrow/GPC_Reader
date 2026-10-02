import { useState } from 'react';
import type { RawSeries } from '../afe8/types';

/** Per-view legend check-box state, initialised from the series defaults. */
export function useSeriesVisibility(series: RawSeries[], initial?: (s: RawSeries) => boolean) {
  const [vis, setVis] = useState<Record<string, boolean>>(() => Object.fromEntries(series.map((s) => [s.id, initial ? initial(s) : !!s.defaultVisible])));
  const isVisible = (id: string) => vis[id] ?? false;
  const toggle = (id: string, v: boolean) => setVis((o) => ({ ...o, [id]: v }));
  return { isVisible, toggle };
}
