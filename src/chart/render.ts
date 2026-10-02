/**
 * Canvas rendering for the ASTRA-style chart. Pure drawing code (no React).
 */
import type { AxisOptions, ChartProps, ChartSeries } from './types';
import {
  niceTicks,
  logTicks,
  formatTick,
  formatLogTick,
  type TickLabel,
  type TickResult,
} from './ticks';

export const FONT_FAMILY = '"Segoe UI", Tahoma, Arial, sans-serif';
export const FONT = `12px ${FONT_FAMILY}`;
const FONT_BOLD = `bold 12px ${FONT_FAMILY}`;
const FONT_SMALL = `9px ${FONT_FAMILY}`;
const FONT_TITLE = `15px ${FONT_FAMILY}`;
const FONT_FOOTER = `italic bold 11px ${FONT_FAMILY}`;
const FONT_REGION = `11px ${FONT_FAMILY}`;

export const LEGEND_ROW_H = 17;
export const LEGEND_CB = 13;
export const LEGEND_SAMPLE = 16;

/* ------------------------------------------------------------------ */
/* Scales                                                              */
/* ------------------------------------------------------------------ */

export class Scale {
  readonly a: number;
  readonly b: number;
  constructor(
    readonly min: number,
    readonly max: number,
    readonly log: boolean,
    readonly p0: number,
    readonly p1: number,
  ) {
    this.a = log ? Math.log10(min) : min;
    this.b = log ? Math.log10(max) : max;
  }
  /** data -> pixel */
  map(v: number): number {
    const t = this.log ? Math.log10(v) : v;
    return this.p0 + ((t - this.a) / (this.b - this.a)) * (this.p1 - this.p0);
  }
  /** pixel -> data */
  inv(p: number): number {
    const t = this.a + ((p - this.p0) / (this.p1 - this.p0)) * (this.b - this.a);
    return this.log ? Math.pow(10, t) : t;
  }
}

export type Range = [number, number];

export interface View {
  x?: Range;
  y?: Range;
  y2?: Range;
}

export interface Frame {
  w: number;
  h: number;
  l: number;
  t: number;
  r: number;
  b: number;
  x: Scale;
  y: Scale;
  y2: Scale | null;
  /** Independent unlabelled axes keyed by axis id. */
  extra: Map<string, Scale>;
}

/** Scale used for a series/segment axis id. */
export function scaleFor(f: Frame, axis: string | undefined): Scale {
  if (axis === 'right') return f.y2 ?? f.y;
  if (!axis || axis === 'left') return f.y;
  return f.extra.get(axis) ?? f.y;
}

const isExtraAxis = (a: string | undefined) => !!a && a !== 'left' && a !== 'right';

/* ------------------------------------------------------------------ */
/* Text measuring helpers                                              */
/* ------------------------------------------------------------------ */

let measureCtx: CanvasRenderingContext2D | null = null;
export function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

function textWidth(ctx: CanvasRenderingContext2D | null, text: string, font = FONT): number {
  if (!ctx) return text.length * 6.5;
  ctx.font = font;
  return ctx.measureText(text).width;
}

function labelWidth(ctx: CanvasRenderingContext2D, l: TickLabel): number {
  ctx.font = FONT;
  let w = ctx.measureText(l.mantissa).width;
  if (l.exponent !== undefined) {
    ctx.font = FONT_SMALL;
    w += ctx.measureText(l.exponent).width + 1;
    ctx.font = FONT;
  }
  return w;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  l: TickLabel,
  x: number,
  y: number,
  align: 'left' | 'right' | 'center',
): void {
  const w = labelWidth(ctx, l);
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = FONT;
  ctx.fillText(l.mantissa, x0, y);
  if (l.exponent !== undefined) {
    const mw = ctx.measureText(l.mantissa).width;
    ctx.font = FONT_SMALL;
    ctx.fillText(l.exponent, x0 + mw + 1, y - 5);
    ctx.font = FONT;
  }
}

/* ------------------------------------------------------------------ */
/* Legend layout (shared with the DOM legend)                          */
/* ------------------------------------------------------------------ */

