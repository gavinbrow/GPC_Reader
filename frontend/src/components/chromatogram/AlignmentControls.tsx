/**
 * AlignmentControls — inter-detector alignment (time shift) and band broadening
 * (Gaussian sigma) toolbar for the chromatogram.
 *
 * Values update the live processingStore instantly (so the plot re-renders as
 * you type) and are persisted, debounced, to the experiment's
 * ``sample_config.processing`` via experimentStore.updateSampleConfig.
 */
import { useEffect, useRef } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import {
  useProcessingStore,
  type ProcessingDetector,
  type ProcessingField,
} from '../../stores/processingStore';

const DETECTORS: ProcessingDetector[] = ['MALS', 'RI', 'UV'];

export default function AlignmentControls() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const chromatogram = useExperimentStore((s) => s.chromatogram);
  const experimentDetail = useExperimentStore((s) => s.experimentDetail);
  const updateSampleConfig = useExperimentStore((s) => s.updateSampleConfig);

  const processing = useProcessingStore((s) => s.processing);
  const loadFromConfig = useProcessingStore((s) => s.loadFromConfig);
  const setField = useProcessingStore((s) => s.setField);
  const reset = useProcessingStore((s) => s.reset);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted processing when the experiment (or its sample_config) loads.
  // Reloading from our own idempotent writes is harmless — sanitize yields the
  // same config we just set.
  const sampleConfig = experimentDetail?.sample_config;
  useEffect(() => {
    const cfg = (sampleConfig as { processing?: unknown } | null)?.processing;
    loadFromConfig((cfg as Parameters<typeof loadFromConfig>[0]) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentExperimentId, sampleConfig]);

  const availableDetectors = DETECTORS.filter(
    (d) => chromatogram?.detectors?.[d],
  );

  if (currentExperimentId == null || availableDetectors.length === 0) return null;

  const persist = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Read the latest store value at flush time.
      const latest = useProcessingStore.getState().processing;
      updateSampleConfig({ processing: latest }).catch(() => {
        /* surfaced elsewhere; keep the live view regardless */
      });
    }, 600);
  };

  const onChange = (det: ProcessingDetector, field: ProcessingField, raw: string) => {
    const value = raw === '' || raw === '-' ? 0 : Number(raw);
    if (!Number.isFinite(value)) return;
    setField(det, field, value);
    persist();
  };

  const handleReset = () => {
    reset();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    updateSampleConfig({ processing: {} }).catch(() => {});
  };

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Align &amp; Broaden
        </span>

        {availableDetectors.map((det) => {
          const p = processing[det] ?? {};
          return (
            <div
              key={det}
              className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1"
            >
              <span className="text-xs font-semibold text-slate-500 w-9">{det}</span>
              <label className="flex items-center gap-1 text-[11px] text-slate-500">
                shift
                <input
                  type="number"
                  step={0.01}
                  value={p.shift ?? 0}
                  onChange={(e) => onChange(det, 'shift', e.target.value)}
                  className="w-16 text-xs px-1 py-0.5 border border-slate-300 rounded font-mono text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400"
                  title={`${det} time shift (min) — aligns this detector's peak`}
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-slate-500">
                σ
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  value={p.broaden ?? 0}
                  onChange={(e) => onChange(det, 'broaden', e.target.value)}
                  className="w-16 text-xs px-1 py-0.5 border border-slate-300 rounded font-mono text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400"
                  title={`${det} band broadening (Gaussian σ, min)`}
                />
              </label>
            </div>
          );
        })}

        <button
          onClick={handleReset}
          className="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-600 transition-colors"
          title="Clear all alignment / broadening"
        >
          Reset
        </button>
        <span className="text-[11px] text-slate-400">
          shift in min (±), σ = Gaussian width in min
        </span>
      </div>
    </div>
  );
}
