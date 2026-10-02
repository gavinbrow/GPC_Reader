import { useEffect, useState, type ReactNode } from 'react';

export type Option = string | { value: string; label: string };

export interface PGCell {
  /** Display value (numbers are formatted with `digits`). */
  value: string | number | boolean | ReactNode;
  kind?: 'text' | 'number' | 'select' | 'checkbox' | 'readonly';
  options?: Option[];
  onChange?: (v: string | number | boolean) => void;
  digits?: number;
  /** Optional unit suffix shown after numbers. */
  unit?: string;
  /** Scale applied for display/editing: shown = stored * scale. */
  scale?: number;
  title?: string;
}

export interface PGRow {
  key: string;
  label: ReactNode;
  cells?: PGCell[];
  children?: PGRow[];
  defaultOpen?: boolean;
  title?: string;
}

interface Props {
  columns: string[];
  rows: PGRow[];
  labelWidth?: number;
  columnWidth?: number;
  className?: string;
}

/** ASTRA-style property grid: labelled rows, one editable cell per column, collapsible groups. */
export function PropertyGrid({ columns, rows, labelWidth = 260, columnWidth = 170, className }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (r: PGRow) => open[r.key] ?? !!r.defaultOpen;
  const render = (r: PGRow, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    const hasKids = !!r.children?.length;
    out.push(
      <tr key={r.key} className={hasKids ? 'pg-group' : undefined}>
        <td className="pg-label" style={{ paddingLeft: 6 + depth * 16 }} title={r.title}>
          {hasKids ? (
            <button className="pg-toggle" onClick={() => setOpen((o) => ({ ...o, [r.key]: !isOpen(r) }))} aria-label="toggle">
              {isOpen(r) ? '◢' : '▷'}
            </button>
          ) : (
            <span className="pg-toggle-space" />
          )}
          {r.label}
        </td>
        {columns.map((_, ci) => {
          const c = r.cells?.[ci];
          return (
            <td key={ci} className={'pg-cell' + (!c || c.kind === 'readonly' || (!c.onChange && c.kind !== 'checkbox') ? ' pg-ro' : '')} title={c?.title}>
              {c ? <Cell c={c} /> : null}
            </td>
          );
        })}
        <td className="pg-fill" />
      </tr>,
    );
    if (hasKids && isOpen(r)) r.children!.forEach((k) => out.push(...render(k, depth + 1)));
    return out;
  };
  return (
    <div className={'pg ' + (className ?? '')}>
      <table>
        <colgroup>
          <col style={{ width: labelWidth }} />
          {columns.map((_, i) => (
            <col key={i} style={{ width: columnWidth }} />
          ))}
          <col />
        </colgroup>
        <thead>
          <tr>
            <th className="pg-corner" />
            {columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
            <th className="pg-fill" />
          </tr>
        </thead>
        <tbody>{rows.flatMap((r) => render(r, 0))}</tbody>
      </table>
    </div>
  );
}

function formatNumber(v: number, digits?: number) {
  if (!Number.isFinite(v)) return '';
  if (digits === undefined) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 10 ** -digits || a >= 1e7)) return v.toExponential(4);
  return v.toFixed(digits);
}

function Cell({ c }: { c: PGCell }) {
  const kind = c.kind ?? (typeof c.value === 'boolean' ? 'checkbox' : typeof c.value === 'number' ? 'number' : 'text');
  const scale = c.scale ?? 1;
  if (kind === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={!!c.value}
        disabled={!c.onChange}
        onChange={(e) => c.onChange?.(e.target.checked)}
      />
    );
  }
  if (kind === 'select' && c.onChange) {
    return (
      <select className="pg-select" value={String(c.value)} onChange={(e) => c.onChange?.(e.target.value)}>
        {(c.options ?? []).map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    );
  }
  if (kind === 'number' && c.onChange && typeof c.value === 'number') {
    return <NumberInput value={c.value * scale} digits={c.digits} unit={c.unit} onCommit={(v) => c.onChange!(v / scale)} />;
  }
  if (kind === 'text' && c.onChange) {
    return <TextInput value={String(c.value ?? '')} onCommit={(v) => c.onChange!(v)} />;
  }
  if (typeof c.value === 'number') {
    return (
      <span>
        {formatNumber(c.value * scale, c.digits)}
        {c.unit ? ` ${c.unit}` : ''}
      </span>
    );
  }
  if (kind === 'select' && c.options) {
    const o = c.options.find((x) => (typeof x === 'string' ? x : x.value) === String(c.value));
    return <span>{o ? (typeof o === 'string' ? o : o.label) : String(c.value)}</span>;
  }
  return <span>{c.value as ReactNode}</span>;
}

export function NumberInput({ value, digits, unit, onCommit, width }: { value: number; digits?: number; unit?: string; onCommit: (v: number) => void; width?: number }) {
  const [text, setText] = useState(formatNumber(value, digits));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(formatNumber(value, digits));
  }, [value, digits, editing]);
  const commit = () => {
    setEditing(false);
    const v = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(formatNumber(value, digits));
  };
  return (
    <span className="pg-num">
      <input
        className="pg-input"
        style={width ? { width } : undefined}
        value={text}
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(formatNumber(value, digits));
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {unit ? <span className="pg-unit">{unit}</span> : null}
    </span>
  );
}

function TextInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="pg-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
