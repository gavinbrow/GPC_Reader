/**
 * BaselineEditor — interactive baseline editor overlay for the chromatogram.
 *
 * Interaction approach: shape geometry is computed centrally in
 * ChromatogramPlot's layout (subscribing to baselineStore) so it survives
 * Plotly.react re-renders. This component renders the toolbar (detector
 * picker, baseline-type picker, Auto-Baseline, Clear, Subtracted preview
 * toggle) and attaches a `plotly_relayout` DOM listener on the plot div to
 * capture user drags of the editable baseline shapes. On a drag release it
 * PUTs the new baseline coords to the backend via baselineStore; the store
 * update triggers ChromatogramPlot to re-render with the persisted shape.
 */

import { useEffect, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { useBaselineStore } from '../../stores/baselineStore';
import { onPlotlyEvent } from '../../lib/plotly';
import type { BaselineResponse, BaselineType } from '../../types/baseline';

interface BaselineEditorProps {
  graphDiv: HTMLElement | null;
}

const DETECTOR_CODES = ['MALS', 'RI', 'UV'] as const;
type DetectorCode = (typeof DETECTOR_CODES)[number];

const BASELINE_TYPE_LABELS: Record<BaselineType, string> = {
  0: 'Constant',
  1: 'Linear',
  2: 'Manual (drag ends)',
};

export function baselineShape(
  b: BaselineResponse,
  yaxis: string,
): Record<string, unknown> {
  const type = (b.baseline_type ?? 1) as BaselineType;
  if (type === 2 && b.x1 != null && b.x2 != null && b.y1 != null && b.y2 != null) {
    return {
      type: 'line',
      xref: 'x',
      yref: yaxis,
      x0: b.x1,
      y0: b.y1,
      x1: b.x2,
      y1: b.y2,
      line: { color: '#dc2626', width: 2.5, dash: 'solid' },
      // Editable so the user can drag either endpoint to place the manual
      // baseline directly on the trace.
      editable: true,
    };
  }
  if (type === 1 && b.slope != null && b.intercept != null) {
    const x0 = b.x1 ?? 0;
    const x1 = b.x2 ?? 1;
    return {
      type: 'line',
      xref: 'x',
      yref: yaxis,
      x0,
      y0: b.slope * x0 + b.intercept,
      x1,
      y1: b.slope * x1 + b.intercept,
      line: { color: '#dc2626', width: 2, dash: 'dash' },
    };
  }
  if (type === 0 && b.intercept != null) {
    const x0 = b.x1 ?? 0;
    const x1 = b.x2 ?? 1;
    return {
      type: 'line',
      xref: 'x',
      yref: yaxis,
      x0,
      y0: b.intercept,
      x1,
      y1: b.intercept,
      line: { color: '#dc2626', width: 2, dash: 'dash' },
    };
  }
  return {
    type: 'line',
    xref: 'x',
    yref: yaxis,
    x0: b.x1 ?? 0,
    y0: b.y1 ?? 0,
    x1: b.x2 ?? 1,
    y1: b.y2 ?? 0,
    line: { color: '#dc2626', width: 2, dash: 'dot' },
  };
}

export function buildBaselineShapes(
  baseline: BaselineResponse | null,
  detector: string | null,
): Record<string, unknown>[] {
  if (!baseline || !detector) return [];
  const yaxis = detector === 'UV' ? 'y3' : detector === 'RI' ? 'y2' : 'y';
  // A single editable line represents the baseline. For the Manual type its two
  // endpoints are draggable (Plotly renders vertex handles on the active
  // editable line); we read the moved endpoints back on plotly_relayout.
  return [baselineShape(baseline, yaxis)];
}

export default function BaselineEditor({ graphDiv }: BaselineEditorProps) {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const chromatogram = useExperimentStore((s) => s.chromatogram);
  const {
    baselines,
    loading,
    error,
    baselineSubtractedPreview,
    selectedBaselineDetector,
    versionConflict,
    fetchBaselines,
    upsertBaseline,
    deleteBaseline,
    autoBaseline,
    setBaselineSubtractedPreview,
    setSelectedBaselineDetector,
  } = useBaselineStore();

  const [dragging, setDragging] = useState(false);

  const availableDetectors: DetectorCode[] = DETECTOR_CODES.filter(
    (code) => chromatogram?.detectors?.[code as 'MALS' | 'RI' | 'UV'],
  );

  const currentBaseline: BaselineResponse | null =
    baselines.find((b) => b.detector_name === selectedBaselineDetector) ?? null;

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchBaselines(currentExperimentId);
  }, [currentExperimentId, fetchBaselines]);

  useEffect(() => {
    if (!selectedBaselineDetector && availableDetectors.length > 0) {
      setSelectedBaselineDetector(availableDetectors[0]);
    }
  }, [selectedBaselineDetector, availableDetectors, setSelectedBaselineDetector]);

  useEffect(() => {
    const el = graphDiv;
    if (!el) return;

    const onRelayout = (event: any) => {
      if (!event || !event.shapes || !selectedBaselineDetector || currentExperimentId == null) return;
      const shapes: Record<string, unknown>[] = event.shapes;
      const lineShape = shapes.find((s) => s.type === 'line') as
        | { x0: number; x1: number; y0: number; y1: number }
        | undefined;
      if (!lineShape) return;
      const detector = selectedBaselineDetector;
      const existing = baselines.find((b) => b.detector_name === detector);
      const baselineType = (existing?.baseline_type ?? 1) as BaselineType;
      const { x0, x1 } = lineShape;
      let body;
      if (baselineType === 2) {
        // Manual baseline: read both endpoints straight off the dragged line.
        const nx1 = lineShape.x0;
        const nx2 = lineShape.x1;
        const ny1 = lineShape.y0;
        const ny2 = lineShape.y1;
        if (
          existing &&
          Math.abs(nx1 - (existing.x1 ?? 0)) < 1e-9 &&
          Math.abs(nx2 - (existing.x2 ?? 0)) < 1e-9 &&
          Math.abs(ny1 - (existing.y1 ?? 0)) < 1e-9 &&
          Math.abs(ny2 - (existing.y2 ?? 0)) < 1e-9
        ) {
          return;
        }
        body = {
          detector_name: detector,
          detector_class: existing?.detector_class ?? null,
          baseline_type: 2 as const,
          x1: nx1,
          x2: nx2,
          y1: ny1,
          y2: ny2,
          is_auto: false,
        };
      } else {
        const nx1 = Math.min(x0, x1);
        const nx2 = Math.max(x0, x1);
        if (
          existing &&
          Math.abs(nx1 - (existing.x1 ?? 0)) < 1e-9 &&
          Math.abs(nx2 - (existing.x2 ?? 0)) < 1e-9
        ) {
          return;
        }
        body = {
          detector_name: detector,
          detector_class: existing?.detector_class ?? null,
          baseline_type: baselineType,
          x1: nx1,
          x2: nx2,
          y1: null,
          y2: null,
          is_auto: false,
        };
      }
      setDragging(true);
      upsertBaseline(currentExperimentId, detector, body, existing?.version).finally(() => {
        setDragging(false);
      });
    };

    return onPlotlyEvent(el, 'plotly_relayout', onRelayout);
  }, [graphDiv, selectedBaselineDetector, baselines, currentExperimentId, upsertBaseline]);

  // Sample a detector's displayed signal at the time closest to `tTarget`, so a
  // freshly created manual baseline lands on the trace instead of at y=0 (which
  // is off-screen for detectors like RI whose signal is ~1e-3).
  const signalYAt = (detector: string, tTarget: number): number => {
    const det = chromatogram?.detectors?.[detector as 'MALS' | 'RI' | 'UV'];
    if (!det || !det.data) return 0;
    const t = det.time ?? chromatogram?.time;
    if (!t || t.length === 0) return 0;
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < t.length; i++) {
      const d = Math.abs(t[i] - tTarget);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    const row = (det.data as number[] | number[][])[idx];
    if (Array.isArray(row)) {
      const finite = row.filter((v) => Number.isFinite(v));
      return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
    }
    return Number.isFinite(row as number) ? (row as number) : 0;
  };

  const handleTypeChange = async (type: BaselineType) => {
    if (!selectedBaselineDetector || currentExperimentId == null) return;
    const existing = baselines.find((b) => b.detector_name === selectedBaselineDetector);
    const t = chromatogram?.time;
    const tMin = t && t.length > 0 ? t[0] : 0;
    const tMax = t && t.length > 0 ? t[t.length - 1] : 1;
    // Inset the manual endpoints slightly and put them on the signal.
    const span = tMax - tMin;
    const mx1 = tMin + span * 0.05;
    const mx2 = tMax - span * 0.05;
    const body =
      type === 2
        ? {
            detector_name: selectedBaselineDetector,
            detector_class: existing?.detector_class ?? null,
            baseline_type: 2 as const,
            x1: mx1,
            x2: mx2,
            y1: signalYAt(selectedBaselineDetector, mx1),
            y2: signalYAt(selectedBaselineDetector, mx2),
            is_auto: false,
          }
        : {
            detector_name: selectedBaselineDetector,
            detector_class: existing?.detector_class ?? null,
            baseline_type: type,
            x1: tMin,
            x2: tMax,
            y1: null,
            y2: null,
            is_auto: false,
          };
    await upsertBaseline(currentExperimentId, selectedBaselineDetector, body, existing?.version);
  };

  const handleAuto = async () => {
    if (currentExperimentId == null) return;
    await autoBaseline(currentExperimentId);
  };

  const handleClear = async () => {
    if (currentExperimentId == null || !selectedBaselineDetector) return;
    const existing = baselines.find((b) => b.detector_name === selectedBaselineDetector);
    await deleteBaseline(currentExperimentId, selectedBaselineDetector, existing?.version);
  };

  const handlePreviewToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBaselineSubtractedPreview(e.target.checked);
  };

  if (currentExperimentId == null) return null;

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Baseline
        </span>

        <select
          value={selectedBaselineDetector ?? ''}
          onChange={(e) => setSelectedBaselineDetector(e.target.value || null)}
          className="text-xs px-2 py-1 border border-slate-300 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400"
        >
          <option value="">— detector —</option>
          {availableDetectors.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        <select
          value={(currentBaseline?.baseline_type ?? 1) as BaselineType}
          onChange={(e) => handleTypeChange(Number(e.target.value) as BaselineType)}
          className="text-xs px-2 py-1 border border-slate-300 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400"
          title="Baseline type"
        >
          {([0, 1, 2] as BaselineType[]).map((t) => (
            <option key={t} value={t}>
              {BASELINE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        <button
          onClick={handleAuto}
          disabled={loading}
          className="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-600 transition-colors disabled:opacity-50"
          title="Auto-detect baselines for all detectors"
        >
          Auto-Baseline
        </button>

        <button
          onClick={handleClear}
          disabled={!currentBaseline}
          className="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-red-50 hover:text-red-600 text-slate-600 transition-colors disabled:opacity-50"
          title="Clear the selected detector's baseline"
        >
          Clear
        </button>

        <label
          className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-1"
          title="Show chromatogram with baselines subtracted"
        >
          <input
            type="checkbox"
            checked={baselineSubtractedPreview}
            onChange={handlePreviewToggle}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
          />
          Baseline Subtracted
        </label>

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          {currentBaseline && currentBaseline.slope != null && (
            <span className="font-mono">
              slope={currentBaseline.slope.toExponential(3)}
            </span>
          )}
          {currentBaseline && currentBaseline.std_dev != null && (
            <span className="font-mono">
              σ={currentBaseline.std_dev.toExponential(3)}
            </span>
          )}
          {currentBaseline?.is_auto && <span className="text-brand-600">auto</span>}
          {dragging && <span className="text-amber-600">dragging…</span>}
        </div>
      </div>

      {error && (
        <div className="mt-1.5 p-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
      {versionConflict && (
        <div className="mt-1.5 p-1.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Version conflict on {versionConflict.detector}: {versionConflict.message}. Baselines reloaded.
        </div>
      )}
    </div>
  );
}