export interface LegendLayout {
  mode: 'top' | 'right' | 'none';
  entries: ChartSeries[];
  rows: ChartSeries[][];
  boxW: number;
  boxH: number;
  scroll: boolean;
}

const EMPTY_LEGEND: LegendLayout = { mode: 'none', entries: [], rows: [], boxW: 0, boxH: 0, scroll: false };

export function computeLegendLayout(
  props: Pick<ChartProps, 'series' | 'legend'>,
  w: number,
  maxRightH: number,
): LegendLayout {
  const mode = props.legend ?? 'top';
  const entries = props.series.filter((s) => !s.hideInLegend);
  if (mode === 'none' || entries.length === 0) return EMPTY_LEGEND;
  const ctx = getMeasureCtx();
  const tw = (s: ChartSeries) => textWidth(ctx, s.label);
  const fixed = LEGEND_CB + 5 + LEGEND_SAMPLE + 5;
  if (mode === 'right') {
    let maxT = 0;
    for (const s of entries) maxT = Math.max(maxT, tw(s));
    const contentH = entries.length * LEGEND_ROW_H + 6;
    const scroll = contentH > maxRightH;
    const boxW = Math.ceil(10 + fixed + maxT + 8 + (scroll ? 17 : 0));
    return {
      mode,
      entries,
      rows: [entries],
      boxW,
      boxH: Math.max(LEGEND_ROW_H + 6, Math.min(contentH, maxRightH)),
      scroll,
    };
  }
  const maxW = Math.max(120, w - 40);
  const rows: ChartSeries[][] = [];
  let cur: ChartSeries[] = [];
  let curW = 0;
  let widest = 0;
  for (const s of entries) {
    const ew = fixed + tw(s) + 14;
    if (cur.length > 0 && curW + ew > maxW) {
      rows.push(cur);
      widest = Math.max(widest, curW);
      cur = [];
      curW = 0;
    }
    cur.push(s);
    curW += ew;
  }
  if (cur.length) {
    rows.push(cur);
    widest = Math.max(widest, curW);
  }
  return { mode, entries, rows, boxW: Math.ceil(widest + 6), boxH: rows.length * LEGEND_ROW_H + 6, scroll: false };
}

/** Legend width reserved by the right-hand legend including the gap. */
export function legendReserve(l: LegendLayout): number {
  return l.mode === 'right' ? l.boxW + 8 : 0;
}

/* ------------------------------------------------------------------ */
/* Ranges / autoscale                                                  */
/* ------------------------------------------------------------------ */

function isVisible(s: ChartSeries): boolean {
  return s.visible !== false;
}

function seriesFactor(s: ChartSeries, relative: boolean): number {
  if (!relative) return 1;
  const y = s.y;
  let m = 0;
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (Number.isFinite(v)) {
      const a = Math.abs(v);
      if (a > m) m = a;
    }
  }
  return m > 0 ? 1 / m : 1;
}

export function usesRightAxis(series: ChartSeries[]): boolean {
  return series.some((s) => isVisible(s) && s.axis === 'right');
}

interface Ext {
  lo: number;
  hi: number;
}

function finalizeRange(
  ext: Ext,
  log: boolean,
  pad: number,
  fixedMin: number | undefined,
  fixedMax: number | undefined,
  noTopPadIf1: boolean,
): Range {
  let lo = ext.lo;
  let hi = ext.hi;
  if (!(lo <= hi) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = log ? 1 : 0;
    hi = log ? 10 : 1;
  }
  const hadTop1 = noTopPadIf1 && Math.abs(hi - 1) < 1e-9;
  if (log) {
    let l0 = Math.log10(lo);
    let l1 = Math.log10(hi);
    if (fixedMin !== undefined && fixedMin > 0) l0 = Math.log10(fixedMin);
    if (fixedMax !== undefined && fixedMax > 0) l1 = Math.log10(fixedMax);
    if (l1 - l0 < 1e-9) {
      l0 -= 0.5;
      l1 += 0.5;
    } else {
      const p = (l1 - l0) * pad;
      if (fixedMin === undefined) l0 -= p;
      if (fixedMax === undefined && !hadTop1) l1 += p;
    }
    return [Math.pow(10, l0), Math.pow(10, l1)];
  }
  if (fixedMin !== undefined) lo = fixedMin;
  if (fixedMax !== undefined) hi = fixedMax;
  if (hi - lo <= Math.abs(hi + lo) * 1e-12) {
    const d = Math.abs(hi) * 0.05 || 0.5;
    return [lo - d, hi + d];
  }
  const p = (hi - lo) * pad;
  if (fixedMin === undefined) lo -= p;
  if (fixedMax === undefined && !hadTop1) hi += p;
  return [lo, hi];
}

