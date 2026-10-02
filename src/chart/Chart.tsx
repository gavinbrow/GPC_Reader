import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactElement } from 'react';
import type { ChartHandle, ChartProps, ChartSeries } from './types';
import {
  Scale,
  drawChart,
  scaleFor,
  drawLegendCanvas,
  planLayout,
  type Frame,
  type Range,
  type View,
} from './render';
import { formatReadout } from './ticks';
import './chart.css';

type Plan = ReturnType<typeof planLayout>;

type Hit =
  | { kind: 'marker'; id: string; cursor: string }
  | { kind: 'segment'; id: string; part: 'p1' | 'p2' | 'move'; cursor: string }
  | { kind: 'region'; id: string; part: 'x1' | 'x2' | 'move'; cursor: string };

interface Drag {
  kind: 'zoom' | 'xband' | 'pan' | 'region' | 'segment' | 'marker' | 'none';
  button: number;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  moved: boolean;
  hit?: Hit;
  // snapshots
  pan?: { x: Scale; y: Scale; y2: Scale | null };
  orig?: { x1: number; x2: number; y1: number; y2: number; x: number };
  last?: { x1: number; x2: number; y1: number; y2: number; x: number };
}

const MIN_DRAG = 4;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Zoom a scale's range about the fractional position `frac` by `factor` (>1 zooms in). */
function zoomScale(sc: Scale, frac: number, factor: number): Range | null {
  const span = sc.b - sc.a;
  const c = sc.a + frac * span;
  const a = c - (c - sc.a) / factor;
  const b = c + (sc.b - c) / factor;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(b - a) < 1e-12 * Math.max(1e-300, Math.abs(a) + Math.abs(b))) return null;
  return sc.log ? [Math.pow(10, a), Math.pow(10, b)] : [a, b];
}

function shiftScale(sc: Scale, dPx: number): Range {
  const dt = (-dPx / (sc.p1 - sc.p0)) * (sc.b - sc.a);
  const a = sc.a + dt;
  const b = sc.b + dt;
  return sc.log ? [Math.pow(10, a), Math.pow(10, b)] : [a, b];
}

function LegendItem({
  s,
  onToggle,
}: {
  s: ChartSeries;
  onToggle?: (id: string, visible: boolean) => void;
}): ReactElement {
  const checked = s.visible !== false;
  const st = s.style ?? 'line';
  const dotOnly = st === 'dots' || st === 'markers';
  return (
    <div
      className="gc-li"
      role="checkbox"
      aria-checked={checked}
      title={s.label}
      onClick={() => onToggle?.(s.id, !checked)}
    >
      <span className={'gc-cb' + (checked ? ' on' : '')} />
      <span className="gc-sample">
        {dotOnly ? (
          <i className="gc-dot" style={{ background: s.color }} />
        ) : st === 'dashed' ? (
          <i className="gc-line" style={{ borderTop: `2px dashed ${s.color}`, height: 0 }} />
        ) : (
          <i className="gc-line" style={{ background: s.color }} />
        )}
      </span>
      <span className="gc-lbl">{s.label}</span>
    </div>
  );
}

