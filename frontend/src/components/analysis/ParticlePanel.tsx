/**
 * ParticlePanel — particle number-density analysis panel.
 *
 * Provides inputs for sample_ri and solvent_ri. The "Analyze" button calls
 * fetchParticle(experimentId, { sample_ri, solvent_ri }). Shows per-peak
 * total_count, mean geometric radius, mean number density. The
 * NumberDensityPlot is shown in the center area as a separate center tab.
 */
import { useMemo, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';
import { usePeakStore } from '../../stores/peakStore';

const inputClass =
  'w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400';

function fmtNum(v: number | null | undefined, digits = 3): string {
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

export default function ParticlePanel() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const particle = useResultsStore((s) => s.particle);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchParticle = useResultsStore((s) => s.fetchParticle);
  const peaks = usePeakStore((s) => s.peaks);

  const [sampleRi, setSampleRi] = useState<string>('');
  const [solventRi, setSolventRi] = useState<string>('');

  const peakLabel = (peakId: number) => {
    const p = peaks.find((pk) => pk.id === peakId);
    if (!p) return `Peak ${peakId}`;
    const num = p.range_number ?? peakId;
    return p.range_name ? `Peak ${num} · ${p.range_name}` : `Peak ${num}`;
  };

  const hasData = useMemo(() => {
    if (!particle) return false;
    return particle.peaks.some((slice) => {
      return (
        slice.number_density.some((v) => v != null && Number.isFinite(v)) ||
        slice.total_count != null
      );
    });
  }, [particle]);

  const handleAnalyze = () => {
    if (currentExperimentId == null) return;
    const params: Record<string, number> = {};
    const sri = Number(sampleRi);
    if (Number.isFinite(sri)) params.sample_ri = sri;
    const solri = Number(solventRi);
    if (Number.isFinite(solri)) params.solvent_ri = solri;
    fetchParticle(currentExperimentId, params);
  };

  if (currentExperimentId == null) {
    return (
      <div className="border-t-2 border-slate-200 p-4 text-xs text-slate-400 italic">
        Select an experiment to run particle analysis.
      </div>
    );
  }

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Particle Analysis
      </h4>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Sample RI"
          value={sampleRi}
          onChange={setSampleRi}
          step={0.001}
          placeholder="1.515"
        />
        <NumberField
          label="Solvent RI"
          value={solventRi}
          onChange={setSolventRi}
          step={0.001}
          placeholder="1.401"
        />
      </div>

      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {loading ? 'Analyzing…' : 'Analyze'}
      </button>

      {error && particle == null && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {particle && !hasData && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Sample RI required for particle analysis
        </div>
      )}

      {particle && hasData && (
        <div className="space-y-3">
          {particle.peaks.map((slice, i) => {
            const meanRadius = mean(slice.geometric_radius);
            const meanDensity = mean(slice.number_density);
            const hasVals =
              meanRadius != null || meanDensity != null || slice.total_count != null;
            if (!hasVals) return null;
            return (
              <div
                key={slice.peak_id}
                className="border border-slate-200 rounded p-2 space-y-1"
              >
                <div
                  className="text-xs font-semibold"
                  style={{ color: `rgb(${i * 30}, ${i * 20}, ${i * 10})` }}
                >
                  {peakLabel(slice.peak_id)}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">Total count:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtSci(slice.total_count)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">mean radius:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtNum(meanRadius)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">mean density:</span>{' '}
                    <span className="font-mono text-slate-700">
                      {fmtSci(meanDensity)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}