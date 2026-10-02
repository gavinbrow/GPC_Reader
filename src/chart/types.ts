/**
 * Public API of the canvas chart used throughout the app.
 *
 * The look deliberately mimics the classic ASTRA graphs: white plot area,
 * thin black frame, outward ticks, numeric labels with one decimal ("0.0",
 * "10.0"), small dotted series, a boxed legend with check boxes either above
 * the plot (horizontal) or at the right (vertical, scrollable), and grey
 * gradient shading for peak regions.
 */

/**
 * 'left' and 'right' are labelled axes. Any other id creates an independent,
 * unlabelled axis that autoscales its own series to the plot height (ASTRA
 * plots each detector type on its own scale this way).
 */
export type AxisId = 'left' | 'right' | (string & {});

export type SeriesStyle = 'line' | 'dots' | 'linedots' | 'dashed' | 'markers';

export interface ChartSeries {
  id: string;
  label: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  style?: SeriesStyle; // default 'line'
  lineWidth?: number; // default 1
  markerSize?: number; // for 'markers' (default 3) and 'dots' (default 1.5)
  axis?: AxisId; // default 'left'
  visible?: boolean; // default true (legend check box state)
  /** Hide from legend entirely (e.g. fit lines). */
  hideInLegend?: boolean;
  /** Optional symmetric error bars (same length as y). */
  yError?: ArrayLike<number>;
}

export interface AxisOptions {
  label?: string;
  log?: boolean;
  /** Fixed range; when omitted the axis autoscales to the visible data. */
  min?: number;
  max?: number;
  /** Extra fractional padding when autoscaling (default 0.04). */
  pad?: number;
  /** Force tick label formatter. Default: ASTRA style (see formatTick). */
  format?: (v: number) => string;
}

/** Shaded x-interval, e.g. a peak. Drawn behind the data. */
export interface ChartRegion {
  id: string;
  x1: number;
  x2: number;
  /** 'peak' = ASTRA grey vertical gradient; otherwise a flat fill colour. */
  kind?: 'peak' | 'flat';
  color?: string;
  label?: string;
  selected?: boolean;
  /** When true the two edges can be dragged (onRegionChange is called). */
  editable?: boolean;
}

/** A straight segment in data coordinates, e.g. a baseline. */
export interface ChartSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  axis?: AxisId;
  lineWidth?: number;
  dash?: number[];
  /** Draw small vertical end-caps and allow dragging the end points. */
  editable?: boolean;
}

/** Vertical marker line (e.g. the selected slice cursor). */
export interface ChartMarker {
  id: string;
  x: number;
  color?: string;
  dash?: number[];
  label?: string;
  draggable?: boolean;
}

export interface ChartProps {
  title?: string;
  series: ChartSeries[];
  xAxis?: AxisOptions;
  yAxis?: AxisOptions;
  y2Axis?: AxisOptions; // shown only if some visible series uses axis 'right'
  regions?: ChartRegion[];
  segments?: ChartSegment[];
  markers?: ChartMarker[];
  legend?: 'top' | 'right' | 'none';
  /** Small italic text drawn under the bottom-right of the plot ("Fit R²=0.99"). */
  footerRight?: string;
  footerLeft?: string;
  /** Normalise every visible series to its own max (ASTRA "Relative Scale"). */
  relativeScale?: boolean;

  /** Legend check box toggled. */
  onToggleSeries?: (id: string, visible: boolean) => void;
  /** Plain click in the plot (data coords of the left axis). */
  onClick?: (x: number, y: number) => void;
  onRegionChange?: (id: string, x1: number, x2: number, done: boolean) => void;
  onSegmentChange?: (id: string, seg: { x1: number; y1: number; x2: number; y2: number }, done: boolean) => void;
  onMarkerChange?: (id: string, x: number, done: boolean) => void;
  /** Called with the x-range of a new region dragged with Shift held (used to add peaks / baselines). */
  onCreateRegion?: (x1: number, x2: number) => void;

  /**
   * Interaction mode for left-drag in empty plot area. Default 'zoom'.
   * 'draw' makes a plain drag define a new x-range (onCreateRegion), like Shift+drag.
   */
  mode?: 'zoom' | 'pan' | 'select' | 'draw';
  /** Changing this number resets zoom to autoscale. */
  resetKey?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Imperative handle exposed via React ref. */
export interface ChartHandle {
  resetZoom(): void;
  zoomBy(factor: number): void;
  toPNG(): string; // data URL
}