export const Chart = forwardRef<ChartHandle, ChartProps>(function Chart(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const topLegendRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const propsRef = useRef(props);
  propsRef.current = props;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const viewRef = useRef<View>({});
  const frameRef = useRef<Frame | null>(null);
  const planRef = useRef<Plan | null>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rafBase = useRef(0);
  const rafOver = useRef(0);

  /* ---------------- drawing ---------------- */

  const drawOverlay = useCallback(() => {
    rafOver.current = 0;
    const cv = overRef.current;
    const f = frameRef.current;
    const { w, h } = sizeRef.current;
    if (!cv || !f || w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (cv.width !== cw || cv.height !== ch) {
      cv.width = cw;
      cv.height = ch;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const d = dragRef.current;
    const clampX = (v: number) => Math.min(Math.max(v, f.l), f.r);
    const clampY = (v: number) => Math.min(Math.max(v, f.t), f.b);
    let showReadout = true;
    if (d && d.moved && (d.kind === 'zoom' || d.kind === 'xband')) {
      const x0 = clampX(Math.min(d.sx, d.cx));
      const x1 = clampX(Math.max(d.sx, d.cx));
      const y0 = d.kind === 'xband' ? f.t : clampY(Math.min(d.sy, d.cy));
      const y1 = d.kind === 'xband' ? f.b : clampY(Math.max(d.sy, d.cy));
      ctx.fillStyle = d.kind === 'xband' ? 'rgba(60,110,200,0.10)' : 'rgba(0,0,0,0.04)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
      ctx.setLineDash([]);
      showReadout = false;
    }
    const hv = hoverRef.current;
    if (hv && showReadout && hv.x >= f.l && hv.x <= f.r && hv.y >= f.t && hv.y <= f.b) {
      const xv = f.x.inv(hv.x);
      const yv = f.y.inv(hv.y);
      const text = `x = ${formatReadout(xv)}, y = ${formatReadout(yv)}`;
      ctx.font = '11px "Segoe UI", Tahoma, Arial, sans-serif';
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(f.l + 6, f.t + 6, tw + 10, 18);
      ctx.strokeStyle = '#9a9a9a';
      ctx.lineWidth = 1;
      ctx.strokeRect(f.l + 6.5, f.t + 6.5, tw + 9, 17);
      ctx.fillStyle = '#000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, f.l + 11, f.t + 15.5);
    }
  }, []);

  const scheduleOverlay = useCallback(() => {
    if (!rafOver.current) rafOver.current = requestAnimationFrame(drawOverlay);
  }, [drawOverlay]);

  const drawBase = useCallback(() => {
    rafBase.current = 0;
    const cv = baseRef.current;
    const { w, h } = sizeRef.current;
    if (!cv || w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (cv.width !== cw || cv.height !== ch) {
      cv.width = cw;
      cv.height = ch;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = propsRef.current;
    const plan = planLayout(p, w, h);
    planRef.current = plan;
    frameRef.current = drawChart(ctx, w, h, p, viewRef.current, plan);
    const tl = topLegendRef.current;
    if (tl && frameRef.current) {
      tl.style.left = `${(frameRef.current.l + frameRef.current.r) / 2}px`;
    }
    drawOverlay();
  }, [drawOverlay]);

  const scheduleBase = useCallback(() => {
    if (!rafBase.current) rafBase.current = requestAnimationFrame(drawBase);
  }, [drawBase]);

  // Redraw after every render (props are usually new objects) and on size change.
  useEffect(() => {
    scheduleBase();
  });

  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    viewRef.current = {};
    scheduleBase();
  }, [props.resetKey, scheduleBase]);

  useEffect(
    () => () => {
      if (rafBase.current) cancelAnimationFrame(rafBase.current);
      if (rafOver.current) cancelAnimationFrame(rafOver.current);
      rafBase.current = 0;
      rafOver.current = 0;
    },
    [],
  );

  /* ---------------- resize ---------------- */

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------- helpers ---------------- */

  const local = (e: { clientX: number; clientY: number }) => {
    const r = overRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const inPlot = (f: Frame, x: number, y: number) => x >= f.l && x <= f.r && y >= f.t && y <= f.b;

  const hitTest = (f: Frame, px: number, py: number): Hit | null => {
    const p = propsRef.current;
    for (const m of p.markers ?? []) {
      if (!m.draggable) continue;
      if (Math.abs(f.x.map(m.x) - px) <= 5) return { kind: 'marker', id: m.id, cursor: 'ew-resize' };
    }
    for (const sg of p.segments ?? []) {
      if (!sg.editable) continue;
      const sy = scaleFor(f, sg.axis);
      const ax = f.x.map(sg.x1);
      const ay = sy.map(sg.y1);
      const bx = f.x.map(sg.x2);
      const by = sy.map(sg.y2);
      if (Math.hypot(px - ax, py - ay) <= 8) return { kind: 'segment', id: sg.id, part: 'p1', cursor: 'move' };
      if (Math.hypot(px - bx, py - by) <= 8) return { kind: 'segment', id: sg.id, part: 'p2', cursor: 'move' };
      if (distToSegment(px, py, ax, ay, bx, by) <= 5) return { kind: 'segment', id: sg.id, part: 'move', cursor: 'move' };
    }
    for (const r of p.regions ?? []) {
      if (!r.editable) continue;
      const a = f.x.map(Math.min(r.x1, r.x2));
      const b = f.x.map(Math.max(r.x1, r.x2));
      const da = Math.abs(px - a);
      const db = Math.abs(px - b);
      if (da <= 5 || db <= 5) {
        return { kind: 'region', id: r.id, part: da <= db ? 'x1' : 'x2', cursor: 'ew-resize' };
      }
    }
    for (const r of p.regions ?? []) {
      if (!r.editable) continue;
      const a = f.x.map(Math.min(r.x1, r.x2));
      const b = f.x.map(Math.max(r.x1, r.x2));
      if (px > a && px < b) return { kind: 'region', id: r.id, part: 'move', cursor: 'move' };
    }
    return null;
  };

  /** Scales reflecting the current (possibly not yet redrawn) view. */
  const liveScales = () => {
    const f = frameRef.current;
    if (!f) return null;
    const v = viewRef.current;
    const mk = (sc: Scale, r: Range | undefined) => (r ? new Scale(r[0], r[1], sc.log, sc.p0, sc.p1) : sc);
    return { f, x: mk(f.x, v.x), y: mk(f.y, v.y), y2: f.y2 ? mk(f.y2, v.y2) : null };
  };

  const defaultCursor = () => {
    const m = propsRef.current.mode ?? 'zoom';
    return m === 'pan' ? 'grab' : m === 'select' ? 'default' : m === 'draw' ? 'col-resize' : 'crosshair';
  };

  /* ---------------- imperative handle ---------------- */

  useImperativeHandle(
    ref,
    () => ({
      resetZoom() {
        viewRef.current = {};
        scheduleBase();
      },
      zoomBy(factor: number) {
        const s = liveScales();
        if (!s || !(factor > 0)) return;
        const x = zoomScale(s.x, 0.5, factor);
        const y = zoomScale(s.y, 0.5, factor);
        const y2 = s.y2 ? zoomScale(s.y2, 0.5, factor) : null;
        const v: View = { ...viewRef.current };
        if (x) v.x = x;
        if (y) v.y = y;
        if (y2) v.y2 = y2;
        viewRef.current = v;
        scheduleBase();
      },
      toPNG() {
        const { w, h } = sizeRef.current;
        const c = document.createElement('canvas');
        const scale = Math.max(2, window.devicePixelRatio || 1);
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        const ctx = c.getContext('2d');
        if (!ctx || w === 0) return '';
        ctx.scale(scale, scale);
        const p = propsRef.current;
        const plan = planLayout(p, w, h);
        const frame = drawChart(ctx, w, h, p, viewRef.current, plan);
        drawLegendCanvas(ctx, plan.legend, frame);
        return c.toDataURL('image/png');
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleBase],
  );

  /* ---------------- wheel ---------------- */

  useEffect(() => {
    const cv = overRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      const s = liveScales();
      if (!s) return;
      const p = local(e);
      const { f } = s;
      if (!inPlot(f, p.x, p.y)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0015;
      const factor = Math.exp(-e.deltaY * unit);
      if (!Number.isFinite(factor) || factor === 1) return;
      const v: View = { ...viewRef.current };
      if (e.ctrlKey) {
        const frac = (p.y - s.y.p0) / (s.y.p1 - s.y.p0);
        const y = zoomScale(s.y, frac, factor);
        if (y) v.y = y;
        if (s.y2) {
          const y2 = zoomScale(s.y2, frac, factor);
          if (y2) v.y2 = y2;
        }
      } else {
        const frac = (p.x - s.x.p0) / (s.x.p1 - s.x.p0);
        const x = zoomScale(s.x, frac, factor);
        if (x) v.x = x;
      }
      viewRef.current = v;
      scheduleBase();
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleBase]);

  /* ---------------- pointer interaction ---------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const f = frameRef.current;
    if (!f) return;
    const p = local(e);
    if (!inPlot(f, p.x, p.y)) return;
    const base = { button: e.button, sx: p.x, sy: p.y, cx: p.x, cy: p.y, moved: false };
    let drag: Drag | null = null;
    const panDrag = (): Drag => {
      const s = liveScales()!;
      return { ...base, kind: 'pan', pan: { x: s.x, y: s.y, y2: s.y2 } };
    };
    if (e.button === 1 || (e.button === 2 && e.shiftKey)) {
      drag = panDrag();
    } else if (e.button === 0) {
      if (e.shiftKey) {
        drag = { ...base, kind: 'xband' };
      } else {
        const hit = hitTest(f, p.x, p.y);
        if (hit) {
          const pr = propsRef.current;
          drag = { ...base, kind: hit.kind, hit };
          if (hit.kind === 'region') {
            const r = pr.regions?.find((q) => q.id === hit.id);
            if (r) drag.orig = { x1: Math.min(r.x1, r.x2), x2: Math.max(r.x1, r.x2), y1: 0, y2: 0, x: 0 };
          } else if (hit.kind === 'segment') {
            const sg = pr.segments?.find((q) => q.id === hit.id);
            if (sg) drag.orig = { x1: sg.x1, y1: sg.y1, x2: sg.x2, y2: sg.y2, x: 0 };
          } else {
            const m = pr.markers?.find((q) => q.id === hit.id);
            if (m) drag.orig = { x1: 0, x2: 0, y1: 0, y2: 0, x: m.x };
          }
          if (!drag.orig) drag = null;
        }
        if (!drag) {
          const mode = pr0(propsRef.current);
          drag =
            mode === 'pan'
              ? panDrag()
              : mode === 'select'
                ? { ...base, kind: 'none' }
                : mode === 'draw'
                  ? { ...base, kind: 'xband' }
                  : { ...base, kind: 'zoom' };
        }
      }
    } else {
      return;
    }
    e.preventDefault();
    try {
      overRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = drag;
    if (drag.kind === 'pan' && overRef.current) overRef.current.style.cursor = 'grabbing';
  };

  const pr0 = (p: ChartProps) => p.mode ?? 'zoom';

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const f = frameRef.current;
    if (!f) return;
    const p = local(e);
    const d = dragRef.current;
    const cv = overRef.current!;
    if (!d) {
      hoverRef.current = inPlot(f, p.x, p.y) ? p : null;
      cv.style.cursor = inPlot(f, p.x, p.y) ? (hitTest(f, p.x, p.y)?.cursor ?? defaultCursor()) : 'default';
      scheduleOverlay();
      return;
    }
    d.cx = p.x;
    d.cy = p.y;
    const dist = Math.hypot(d.cx - d.sx, d.cy - d.sy);
    if (!d.moved && dist >= (d.kind === 'zoom' || d.kind === 'xband' || d.kind === 'none' ? MIN_DRAG : 2)) d.moved = true;
    hoverRef.current = inPlot(f, p.x, p.y) ? p : null;
    const pr = propsRef.current;
    if (d.kind === 'pan' && d.pan && d.moved) {
      const dx = d.cx - d.sx;
      const dy = d.cy - d.sy;
      const v: View = { x: shiftScale(d.pan.x, dx), y: shiftScale(d.pan.y, dy) };
      if (d.pan.y2) v.y2 = shiftScale(d.pan.y2, dy);
      viewRef.current = v;
      scheduleBase();
    } else if (d.kind === 'region' && d.hit?.kind === 'region' && d.orig && d.moved) {
      const o = d.orig;
      let x1 = o.x1;
      let x2 = o.x2;
      if (d.hit.part === 'move') {
        const dx = d.cx - d.sx;
        x1 = f.x.inv(f.x.map(o.x1) + dx);
        x2 = f.x.inv(f.x.map(o.x2) + dx);
      } else if (d.hit.part === 'x1') {
        x1 = f.x.inv(d.cx);
        if (!(x1 < o.x2)) x1 = f.x.inv(f.x.map(o.x2) - 1);
      } else {
        x2 = f.x.inv(d.cx);
        if (!(x2 > o.x1)) x2 = f.x.inv(f.x.map(o.x1) + 1);
      }
      d.last = { x1, x2, y1: 0, y2: 0, x: 0 };
      pr.onRegionChange?.(d.hit.id, x1, x2, false);
    } else if (d.kind === 'segment' && d.hit?.kind === 'segment' && d.orig && d.moved) {
      const o = d.orig;
      const sg = pr.segments?.find((q) => q.id === d.hit!.id);
      const sy = scaleFor(f, sg?.axis);
      let seg = { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 };
      if (d.hit.part === 'move') {
        const dx = d.cx - d.sx;
        const dy = d.cy - d.sy;
        seg = {
          x1: f.x.inv(f.x.map(o.x1) + dx),
          y1: sy.inv(sy.map(o.y1) + dy),
          x2: f.x.inv(f.x.map(o.x2) + dx),
          y2: sy.inv(sy.map(o.y2) + dy),
        };
      } else if (d.hit.part === 'p1') {
        seg.x1 = f.x.inv(d.cx);
        seg.y1 = sy.inv(d.cy);
      } else {
        seg.x2 = f.x.inv(d.cx);
        seg.y2 = sy.inv(d.cy);
      }
      d.last = seg as Drag['last'];
      pr.onSegmentChange?.(d.hit.id, seg, false);
    } else if (d.kind === 'marker' && d.hit?.kind === 'marker' && d.orig && d.moved) {
      const x = f.x.inv(d.cx);
      d.last = { x1: 0, x2: 0, y1: 0, y2: 0, x };
      pr.onMarkerChange?.(d.hit.id, x, false);
    }
    scheduleOverlay();
  };

  const finishDrag = (e: React.PointerEvent<HTMLCanvasElement>, cancel: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try {
      overRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const f = frameRef.current;
    const pr = propsRef.current;
    const cv = overRef.current;
    if (cv) cv.style.cursor = defaultCursor();
    if (!f || cancel) {
      scheduleOverlay();
      return;
    }
    const p = local(e);
    d.cx = p.x;
    d.cy = p.y;
    const clampX = (v: number) => Math.min(Math.max(v, f.l), f.r);
    const clampY = (v: number) => Math.min(Math.max(v, f.t), f.b);
    const dx = Math.abs(d.cx - d.sx);
    const dy = Math.abs(d.cy - d.sy);
    const doClick = () => {
      if (d.button !== 0) return;
      pr.onClick?.(f.x.inv(d.sx), f.y.inv(d.sy));
    };

    if (d.kind === 'zoom') {
      if (dx < MIN_DRAG && dy < MIN_DRAG) {
        doClick();
      } else {
        const v: View = { ...viewRef.current };
        if (dx >= MIN_DRAG) {
          const a = f.x.inv(clampX(Math.min(d.sx, d.cx)));
          const b = f.x.inv(clampX(Math.max(d.sx, d.cx)));
          v.x = [a, b];
        }
        if (dy >= MIN_DRAG) {
          const pTop = clampY(Math.min(d.sy, d.cy));
          const pBot = clampY(Math.max(d.sy, d.cy));
          v.y = [f.y.inv(pBot), f.y.inv(pTop)];
          if (f.y2) v.y2 = [f.y2.inv(pBot), f.y2.inv(pTop)];
        }
        viewRef.current = v;
        scheduleBase();
      }
    } else if (d.kind === 'xband') {
      if (dx < MIN_DRAG) doClick();
      else {
        const a = f.x.inv(clampX(Math.min(d.sx, d.cx)));
        const b = f.x.inv(clampX(Math.max(d.sx, d.cx)));
        pr.onCreateRegion?.(a, b);
      }
    } else if (d.kind === 'none' || d.kind === 'pan') {
      if (!d.moved && d.kind !== 'pan') doClick();
      else if (!d.moved && d.pan && d.button === 0) doClick();
    } else if (d.kind === 'region' && d.hit?.kind === 'region') {
      if (d.moved && d.last) pr.onRegionChange?.(d.hit.id, d.last.x1, d.last.x2, true);
      else doClick();
    } else if (d.kind === 'segment' && d.hit?.kind === 'segment') {
      if (d.moved && d.last) pr.onSegmentChange?.(d.hit.id, d.last, true);
      else doClick();
    } else if (d.kind === 'marker' && d.hit?.kind === 'marker') {
      if (d.moved && d.last) pr.onMarkerChange?.(d.hit.id, d.last.x, true);
      else doClick();
    }
    scheduleOverlay();
  };

  const onPointerLeave = () => {
    hoverRef.current = null;
    scheduleOverlay();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const f = frameRef.current;
    const p = local(e);
    if (f && !inPlot(f, p.x, p.y)) return;
    viewRef.current = {};
    scheduleBase();
  };

  /* ---------------- legend (DOM) ---------------- */

  const { w, h } = size;
  const plan = w > 0 ? planLayout(props, w, h) : null;
  const legend = plan?.legend;
  const toggle = props.onToggleSeries;

  return (
    <div
      ref={wrapRef}
      className={'gc-chart' + (props.className ? ' ' + props.className : '')}
      style={props.style}
    >
      <canvas ref={baseRef} className="gc-canvas" />
      <canvas
        ref={overRef}
        className="gc-canvas gc-over"
        style={{ cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishDrag(e, false)}
        onPointerCancel={(e) => finishDrag(e, true)}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          if (e.shiftKey) e.preventDefault();
        }}
      />
      {legend && legend.mode === 'right' && plan && (
        <div
          className="gc-legend gc-legend-right"
          style={{ top: plan.top, right: 6, width: legend.boxW, height: legend.boxH }}
        >
          {legend.entries.map((s) => (
            <LegendItem key={s.id} s={s} onToggle={toggle} />
          ))}
        </div>
      )}
      {legend && legend.mode === 'top' && plan && (
        <div
          ref={topLegendRef}
          className="gc-legend gc-legend-top"
          style={{ top: plan.top - legend.boxH - 8, width: legend.boxW, height: legend.boxH }}
        >
          {legend.rows.map((row, i) => (
            <div className="gc-row" key={i}>
              {row.map((s) => (
                <LegendItem key={s.id} s={s} onToggle={toggle} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default Chart;
