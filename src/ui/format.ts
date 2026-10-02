/** Number formatting in the style of ASTRA reports. */

export function fmt(v: number | undefined | null, digits = 3): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return 'n/a';
  return v.toFixed(digits);
}

/** "2.637e+4" */
export function sci(v: number | undefined, digits = 3): string {
  if (v === undefined || !Number.isFinite(v)) return 'n/a';
  if (v === 0) return '0.000';
  const s = v.toExponential(digits);
  return s.replace(/e\+?(-?)0*(\d)/, (_m, sgn, d) => `e${sgn ? '-' : '+'}${d}`);
}

/** Smart fixed/scientific choice with `sig` significant digits. */
export function num(v: number | undefined, sig = 4): string {
  if (v === undefined || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return sci(v, sig - 1);
  if (a >= 1000) return v.toFixed(Math.max(0, sig - 4));
  const d = a === 0 ? sig - 1 : Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return v.toFixed(Math.min(d, 6));
}

/** "2.637e+4 (±0.018%)" — ASTRA report style. */
export function withRel(v: number | undefined, e: number | undefined, digits = 3): string {
  if (v === undefined || !Number.isFinite(v)) return 'n/a';
  const base = sci(v, digits);
  if (e === undefined || !Number.isFinite(e) || v === 0) return base;
  return `${base} (±${((100 * Math.abs(e)) / Math.abs(v)).toFixed(3)}%)`;
}

/**
 * "26371.5 ± 4.8 g/mol" or, for very small/large values,
 * "(-1.090 ± 0.014)e-3 mg/mL" like ASTRA's property grid.
 */
export function pm(v: number | undefined, e: number | undefined, unit = '', digits = 3): string {
  const u = unit ? ` ${unit}` : '';
  if (v === undefined || !Number.isFinite(v)) return `n/a${u}`;
  const err = e !== undefined && Number.isFinite(e) ? Math.abs(e) : NaN;
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-2 || a >= 1e6)) {
    const exp = Math.floor(Math.log10(a));
    const f = 10 ** exp;
    const body = Number.isFinite(err) ? `(${(v / f).toFixed(digits)} ± ${(err / f).toFixed(digits)})` : (v / f).toFixed(digits);
    return `${body}e${exp}${u}`;
  }
  const d = a >= 1000 ? 1 : digits;
  return Number.isFinite(err) ? `${v.toFixed(d)} ± ${err.toFixed(d)}${u}` : `${v.toFixed(d)}${u}`;
}

export function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function download(name: string, data: string | Blob, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';
}
