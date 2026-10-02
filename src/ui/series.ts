import type { RawSeries } from '../afe8/types';
import type { ChartSeries, SeriesStyle } from '../chart/types';

const LS_PALETTE = ['#e53935', '#8e24aa', '#3949ab', '#00897b', '#d00000', '#f4511e', '#6d4c41', '#c0ca33', '#5e35b1', '#039be5', '#43a047', '#fb8c00', '#d81b60', '#546e7a', '#7cb342', '#00acc1', '#ffb300', '#8d6e63'];

/** ASTRA colour conventions: LS red dots, UV green dots, dRI blue line, VIS black line. */
export function seriesColor(s: RawSeries, isLs90 = false): string {
  if (s.kind === 'LS' && s.detector) return isLs90 ? '#ff0000' : LS_PALETTE[(s.detector - 1) % LS_PALETTE.length];
  if (s.kind === 'UV') return s.channel === 1 ? '#00b000' : '#2e7d32';
  if (s.id === 'dRI') return '#0000ff';
  if (s.id === 'VIS') return '#000000';
  if (s.id === 'FM') return '#8e24aa';
  if (s.id.includes('Pressure')) return '#000000';
  if (s.id.includes('Flow')) return '#795548';
  if (s.id.includes('Ripple')) return '#9e9e9e';
  return '#607d8b';
}

export function seriesStyle(s: RawSeries): SeriesStyle {
  if (s.kind === 'LS' || s.kind === 'UV' || s.kind === 'HPLC') return 'dots';
  return 'line';
}

/** Axis family used in raw-data graphs. */
export function rawAxis(s: RawSeries, rightFamily: 'hplc' | 'uv'): string {
  if (s.kind === 'LS' && s.detector) return 'left';
  if (s.kind === 'AUX') return 'left';
  if (s.kind === 'UV') return rightFamily === 'uv' ? 'right' : 'uv';
  if (s.kind === 'HPLC') return rightFamily === 'hplc' ? 'right' : `hplc:${s.id}`;
  return `axis:${s.id}`;
}

export function toChartSeries(
  s: RawSeries,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: { visible?: boolean; axis?: string; ls90?: boolean; label?: string } = {},
): ChartSeries {
  return {
    id: s.id,
    label: opts.label ?? s.label,
    x,
    y,
    color: seriesColor(s, opts.ls90),
    style: seriesStyle(s),
    axis: opts.axis ?? 'left',
    visible: opts.visible ?? !!s.defaultVisible,
  };
}

/** Group label used in relative-scale graphs ("LS", "UV", "dRI", "VIS"). */
export function familyLabel(s: RawSeries): string {
  if (s.kind === 'LS') return 'LS';
  if (s.kind === 'UV') return 'UV';
  if (s.id === 'dRI') return 'dRI';
  if (s.id === 'VIS') return 'VIS';
  return s.label;
}
