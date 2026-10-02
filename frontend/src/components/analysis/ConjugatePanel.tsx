/**
 * ConjugatePanel — protein conjugate / copolymer analysis panel.
 *
 * Provides inputs for dn_dc_protein, dn_dc_modifier, uv_ext_protein,
 * uv_ext_modifier, and cell_length. The "Analyze" button calls
 * fetchConjugate(experimentId, params). After fetch, shows per-peak summary
 * (mean protein fraction %, mean modifier fraction %, mean total M) and an
 * inline Plotly plot of protein_fraction vs time per peak. If data is empty
 * or all NaN, shows "Conjugate analysis requires MALS + UV + RI detectors".
 */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';
import { usePeakStore } from '../../stores/peakStore';

const Plot = lazy(() => import('react-plotly.js'));

const PEAK_COLORS: string[] = [
  'rgb(0, 50, 120)',
  'rgb(180, 60, 20)',
  'rgb(20, 120, 60)',
  'rgb(120, 30, 130)',
  'rgb(180, 120, 0)',
  'rgb(0, 130, 130)',
  'rgb(200, 50, 100)',
  'rgb(60, 60, 60)',
];

const inputClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function fmtSci(v: number | null | undefined, digits = 2): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toExponential(digits) : '—';
}

function mean(values: (number | null)[]): number | null {
  const vals: number[] = [];
  for (const v of values) {
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: number | string;
  placeholder?: string;
}

function NumberField({ label, value, onChange, step, placeholder }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-0.5">{label}</span>
      <input
        type="number"
        step={step ?? 'any'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}

export default function ConjugatePanel() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const conjugate = useResultsStore((s) => s.conjugate);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchConjugate = useResultsStore((s) => s.fetchConjugate);
  const peaks = usePeakStore((s) => s.peaks);

  const [dnDcProtein, setDnDcProtein] = useState<string>('');
  const [dnDcModifier, setDnDcModifier] = useState<string>('');
  const [uvExtProtein, setUvExtProtein] = useState<string>('');
  const [uvExtModifier, setUvExtModifier] = useState<string>('');
  const [cellLength, setCellLength] = useState<string>('1.0');

  useEffect(() => {
    if (peaks.length > 0 && dnDcProtein === '') {
      const firstWithDnDc = peaks.find((p) => p.dn_dc != null);
      if (firstWithDnDc && firstWithDnDc.dn_dc != null) {
        setDnDcProtein(String(firstWithDnDc.dn_dc));
      }
    }
  }, [peaks]);

  const peakLabel = (peakId: number) => {
    const p = peaks.find((pk) => pk.id === peakId);
    if (!p) return `Peak ${peakId}`;
    const num = p.range_number ?? peakId;
    return p.range_name ? `Peak ${num} · ${p.range_name}` : `Peak ${num}`;
  };

  const hasData = useMemo(() => {
    if (!conjugate) return false;
    return conjugate.peaks.some((slice) => {
      return slice.protein_fraction.some(
        (v) => v != null && Number.isFinite(v),
      );
    });
  }, [conjugate]);

  const { plotData, plotLayout } = useMemo<{
    plotData: Partial<Data>[];
    plotLayout: Partial<Layout>;
  }>(() => {
    if (!conjugate || !hasData) {
      return { plotData: [], plotLayout: {} };
    }
    const traces: Partial<Data>[] = conjugate.peaks.map((slice, i) => {
      const x: number[] = [];
      const y: number[] = [];
      slice.time.forEach((t, j) => {
        const pf = slice.protein_fraction[j];
        if (t != null && pf != null && Number.isFinite(t) && Number.isFinite(pf)) {
          x.push(t);
          y.push(pf * 100);
        }
      });
      return {
        x,
        y,
        type: 'scatter',
        mode: 'lines',
        name: peakLabel(slice.peak_id),
        line: { width: 1.5, color: PEAK_COLORS[i % PEAK_COLORS.length] },
      };
    });
    const layout: Partial<Layout> = {
      title: { text: 'Protein Fraction vs Time', font: { size: 12 } },
      xaxis: { title: { text: 'Time (min)' }, gridcolor: '#e2e8f0' },
      yaxis: { title: { text: 'Protein Fraction (%)' }, gridcolor: '#e2e8f0' },
      legend: { font: { size: 9 }, bgcolor: 'rgba(255,255,255,0.8)' },
      margin: { l: 50, r: 20, t: 40, b: 40 },
      autosize: true,
    };
    return { plotData: traces, plotLayout: layout };
  }, [conjugate, hasData, peaks]);

  const handleAnalyze = () => {
    if (currentExperimentId == null) return;
    const params: Record<string, number> = {};
    const dnp = Number(dnDcProtein);
    if (Number.isFinite(dnp)) params.dn_dc_protein = dnp;
    const dnm = Number(dnDcModifier);
    if (Number.isFinite(dnm)) params.dn_dc_modifier = dnm;
    const uvp = Number(uvExtProtein);
    if (Number.isFinite(uvp)) params.uv_ext_protein = uvp;
    const uvm = Number(uvExtModifier);
    if (Number.isFinite(uvm)) params.uv_ext_modifier = uvm;
    const cl = Number(cellLength);
    if (Number.isFinite(cl)) params.cell_length = cl;
    fetchConjugate(currentExperimentId, params);
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to run conjugate analysis.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Conjugate Analysis
      </h4>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="dn/dc Protein (mL/g)"
          value={dnDcProtein}
          onChange={setDnDcProtein}
          step={0.001}
          placeholder="0.185"
        />
        <NumberField
          label="dn/dc Modifier (mL/g)"
          value={dnDcModifier}
          onChange={setDnDcModifier}
          step={0.001}
          placeholder="0.140"
        />
        <NumberField
          label="UV Ext Protein (mL/g·cm)"
          value={uvExtProtein}
          onChange={setUvExtProtein}
          step={0.1}
          placeholder="1.0"
        />
        <NumberField
          label="UV Ext Modifier (mL/g·cm)"
          value={uvExtModifier}
          onChange={setUvExtModifier}
          step={0.1}
          placeholder="0"
        />
        <NumberField
          label="Cell Length (cm)"
          value={cellLength}
          onChange={setCellLength}
          step={0.01}
          placeholder="1.0"
        />
      </div>

      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {loading ? 'Analyzing…' : 'Analyze'}
      </button>

      {error && conjugate == null && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {conjugate && !hasData && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Conjugate analysis requires MALS + UV + RI detectors
        </div>
      )}

      {conjugate && hasData && (
        <div className="space-y-3">
          {conjugate.peaks.map((slice, i) => {
            const meanProt = mean(slice.protein_fraction);
            const meanMod = mean(slice.modifier_fraction);
            const meanTotal = mean(slice.total_molar_mass);
            const hasVals = meanProt != null || meanTotal != null;
            if (!hasVals) return null;
            return (
              <div
                key={slice.peak_id}
                className="border border-slate-200 rounded p-2 space-y-1"
              >
                <div
                  className="text-xs font-semibold"
                  style={{ color: PEAK_COLORS[i % PEAK_COLORS.length] }}
                >
                  {peakLabel(slice.peak_id)}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">Protein:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtNum(meanProt != null ? meanProt * 100 : null, 1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Modifier:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtNum(meanMod != null ? meanMod * 100 : null, 1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Total M:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtSci(meanTotal)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {plotData.length > 0 && (
            <div className="h-48 border border-slate-200 rounded overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                    Loading chart...
                  </div>
                }
              >
                <Plot
                  data={plotData as Data[]}
                  layout={plotLayout as Layout}
                  config={{
                    responsive: true,
                    displaylogo: false,
                    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
                  }}
                  useResizeHandler={true}
                  style={{ width: '100%', height: '100%' }}
                />
              </Suspense>
            </div>
          )}
        </div>
      )}
    </div>
  );
}