export interface Ranges {
  x: Range;
  y: Range;
  y2: Range | null;
  extra: Map<string, Range>;
  factors: Map<string, number>;
}

export function computeRanges(props: ChartProps, view: View): Ranges {
  const { series, xAxis, yAxis, y2Axis } = props;
  const relative = !!props.relativeScale;
  const xlog = !!xAxis?.log;
  const ylog = !!yAxis?.log;
  const y2log = !!y2Axis?.log;
  const factors = new Map<string, number>();
  const vis = series.filter(isVisible);
  for (const s of vis) factors.set(s.id, seriesFactor(s, relative));

  // X range.
  let x: Range;
  if (view.x) {
    x = view.x;
  } else {
    const ext: Ext = { lo: Infinity, hi: -Infinity };
    for (const s of vis) {
      const n = Math.min(s.x.length, s.y.length);
      const sx = s.x;
      const sy = s.y;
      const sl = (s.axis === 'right' ? y2log : ylog);
      for (let i = 0; i < n; i++) {
        const xv = sx[i];
        const yv = sy[i];
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
        if (xlog && xv <= 0) continue;
        if (sl && yv <= 0) continue;
        if (xv < ext.lo) ext.lo = xv;
        if (xv > ext.hi) ext.hi = xv;
      }
    }
    x = finalizeRange(ext, xlog, xAxis?.pad ?? 0, xAxis?.min, xAxis?.max, false);
  }
  const xlo = Math.min(x[0], x[1]);
  const xhi = Math.max(x[0], x[1]);

  const axisKey = (a: string | undefined) => (a === 'right' ? 'right' : isExtraAxis(a) ? (a as string) : 'left');
  const yRange = (axis: string, opt: AxisOptions | undefined, log: boolean, v: Range | undefined): Range => {
    if (v) return v;
    const ext: Ext = { lo: Infinity, hi: -Infinity };
    for (const s of vis) {
      if (axisKey(s.axis) !== axis) continue;
      const f = factors.get(s.id) ?? 1;
      const n = Math.min(s.x.length, s.y.length);
      const sx = s.x;
      const sy = s.y;
      const err = s.yError;
      for (let i = 0; i < n; i++) {
        const xv = sx[i];
        if (!(xv >= xlo && xv <= xhi)) continue;
        const yv = sy[i] * f;
        if (!Number.isFinite(yv)) continue;
        if (log && yv <= 0) continue;
        let lo = yv;
        let hi = yv;
        if (err) {
          const e = Math.abs(err[i] * f);
          if (Number.isFinite(e)) {
            hi = yv + e;
            lo = yv - e;
            if (log && lo <= 0) lo = yv;
          }
        }
        if (lo < ext.lo) ext.lo = lo;
        if (hi > ext.hi) ext.hi = hi;
      }
    }
    return finalizeRange(ext, log, opt?.pad ?? 0.04, opt?.min, opt?.max, relative);
  };

  const y = yRange('left', yAxis, ylog, view.y);
  const y2 = usesRightAxis(series) ? yRange('right', y2Axis, y2log, view.y2) : null;
  const extra = new Map<string, Range>();
  for (const s of vis) {
    if (isExtraAxis(s.axis) && !extra.has(s.axis as string)) extra.set(s.axis as string, yRange(s.axis as string, undefined, false, undefined));
  }
  return { x, y, y2, extra, factors };
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

function hasFooter(p: ChartProps): boolean {
  return !!(p.footerLeft || p.footerRight);
}

export function baseMargins(props: ChartProps, topLegendH: number): { top: number; bottom: number } {
  const top = (props.title ? 30 : 10) + (topLegendH > 0 ? topLegendH + 8 : 0);
  const bottom = 8 + 14 + 6 + (props.xAxis?.label ? 18 : 0) + 6 + (hasFooter(props) ? 16 : 0) + (props.xAxis?.log ? 4 : 0);
  return { top, bottom };
}

/** Compute legend + margins for the given size (used by the component and the renderer). */
export function planLayout(props: ChartProps, w: number, h: number): { legend: LegendLayout; top: number; bottom: number } {
  let legend = computeLegendLayout(props, w, 0);
  if (legend.mode === 'top') {
    const m = baseMargins(props, legend.boxH);
    return { legend, ...m };
  }
  const m = baseMargins(props, 0);
  if (legend.mode === 'right') {
    legend = computeLegendLayout(props, w, Math.max(60, h - m.top - m.bottom));
  }
  return { legend, ...m };
}

function axisTicks(sc: Scale, log: boolean, maxTicks: number): TickResult & { linear: boolean } {
  if (log) return logTicks(sc.min, sc.max, Math.max(3, maxTicks));
  return { ...niceTicks(sc.min, sc.max, maxTicks), linear: true };
}

function tickLabels(
  axis: AxisOptions | undefined,
  t: TickResult & { linear: boolean },
  log: boolean,
): TickLabel[] {
  const fmt = axis?.format;
  if (fmt) return t.ticks.map((v) => ({ mantissa: fmt(v) }));
  if (log && !t.linear) return t.ticks.map((v) => formatLogTick(v));
  return t.ticks.map((v) => formatTick(v, t.step));
}

/* ------------------------------------------------------------------ */
/* Main draw                                                           */
/* ------------------------------------------------------------------ */

const clampPx = (v: number): number => (v > 1e5 ? 1e5 : v < -1e5 ? -1e5 : v);

export function drawChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  props: ChartProps,
  view: View,
  plan: { legend: LegendLayout; top: number; bottom: number },
): Frame {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const ranges = computeRanges(props, view);
  const xlog = !!props.xAxis?.log;
  const ylog = !!props.yAxis?.log;
  const y2log = !!props.y2Axis?.log;

  const plotT = Math.round(plan.top);
  const plotB = Math.max(plotT + 20, Math.round(h - plan.bottom));
  const plotH = plotB - plotT;

  // Y ticks first: their label widths determine the margins.
  const yTmp = new Scale(ranges.y[0], ranges.y[1], ylog, plotB, plotT);
  const yTicks = axisTicks(yTmp, ylog, Math.max(2, Math.floor(plotH / 45) + 1));
  const yLabels = tickLabels(props.yAxis, yTicks, ylog);
  let maxLW = 0;
  for (const l of yLabels) maxLW = Math.max(maxLW, labelWidth(ctx, l));

  let y2Ticks: (TickResult & { linear: boolean }) | null = null;
  let y2Labels: TickLabel[] = [];
  let maxLW2 = 0;
  if (ranges.y2) {
    const y2Tmp = new Scale(ranges.y2[0], ranges.y2[1], y2log, plotB, plotT);
    y2Ticks = axisTicks(y2Tmp, y2log, Math.max(2, Math.floor(plotH / 45) + 1));
    y2Labels = tickLabels(props.y2Axis, y2Ticks, y2log);
    for (const l of y2Labels) maxLW2 = Math.max(maxLW2, labelWidth(ctx, l));
  }

  const leftM = 10 + (props.yAxis?.label ? 18 : 0) + maxLW + 10;
  let rightM = 10 + legendReserve(plan.legend);
  if (ranges.y2) rightM += 10 + maxLW2 + (props.y2Axis?.label ? 22 : 4);
  rightM = Math.max(rightM, 18);

  const plotL = Math.round(leftM);
  const plotR = Math.max(plotL + 20, Math.round(w - rightM));
  const plotW = plotR - plotL;

  const xs = new Scale(ranges.x[0], ranges.x[1], xlog, plotL, plotR);
  const ys = new Scale(ranges.y[0], ranges.y[1], ylog, plotB, plotT);
  const y2s = ranges.y2 ? new Scale(ranges.y2[0], ranges.y2[1], y2log, plotB, plotT) : null;
  const extra = new Map<string, Scale>();
  ranges.extra.forEach((rg, id) => extra.set(id, new Scale(rg[0], rg[1], false, plotB, plotT)));
  const frame: Frame = { w, h, l: plotL, t: plotT, r: plotR, b: plotB, x: xs, y: ys, y2: y2s, extra };

  /* ---- title ---- */
  const cx = (plotL + plotR) / 2;
  if (props.title) {
    ctx.fillStyle = '#000';
    ctx.font = FONT_TITLE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(props.title, cx, 15);
  }

  /* ---- clipped plot content ---- */
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotL, plotT, plotW, plotH);
  ctx.clip();

  // Regions (behind data).
  for (const r of props.regions ?? []) {
    const a = xs.map(Math.min(r.x1, r.x2));
    const b = xs.map(Math.max(r.x1, r.x2));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (b < plotL - 1 || a > plotR + 1) continue;
    const x0 = clampPx(a);
    const x1 = clampPx(b);
    if (r.kind === 'flat') {
      ctx.globalAlpha = r.selected ? 0.4 : 0.25;
      ctx.fillStyle = r.color ?? '#9aa7b8';
      ctx.fillRect(x0, plotT, x1 - x0, plotH);
      ctx.globalAlpha = 1;
    } else {
      const g = ctx.createLinearGradient(0, plotT, 0, plotB);
      g.addColorStop(0, r.selected ? '#b4b4b4' : '#c9c9c9');
      g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g;
      ctx.fillRect(x0, plotT, x1 - x0, plotH);
    }
    ctx.strokeStyle = r.selected ? '#6a6a6a' : '#8c8c8c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const px of [a, b]) {
      const xp = Math.round(px) + 0.5;
      ctx.moveTo(xp, plotT);
      ctx.lineTo(xp, plotB);
    }
    ctx.stroke();
    if (r.label) {
      ctx.fillStyle = '#333';
      ctx.font = FONT_REGION;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const mid = Math.min(Math.max((x0 + x1) / 2, plotL + 20), plotR - 20);
      ctx.fillText(r.label, mid, plotT + 10);
    }
  }

  // Series.
  for (const s of props.series) {
    if (!isVisible(s)) continue;
    const useY = scaleFor(frame, s.axis);
    drawSeries(ctx, s, ranges.factors.get(s.id) ?? 1, xs, useY, frame, xlog, useY.log);
  }

  // Segments.
  for (const sg of props.segments ?? []) {
    const sy = scaleFor(frame, sg.axis);
    const ax = xs.map(sg.x1);
    const bx = xs.map(sg.x2);
    const ay = sy.map(sg.y1);
    const by = sy.map(sg.y2);
    if (![ax, bx, ay, by].every(Number.isFinite)) continue;
    ctx.strokeStyle = sg.color;
    ctx.lineWidth = sg.lineWidth ?? 1.5;
    ctx.setLineDash(sg.dash ?? []);
    ctx.beginPath();
    ctx.moveTo(clampPx(ax), clampPx(ay));
    ctx.lineTo(clampPx(bx), clampPx(by));
    ctx.stroke();
    ctx.setLineDash([]);
    if (sg.editable) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 5);
      ctx.lineTo(ax, ay + 5);
      ctx.moveTo(bx, by - 5);
      ctx.lineTo(bx, by + 5);
      ctx.stroke();
    }
  }

  // Markers.
  for (const m of props.markers ?? []) {
    const mx = xs.map(m.x);
    if (!Number.isFinite(mx)) continue;
    const xp = Math.round(mx) + 0.5;
    ctx.strokeStyle = m.color ?? '#444';
    ctx.lineWidth = 1;
    ctx.setLineDash(m.dash ?? [4, 3]);
    ctx.beginPath();
    ctx.moveTo(xp, plotT);
    ctx.lineTo(xp, plotB);
    ctx.stroke();
    ctx.setLineDash([]);
    if (m.label) {
      ctx.fillStyle = m.color ?? '#444';
      ctx.font = FONT_REGION;
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(m.label).width;
      const left = xp + 4 + tw > plotR;
      ctx.textAlign = left ? 'right' : 'left';
      ctx.fillText(m.label, left ? xp - 4 : xp + 4, plotT + 4);
    }
  }
  ctx.restore();

  /* ---- frame ---- */
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(plotL + 0.5, plotT + 0.5, plotW - 1, plotH - 1);

  // Region edge stubs below the frame (ASTRA draws short dashes there).
  ctx.strokeStyle = '#8c8c8c';
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  for (const r of props.regions ?? []) {
    for (const v of [r.x1, r.x2]) {
      const px = xs.map(v);
      if (px >= plotL && px <= plotR) {
        const xp = Math.round(px) + 0.5;
        ctx.moveTo(xp, plotB);
        ctx.lineTo(xp, plotB + 8);
      }
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  /* ---- ticks ---- */
  ctx.strokeStyle = '#000';
  const MAJ = 6;
  const MIN = 3;
  // X axis.
  const xMaxTicks = Math.max(2, Math.floor(plotW / 85) + 1);
  const xTicks = axisTicks(xs, xlog, xMaxTicks);
  const xLabels = tickLabels(props.xAxis, xTicks, xlog);
  ctx.beginPath();
  for (const m of xTicks.minor) {
    const p = Math.round(xs.map(m)) + 0.5;
    if (p < plotL || p > plotR) continue;
    ctx.moveTo(p, plotB - 1);
    ctx.lineTo(p, plotB - 1 - MIN);
  }
  for (const v of xTicks.ticks) {
    const p = Math.round(xs.map(v)) + 0.5;
    if (p < plotL || p > plotR) continue;
    ctx.moveTo(p, plotB - 1);
    ctx.lineTo(p, plotB - 1 - MAJ);
  }
  // Y axis (left).
  const drawYTicks = (sc: Scale, t: TickResult, side: 'l' | 'r') => {
    const x0 = side === 'l' ? plotL + 1 : plotR - 1;
    const dir = side === 'l' ? 1 : -1;
    for (const m of t.minor) {
      const p = Math.round(sc.map(m)) + 0.5;
      if (p < plotT || p > plotB) continue;
      ctx.moveTo(x0, p);
      ctx.lineTo(x0 + dir * MIN, p);
    }
    for (const v of t.ticks) {
      const p = Math.round(sc.map(v)) + 0.5;
      if (p < plotT || p > plotB) continue;
      ctx.moveTo(x0, p);
      ctx.lineTo(x0 + dir * MAJ, p);
    }
  };
  drawYTicks(ys, yTicks, 'l');
  if (y2s && y2Ticks) drawYTicks(y2s, y2Ticks, 'r');
  ctx.stroke();

  /* ---- tick labels ---- */
  ctx.fillStyle = '#000';
  // X labels (skip overlapping ones).
  let lastRight = -Infinity;
  for (let i = 0; i < xTicks.ticks.length; i++) {
    const px = xs.map(xTicks.ticks[i]);
    if (px < plotL - 2 || px > plotR + 2) continue;
    const lw = labelWidth(ctx, xLabels[i]);
    if (px - lw / 2 < lastRight + 8) continue;
    drawLabel(ctx, xLabels[i], px, plotB + 15, 'center');
    lastRight = px + lw / 2;
  }
  // Left labels.
  for (let i = 0; i < yTicks.ticks.length; i++) {
    const py = ys.map(yTicks.ticks[i]);
    if (py < plotT - 3 || py > plotB + 3) continue;
    drawLabel(ctx, yLabels[i], plotL - 8, py, 'right');
  }
  if (y2s && y2Ticks) {
    for (let i = 0; i < y2Ticks.ticks.length; i++) {
      const py = y2s.map(y2Ticks.ticks[i]);
      if (py < plotT - 3 || py > plotB + 3) continue;
      drawLabel(ctx, y2Labels[i], plotR + 8, py, 'left');
    }
  }

  /* ---- axis titles ---- */
  ctx.font = FONT_BOLD;
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (props.xAxis?.label) {
    ctx.fillText(props.xAxis.label, cx, plotB + 8 + 14 + 8 + (xlog ? 4 : 0) + 4);
  }
  if (props.yAxis?.label) {
    ctx.save();
    ctx.translate(14, (plotT + plotB) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(props.yAxis.label, 0, 0);
    ctx.restore();
  }
  if (y2s && props.y2Axis?.label) {
    ctx.save();
    ctx.translate(plotR + 8 + maxLW2 + 16, (plotT + plotB) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(props.y2Axis.label, 0, 0);
    ctx.restore();
  }

  /* ---- footers ---- */
  if (hasFooter(props)) {
    ctx.font = FONT_FOOTER;
    ctx.textBaseline = 'middle';
    const fy = h - 10;
    if (props.footerLeft) {
      ctx.textAlign = 'left';
      ctx.fillText(props.footerLeft, plotL, fy);
    }
    if (props.footerRight) {
      ctx.textAlign = 'right';
      ctx.fillText(props.footerRight, plotR, fy);
    }
  }

  ctx.restore();
  return frame;
}

/* ------------------------------------------------------------------ */
/* Series                                                              */
/* ------------------------------------------------------------------ */

function drawSeries(
  ctx: CanvasRenderingContext2D,
  s: ChartSeries,
  f: number,
  xs: Scale,
  ys: Scale,
  frame: Frame,
  xlog: boolean,
  ylog: boolean,
): void {
  const n = Math.min(s.x.length, s.y.length);
  if (n === 0) return;
  const style = s.style ?? 'line';
  const sx = s.x;
  const sy = s.y;
  const lw = s.lineWidth ?? 1;
  const plotW = frame.r - frame.l;
  const { l, r, t, b } = frame;

  const wantLine = style === 'line' || style === 'linedots' || style === 'dashed';
  const wantDots = style === 'dots' || style === 'linedots';

  if (wantLine) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.setLineDash(style === 'dashed' ? [6, 4] : []);
    ctx.beginPath();
    const decimate = n > plotW * 2 && style !== 'dashed';
    let pen = false;
    if (!decimate) {
      for (let i = 0; i < n; i++) {
        const xv = sx[i];
        const yv = sy[i] * f;
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || (xlog && xv <= 0) || (ylog && yv <= 0)) {
          pen = false;
          continue;
        }
        const px = clampPx(xs.map(xv));
        const py = clampPx(ys.map(yv));
        if (pen) ctx.lineTo(px, py);
        else {
          ctx.moveTo(px, py);
          pen = true;
        }
      }
    } else {
      // Min/max decimation per pixel column.
      let runActive = false;
      let col = 0;
      let yFirst = 0;
      let yLast = 0;
      let yMin = 0;
      let yMax = 0;
      let iMin = 0;
      let iMax = 0;
      let cnt = 0;
      const emit = (x: number, y: number) => {
        if (pen) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          pen = true;
        }
      };
      const flush = () => {
        if (!runActive) return;
        const x = col + 0.5;
        emit(x, yFirst);
        if (cnt > 1) {
          if (iMin < iMax) {
            emit(x, yMin);
            emit(x, yMax);
          } else {
            emit(x, yMax);
            emit(x, yMin);
          }
          emit(x, yLast);
        }
        runActive = false;
      };
      for (let i = 0; i < n; i++) {
        const xv = sx[i];
        const yv = sy[i] * f;
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || (xlog && xv <= 0) || (ylog && yv <= 0)) {
          flush();
          pen = false;
          continue;
        }
        const px = clampPx(xs.map(xv));
        const py = clampPx(ys.map(yv));
        const c = Math.floor(px);
        if (runActive && c === col) {
          cnt++;
          yLast = py;
          if (py < yMin) {
            yMin = py;
            iMin = cnt;
          }
          if (py > yMax) {
            yMax = py;
            iMax = cnt;
          }
        } else {
          flush();
          runActive = true;
          col = c;
          yFirst = yLast = yMin = yMax = py;
          iMin = iMax = 0;
          cnt = 1;
        }
      }
      flush();
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (wantDots) {
    ctx.fillStyle = s.color;
    const size = Math.max(1.5, s.markerSize ?? 1.5);
    const half = size / 2;
    for (let i = 0; i < n; i++) {
      const xv = sx[i];
      const yv = sy[i] * f;
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || (xlog && xv <= 0) || (ylog && yv <= 0)) continue;
      const px = xs.map(xv);
      if (px < l - 4 || px > r + 4) continue;
      const py = ys.map(yv);
      if (py < t - 4 || py > b + 4) continue;
      ctx.fillRect(px - half, py - half, size, size);
    }
  }

  if (style === 'markers') {
    ctx.fillStyle = s.color;
    const size = (s.markerSize ?? 3) + 1;
    const half = size / 2;
    const circles = n <= 4000;
    for (let i = 0; i < n; i++) {
      const xv = sx[i];
      const yv = sy[i] * f;
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || (xlog && xv <= 0) || (ylog && yv <= 0)) continue;
      const px = xs.map(xv);
      const py = ys.map(yv);
      if (px < l - 6 || px > r + 6 || py < t - 6 || py > b + 6) continue;
      if (circles) {
        ctx.beginPath();
        ctx.arc(px, py, half, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(px - half, py - half, size, size);
      }
    }
  }

  if (s.yError) {
    const err = s.yError;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const xv = sx[i];
      const yv = sy[i] * f;
      const e = Math.abs(err[i] * f);
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(e) || e === 0) continue;
      if ((xlog && xv <= 0) || (ylog && yv <= 0)) continue;
      const px = xs.map(xv);
      if (px < l - 4 || px > r + 4) continue;
      const hi = yv + e;
      let lo = yv - e;
      if (ylog && lo <= 0) lo = yv;
      const p1 = clampPx(ys.map(hi));
      const p2 = clampPx(ys.map(lo));
      const xp = Math.round(px) + 0.5;
      ctx.moveTo(xp, p1);
      ctx.lineTo(xp, p2);
      ctx.moveTo(xp - 2.5, p1);
      ctx.lineTo(xp + 2.5, p1);
      ctx.moveTo(xp - 2.5, p2);
      ctx.lineTo(xp + 2.5, p2);
    }
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* Canvas legend (only used for PNG export; the live legend is DOM)    */
/* ------------------------------------------------------------------ */

