import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { parseAfe8 } from './reader';
import type { Experiment } from './types';

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Lazily initialise sql.js (WebAssembly SQLite) in the browser. */
export function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs({ locateFile: () => wasmUrl });
  return sqlPromise;
}

/** Read an .afe8 File/Blob entirely in the browser. Nothing is uploaded. */
export async function loadAfe8File(file: Blob & { name?: string }): Promise<Experiment> {
  const [SQL, buf] = await Promise.all([getSql(), file.arrayBuffer()]);
  return parseAfe8(SQL, new Uint8Array(buf), { fileName: file.name });
}
