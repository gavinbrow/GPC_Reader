import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Chart } from '../chart/Chart';
import type { ChartHandle, ChartProps } from '../chart/types';
import { EDITING_VIEWS, useStore, type Tab } from '../store';
import { IconClose, IconFit, IconInfo, IconRedo, IconUndo, IconPan, IconRange, IconWarning, IconZoomOut, IconZoomRect } from './icons';
import { download, safeFileName, toCSV } from './format';

/** Whether the surrounding tab is the active one (charts only obey toolbar commands then). */
export const ActiveTabContext = createContext<{ active: boolean; title: string }>({ active: false, title: '' });

/** True when a key press goes to a text field / select rather than to the view. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Keyboard shortcuts of a view: the handler runs only while the view's tab is
 * active and the user is not typing in a field. Return true to mark the key
 * as handled (its default action is then suppressed).
 */
export function useViewKeys(handler: (e: KeyboardEvent) => boolean | void) {
  const { active } = useContext(ActiveTabContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector('.modal-backdrop')) return;
      if (ref.current(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

interface FrameProps {
  tab: Tab;
  toolbar?: ReactNode;
  /** Info/warning messages shown in a dismissible banner above the content. */
  messages?: string[];
  main: ReactNode;
  bottom?: ReactNode;
  /** Initial fraction of height given to the bottom pane. */
  bottomFraction?: number;
  onOk?: () => void;
  onCancel?: () => void;
}

/**
 * Standard layout of a procedure view: a tool strip, an optional message
 * banner, the graph area, a draggable splitter, the property grid and the
 * OK / Cancel / Apply buttons (for views that edit the method).
 */
export function ViewFrame({ tab, toolbar, messages, main, bottom, bottomFraction = 0.36, onOk, onCancel }: FrameProps) {
  const apply = useStore((s) => s.apply);
  const setDraft = useStore((s) => s.setDraft);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const closeTab = useStore((s) => s.closeTab);
  const [frac, setFrac] = useState(bottomFraction);
  const [dismissed, setDismissed] = useState<string>('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const editing = EDITING_VIEWS.has(tab.view);
  const msgs = (messages ?? []).filter(Boolean);
  const msgKey = msgs.join('|');

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const f = 1 - (ev.clientY - rect.top) / rect.height;
      setFrac(Math.min(0.85, Math.max(0.1, f)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="view">
      {toolbar && <div className="view-toolbar">{toolbar}</div>}
      {msgs.length > 0 && dismissed !== msgKey && (
        <div className="view-banner">
          {msgs.some((m) => /cannot|not |no /i.test(m)) ? <IconInfo /> : <IconWarning />}
          <div className="view-banner-text">
            {msgs.map((m, i) => (
              <div key={i}>{m}</div>
            ))}
          </div>
          <button className="icon-btn" onClick={() => setDismissed(msgKey)} title="Dismiss">
            <IconClose />
          </button>
        </div>
      )}
      <div className="view-body" ref={bodyRef}>
        <div className="view-main" style={{ flex: bottom ? `${1 - frac} 1 0` : '1 1 0' }}>
          {main}
        </div>
        {bottom && (
          <>
            <div className="view-splitter" onPointerDown={startDrag} />
            <div className="view-bottom" style={{ flex: `${frac} 1 0` }}>
              {bottom}
            </div>
          </>
        )}
      </div>
      {editing && (
        <div className="view-buttons">
          <button
            onClick={() => {
              apply(tab.id);
              onOk?.();
              closeTab(tab.id);
            }}
          >
            OK
          </button>
          <button
            onClick={() => {
              setDraft(tab.id, undefined);
              onCancel?.();
              closeTab(tab.id);
            }}
          >
            Cancel
          </button>
          <button disabled={!tab.draft} onClick={() => apply(tab.id)} title="Apply the changes and keep this view open (Ctrl+Enter)">
            Apply
          </button>
          <button className="vb-icon" disabled={!tab.past?.length} onClick={() => undo(tab.id)} title="Undo (Ctrl+Z)">
            <IconUndo />
          </button>
          <button className="vb-icon" disabled={!tab.future?.length} onClick={() => redo(tab.id)} title="Redo (Ctrl+Y)">
            <IconRedo />
          </button>
          {tab.draft && <span className="view-dirty">Modified: press Apply or OK to keep the changes</span>}
        </div>
      )}
    </div>
  );
}

/** Chart bound to the global toolbar (zoom/pan mode, zoom in/out, autoscale, save image). */
export const ChartPane = forwardRef<ChartHandle, ChartProps & { primary?: boolean; fileName?: string }>(function ChartPane(
  { primary = true, fileName, ...props },
  ref,
) {
  const inner = useRef<ChartHandle>(null);
  useImperativeHandle(ref, () => inner.current as ChartHandle, []);
  const { active, title } = useContext(ActiveTabContext);
  const mode = useStore((s) => s.chartMode);
  const cmd = useStore((s) => s.chartCmd);
  const lastSeq = useRef(cmd.seq);
  useEffect(() => {
    if (cmd.seq === lastSeq.current) return;
    lastSeq.current = cmd.seq;
    if (!active || !inner.current) return;
    if (cmd.cmd === 'zoomIn') inner.current.zoomBy(1.5);
    else if (cmd.cmd === 'zoomOut') inner.current.zoomBy(1 / 1.5);
    else if (cmd.cmd === 'reset') inner.current.resetZoom();
    else if (cmd.cmd === 'png' && primary) {
      const url = inner.current.toPNG();
      fetch(url)
        .then((r) => r.blob())
        .then((b) => download(`${safeFileName(fileName ?? props.title ?? title)}.png`, b));
    }
  }, [cmd, active, primary, fileName, props.title, title]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);
  const name = safeFileName(fileName ?? props.title ?? title);
  const exportData = () => {
    const vis = props.series.filter((s) => s.visible !== false);
    const rows: unknown[][] = [vis.flatMap((s) => [`${s.label} x`, `${s.label} y`])];
    const n = Math.max(0, ...vis.map((s) => s.x.length));
    for (let i = 0; i < n; i++) rows.push(vis.flatMap((s): unknown[] => (i < s.x.length ? [s.x[i], s.y[i]] : ['', ''])));
    download(`${name}.csv`, toCSV(rows), 'text/csv');
  };
  const savePng = () => {
    const url = inner.current?.toPNG();
    if (url) fetch(url).then((r) => r.blob()).then((b) => download(`${name}.png`, b));
  };
  const item = (label: string, fn: () => void) => (
    <button
      className="menu-item"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        setMenu(null);
        fn();
      }}
    >
      <span className="menu-check" />
      <span className="menu-label">{label}</span>
    </button>
  );
  return (
    <div
      className="chart-pane"
      onContextMenu={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setMenu({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
    >
      <Chart ref={inner} mode={props.mode ?? mode} {...props} />
      {menu && (
        <div className="menu-drop context-menu" style={{ left: menu.x, top: menu.y }}>
          {item('Autoscale', () => inner.current?.resetZoom())}
          {item('Zoom In', () => inner.current?.zoomBy(1.5))}
          {item('Zoom Out', () => inner.current?.zoomBy(1 / 1.5))}
          <div className="menu-sep" />
          {item('Save Image (PNG)…', savePng)}
          {item('Export Data (CSV)…', exportData)}
        </div>
      )}
    </div>
  );
});

/** Small labelled control for view tool strips. */
export function ToolLabel({ children }: { children: ReactNode }) {
  return <span className="tool-label">{children}</span>;
}

export function ToolButton({ icon, children, onClick, title, disabled, pressed }: { icon?: ReactNode; children?: ReactNode; onClick?: () => void; title?: string; disabled?: boolean; pressed?: boolean }) {
  return (
    <button className={'tool-btn' + (pressed ? ' pressed' : '')} onClick={onClick} title={title} disabled={disabled}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function ToolSelect<T extends string | number>({ value, options, onChange, width }: { value: T; options: (T | { value: T; label: string })[]; onChange: (v: T) => void; width?: number }) {
  return (
    <select
      className="tool-select"
      style={width ? { width } : undefined}
      value={String(value)}
      onChange={(e) => {
        const o = options.map((x) => (typeof x === 'object' ? x.value : x)).find((v) => String(v) === e.target.value);
        if (o !== undefined) onChange(o);
      }}
    >
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : String(o);
        return (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export type GraphMode = 'draw' | 'zoom' | 'pan';

/**
 * Mode buttons for graphs where a plain drag defines a range (peaks,
 * baselines): Draw is the default, Zoom and Pan must be chosen explicitly.
 * Keys: D draw, Z zoom, P pan, A autoscale.
 */
export function GraphModeTools({ mode, setMode, drawLabel, drawTitle, chart }: { mode: GraphMode; setMode: (m: GraphMode) => void; drawLabel: string; drawTitle: string; chart: React.RefObject<ChartHandle | null> }) {
  useViewKeys((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'd') setMode('draw');
    else if (k === 'z') setMode('zoom');
    else if (k === 'p') setMode('pan');
    else if (k === 'a') chart.current?.resetZoom();
    else if (k === 'escape' && mode !== 'draw') setMode('draw');
    else return false;
    return true;
  });
  return (
    <>
      <ToolButton icon={<IconRange />} pressed={mode === 'draw'} onClick={() => setMode('draw')} title={`${drawTitle} (D)`}>
        {drawLabel}
      </ToolButton>
      <ToolButton icon={<IconZoomRect />} pressed={mode === 'zoom'} onClick={() => setMode(mode === 'zoom' ? 'draw' : 'zoom')} title="Zoom: drag a rectangle on the graph to zoom in (Z)">
        Zoom
      </ToolButton>
      <ToolButton icon={<IconPan />} pressed={mode === 'pan'} onClick={() => setMode(mode === 'pan' ? 'draw' : 'pan')} title="Pan: drag the graph to move it (P)" />
      <ToolButton icon={<IconZoomOut />} onClick={() => chart.current?.zoomBy(1 / 1.5)} title="Zoom out" />
      <ToolButton icon={<IconFit />} onClick={() => chart.current?.resetZoom()} title="Autoscale: show all data (A, or double-click the graph)">
        Autoscale
      </ToolButton>
    </>
  );
}

/** Small grey hint text at the end of a tool strip. */
export function ToolHint({ children }: { children: ReactNode }) {
  return (
    <span className="tool-hint" title={typeof children === 'string' ? children : undefined}>
      {children}
    </span>
  );
}

export function ToolSep() {
  return <span className="tool-sep" />;
}

/** Plain data table used for results. */
export function DataTable({ head, rows, className, onRowClick, selected }: { head: ReactNode[]; rows: ReactNode[][]; className?: string; onRowClick?: (i: number) => void; selected?: number }) {
  return (
    <div className={'data-table ' + (className ?? '')}>
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={onRowClick ? () => onRowClick(i) : undefined} className={selected === i ? 'selected' : undefined}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
