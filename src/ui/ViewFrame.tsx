import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Chart } from '../chart/Chart';
import type { ChartHandle, ChartProps } from '../chart/types';
import { EDITING_VIEWS, useStore, type Tab } from '../store';
import { IconClose, IconInfo, IconWarning } from './icons';
import { download, safeFileName } from './format';

/** Whether the surrounding tab is the active one (charts only obey toolbar commands then). */
export const ActiveTabContext = createContext<{ active: boolean; title: string }>({ active: false, title: '' });

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
          <button disabled={!tab.draft} onClick={() => apply(tab.id)}>
            Apply
          </button>
          {tab.draft && <span className="view-dirty">Modified — press Apply or OK to keep the changes</span>}
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
  return (
    <div className="chart-pane">
      <Chart ref={inner} mode={props.mode ?? mode} {...props} />
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
