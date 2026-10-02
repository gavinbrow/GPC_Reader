/**
 * Shared access to the bundled Plotly instance.
 *
 * `react-plotly.js` bundles `plotly.js/dist/plotly` and loads it in a lazy
 * chunk.  Importing that same module here resolves from the already-loaded
 * chunk (no duplicate bundle) and gives us the exact same Plotly instance the
 * chart was rendered with, so imperative calls like `Plotly.relayout(gd, …)`
 * operate on the live graph div.
 *
 * This replaces the previous approach of loading Plotly from a CDN into
 * `window.Plotly`, which silently failed offline / under a strict CSP and left
 * the zoom / baseline / peak controls dead.
 */
let _plotly: Promise<any> | null = null;

export function loadPlotly(): Promise<any> {
  if (_plotly == null) {
    // The prebuilt dist bundle has no type declarations; it is the exact same
    // instance react-plotly.js loads, so this resolves from the existing chunk.
    // @ts-expect-error - no type declarations for the dist entry
    _plotly = import('plotly.js/dist/plotly').then((m: any) => m.default ?? m);
  }
  return _plotly;
}

/**
 * The graph div created by Plotly is augmented with an event emitter
 * (`gd.on` / `gd.removeListener`).  Plotly events are delivered through this
 * emitter, NOT as DOM events — `addEventListener('plotly_relayout', …)` never
 * fires.  These helpers attach/detach via the emitter and no-op safely if the
 * div is not yet a Plotly graph.
 */
type PlotlyEventDiv = HTMLElement & {
  on?: (event: string, handler: (e: any) => void) => void;
  removeListener?: (event: string, handler: (e: any) => void) => void;
};

export function onPlotlyEvent(
  el: HTMLElement | null,
  event: string,
  handler: (e: any) => void,
): () => void {
  const gd = el as PlotlyEventDiv | null;
  if (!gd || typeof gd.on !== 'function') return () => {};
  gd.on(event, handler);
  return () => {
    if (typeof gd.removeListener === 'function') {
      gd.removeListener(event, handler);
    }
  };
}
