import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { parseAfe8 } from '../src/afe8/reader';
import type { Experiment } from '../src/afe8/types';

export const SAMPLE = resolve(
  __dirname,
  '../Astra Examples/PS 30kDa 5mg-ml[PolyStyrene Calibration Check 5mg-ml].afe8',
);

let cached: Experiment | null = null;
export async function loadSample(): Promise<Experiment> {
  if (cached) return cached;
  const SQL = await initSqlJs();
  cached = parseAfe8(SQL, new Uint8Array(readFileSync(SAMPLE)), { fileName: 'PS 30kDa 5mg-ml[PolyStyrene Calibration Check 5mg-ml].afe8' });
  return cached;
}