export function drawLegendCanvas(ctx: CanvasRenderingContext2D, legend: LegendLayout, frame: Frame): void {
  if (legend.mode === 'none') return;
  ctx.save();
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const right = legend.mode === 'right';
  const left = right ? frame.w - legend.boxW - 6 : Math.round((frame.l + frame.r) / 2 - legend.boxW / 2);
  const top = right ? frame.t : frame.t - legend.boxH - 8;
  ctx.fillStyle = '#fff';
  ctx.fillRect(left, top, legend.boxW, legend.boxH);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, legend.boxW - 1, legend.boxH - 1);
  const rows: ChartSeries[][] = right ? legend.entries.map((e) => [e]) : legend.rows;
  const maxRows = Math.floor((legend.boxH - 6) / LEGEND_ROW_H);
  for (let ri = 0; ri < rows.length && ri < maxRows; ri++) {
    let x = left + 5;
    const y = top + 3 + ri * LEGEND_ROW_H + LEGEND_ROW_H / 2;
    for (const s of rows[ri]) {
      ctx.strokeStyle = '#777';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y - 6, LEGEND_CB - 1, LEGEND_CB - 1);
      if (s.visible !== false) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 3, y);
        ctx.lineTo(x + 5.5, y + 3);
        ctx.lineTo(x + 10, y - 3.5);
        ctx.stroke();
      }
      const sx0 = x + LEGEND_CB + 5;
      ctx.fillStyle = s.color;
      const st = s.style ?? 'line';
      if (st === 'dots' || st === 'markers') ctx.fillRect(sx0 + LEGEND_SAMPLE / 2 - 1.5, y - 1.5, 3, 3);
      else ctx.fillRect(sx0, y - 0.5, LEGEND_SAMPLE, 1.5);
      ctx.fillStyle = '#000';
      ctx.fillText(s.label, sx0 + LEGEND_SAMPLE + 5, y);
      x += LEGEND_CB + 5 + LEGEND_SAMPLE + 5 + textWidth(ctx, s.label) + 14;
    }
  }
  ctx.restore();
}
