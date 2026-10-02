import { loadAfe8File } from './afe8/load';
import { defaultMethod, type Method } from './analysis/method';
import { completeMethod } from './analysis/pipeline';
import { entryOf, processedFor, useStore } from './store';
import { download, safeFileName, toCSV } from './ui/format';

export async function openFiles(files: FileList | File[]) {
  const st = useStore.getState();
  const list = Array.from(files);
  if (!list.length) return;
  st.setBusy(true);
  st.setError(undefined);
  for (const f of list) {
    try {
      st.setStatus(`Reading ${f.name} …`);
      if (/\.json$/i.test(f.name)) {
        await applyMethodFile(f);
        continue;
      }
      const e = await loadAfe8File(f);
      useStore.getState().addExperiment(e);
      st.setStatus(`Opened ${f.name}`);
    } catch (err) {
      console.error(err);
      st.setError(`Could not open ${f.name}: ${(err as Error).message}`);
      st.setStatus('Error');
    }
  }
  st.setBusy(false);
}

export async function openSample() {
  const st = useStore.getState();
  st.setBusy(true);
  try {
    const name = 'PS 30kDa 5mg-ml.afe8';
    const res = await fetch(`./samples/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await openFiles([new File([blob], name)]);
  } catch (err) {
    st.setError(`Could not load the sample experiment: ${(err as Error).message}`);
  } finally {
    st.setBusy(false);
  }
}

export function pickFiles(accept = '.afe8,.json') {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = accept;
  input.onchange = () => input.files && openFiles(input.files);
  input.click();
}

/* ---------------------------------------------------------------- methods */

interface MethodFile {
  format: 'openmals-method';
  version: 1;
  source: string;
  method: Method;
}

export function saveMethod(expId?: string) {
  const entry = entryOf(expId ?? useStore.getState().selectedExpId);
  if (!entry) return;
  const file: MethodFile = { format: 'openmals-method', version: 1, source: entry.experiment.fileName, method: entry.method };
  download(`${safeFileName(entry.experiment.name)}.method.json`, JSON.stringify(file, null, 2), 'application/json');
}

/** Apply a saved method to the selected experiment (like applying an ASTRA method to new data). */
export async function applyMethodFile(f: File) {
  const st = useStore.getState();
  const entry = entryOf(st.selectedExpId);
  if (!entry) {
    st.setError('Open an experiment first, then apply a method to it.');
    return;
  }
  const json = JSON.parse(await f.text()) as MethodFile;
  if (json.format !== 'openmals-method') throw new Error('Not an OpenMALS method file.');
  const base = defaultMethod(entry.experiment);
  const m: Method = { ...base, ...json.method };
  if (m.ls.angles.length !== base.ls.angles.length) m.ls = base.ls;
  st.setMethod(entry.experiment.id, completeMethod(entry.experiment, m));
  st.setStatus(`Applied method from ${f.name}`);
}

/* ---------------------------------------------------------------- exports */

export function resultsRows(expIds?: string[]): unknown[][] {
  const st = useStore.getState();
  const head = [
    'Experiment', 'Peak', 'Start (min)', 'End (min)', 'dn/dc (mL/g)',
    'Mn (g/mol)', 'Mn unc', 'Mp (g/mol)', 'Mw (g/mol)', 'Mw unc', 'Mz (g/mol)', 'Mz unc', 'Mz+1 (g/mol)',
    'Mw/Mn', 'Mz/Mn', 'rn (nm)', 'rw (nm)', 'rz (nm)', 'M avg (g/mol)', 'r avg (nm)',
    'Calculated mass (ug)', 'Mass recovery (%)', 'Mass fraction (%)',
    '[eta]w (mL/g)', 'Rh w (nm)', 'MH K (mL/g)', 'MH a', 'Conformation slope',
  ];
  const rows: unknown[][] = [head];
  for (const x of st.experiments) {
    if (expIds && !expIds.includes(x.experiment.id)) continue;
    const p = processedFor(x.experiment, x.method);
    for (const pr of p.peaks) {
      const m = pr.moments;
      rows.push([
        x.experiment.name, pr.peak.name, pr.peak.start, pr.peak.end, pr.peak.dndc,
        m.Mn.v, m.Mn.e, m.Mp.v, m.Mw.v, m.Mw.e, m.Mz.v, m.Mz.e, m.Mz1.v,
        m.MwMn.v, m.MzMn.v, m.rn.v, m.rw.v, m.rz.v, m.Mavg.v, m.ravg.v,
        m.mass * 1e6, m.recovery, m.massFraction,
        m.etaW.v, m.rhW.v, m.mhK, m.mhA, m.conformationSlope.v,
      ]);
    }
  }
  return rows;
}

export function exportResultsCSV() {
  download('OpenMALS results.csv', toCSV(resultsRows()), 'text/csv');
}

export function sliceRows(expId: string): unknown[][] {
  const entry = entryOf(expId);
  if (!entry) return [];
  const p = processedFor(entry.experiment, entry.method);
  const rows: unknown[][] = [['Peak', 'Slice', 'Time (min)', 'Volume (mL)', 'Concentration (g/mL)', 'Molar mass (g/mol)', 'Molar mass unc', 'Molar mass (fit)', 'rms radius (nm)', 'rms radius unc', 'Fit R2', 'Intrinsic viscosity (mL/g)', 'Rh (nm)']];
  for (const pr of p.peaks) {
    for (let k = 0; k < pr.t.length; k++) {
      rows.push([
        pr.peak.name, pr.i0 + k + 1, pr.t[k], pr.t[k] * p.method.flowRate, pr.c[k], pr.M[k], pr.Merr[k],
        pr.massFit ? pr.massFit.values[k] : '', pr.rg[k], pr.rgErr[k], pr.r2[k], pr.eta?.[k] ?? '', pr.rh?.[k] ?? '',
      ]);
    }
  }
  return rows;
}

export function exportSliceCSV(expId?: string) {
  const id = expId ?? useStore.getState().selectedExpId;
  const entry = entryOf(id);
  if (!entry || !id) return;
  download(`${safeFileName(entry.experiment.name)} slices.csv`, toCSV(sliceRows(id)), 'text/csv');
}

/** Raw (despiked, baseline-subtracted, aligned) signals on the slice grid. */
export function exportSignalsCSV(expId?: string) {
  const id = expId ?? useStore.getState().selectedExpId;
  const entry = entryOf(id);
  if (!entry) return;
  const p = processedFor(entry.experiment, entry.method);
  const ids = Object.keys(p.series).filter((k) => p.series[k].raw.analysable);
  const rows: unknown[][] = [['Time (min)', ...ids]];
  for (let i = 0; i < p.t.length; i++) rows.push([p.t[i], ...ids.map((k) => p.series[k].aligned[i])]);
  download(`${safeFileName(entry.experiment.name)} signals.csv`, toCSV(rows), 'text/csv');
}

export function reprocessAll() {
  const st = useStore.getState();
  for (const x of st.experiments) st.setMethod(x.experiment.id, completeMethod(x.experiment, { ...x.method }));
  st.setStatus('All experiments processed');
}
