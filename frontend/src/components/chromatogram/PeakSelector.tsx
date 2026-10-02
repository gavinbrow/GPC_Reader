/**
 * PeakSelector — interactive peak region selection overlay for the chromatogram.
 *
 * Interaction approach: peak region rectangles are drawn as Plotly `shapes`
 * (semi-transparent rectangles) computed centrally in ChromatogramPlot's
 * layout (subscribing to peakStore) so they survive Plotly.react re-renders.
 * The rectangles are marked `editable: true` so the user can drag their
 * bodies to move the whole peak and drag the edges to resize. This
 * component provides the toolbar (Auto-Detect button, "Drag to create"
 * hint, peak count) and wires a `plotly_relayout` listener to capture
 * shape edits and PUT them via peakStore. New peak creation uses a
 * "Draw mode" toggle: when on, the user click-drags on the plot to draw a
 * new rectangle (Plotly `dragmode: 'drawrect'`); the resulting rectangle
 * is read from `plotly_relayout` and POSTed as a new peak.
 */
import { useEffect, useState } from 'react';
import { useExperimentStore } from '../../stores/experimentStore';
import { usePeakStore } from '../../stores/peakStore';
import { loadPlotly, onPlotlyEvent } from '../../lib/plotly';
import type { PeakResponse } from '../../types/peak';

interface PeakSelectorProps {
  graphDiv: HTMLElement | null;
}

const PEAK_COLOR = '#2563eb';
const PEAK_SELECTED_COLOR = '#1d4ed8';

function peakShape(
  peak: PeakResponse,
  selected: boolean,
): Record<string, unknown> {
  const start = peak.range_start ?? 0;
  const end = peak.range_end ?? start;
  return {
    type: 'rect',
    xref: 'x',
    yref: 'paper',
    x0: start,
    x1: end,
    y0: 0,
    y1: 1,
    fillcolor: selected ? PEAK_SELECTED_COLOR : PEAK_COLOR,
    line: { color: selected ? PEAK_SELECTED_COLOR : PEAK_COLOR, width: selected ? 2 : 1 },
    opacity: 0.12,
    editable: true,
    layer: 'below',
  };
}

export function buildPeakShapes(
  peaks: PeakResponse[],
  selectedPeakId: number | null,
): Record<string, unknown>[] {
  return peaks
    .filter((p) => p.range_start != null && p.range_end != null)
    .map((p) => peakShape(p, p.id === selectedPeakId));
}

export default function PeakSelector({ graphDiv }: PeakSelectorProps) {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const {
    peaks,
    loading,
    error,
    versionConflict,
    fetchPeaks,
    createPeak,
    updatePeak,
    autoDetectPeaks,
    setSelectedPeakId,
  } = usePeakStore();

  const [drawMode, setDrawMode] = useState(false);

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchPeaks(currentExperimentId);
  }, [currentExperimentId, fetchPeaks]);

  useEffect(() => {
    if (!graphDiv) return;
    let cancelled = false;
    loadPlotly().then((Plotly) => {
      if (cancelled) return;
      Plotly.relayout(graphDiv, { dragmode: drawMode ? 'drawrect' : 'zoom' });
    });
    return () => {
      cancelled = true;
    };
  }, [drawMode, graphDiv]);

  useEffect(() => {
    const el = graphDiv;
    if (!el) return;

    const onClick = (event: any) => {
      if (!event || !event.points || event.points.length === 0) return;
      const pt = event.points[0];
      const x = pt.x as number | undefined;
      if (x == null || !Number.isFinite(x)) return;
      const hit = peaks.find((p) => p.range_start != null && p.range_end != null && x >= (p.range_start as number) && x <= (p.range_end as number));
      if (hit) setSelectedPeakId(hit.id);
    };

    const onRelayout = async (event: any) => {
      if (!event || currentExperimentId == null) return;

      if (event.shapes && Array.isArray(event.shapes)) {
        const shapes = event.shapes as Record<string, unknown>[];
        const rectShapes = shapes.filter((s) => s.type === 'rect');
        if (rectShapes.length === 0) return;

        if (drawMode) {
          const last = rectShapes[rectShapes.length - 1];
          const x0 = Number(last.x0);
          const x1 = Number(last.x1);
          if (Number.isFinite(x0) && Number.isFinite(x1) && Math.abs(x1 - x0) > 1e-6) {
            const body = {
              range_start: Math.min(x0, x1),
              range_end: Math.max(x0, x1),
              is_auto: false,
            };
            await createPeak(currentExperimentId, body);
            setDrawMode(false);
          }
          return;
        }

        // Only peaks with a defined range are rendered as rect shapes, so
        // correlate against that same filtered list to keep the positional
        // shape↔peak mapping aligned.
        const rangedPeaks = peaks.filter(
          (p) => p.range_start != null && p.range_end != null,
        );
        if (rectShapes.length !== rangedPeaks.length) return;
        for (let i = 0; i < rangedPeaks.length; i++) {
          const peak = rangedPeaks[i];
          const shape = rectShapes[i];
          const x0 = Number(shape.x0);
          const x1 = Number(shape.x1);
          if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
          const start = Math.min(x0, x1);
          const end = Math.max(x0, x1);
          if (
            Math.abs(start - (peak.range_start ?? 0)) < 1e-6 &&
            Math.abs(end - (peak.range_end ?? 0)) < 1e-6
          ) {
            continue;
          }
          await updatePeak(
            currentExperimentId,
            peak.id,
            { range_start: start, range_end: end },
            peak.version,
          );
        }
      }
    };

    const offRelayout = onPlotlyEvent(el, 'plotly_relayout', onRelayout);
    const offClick = onPlotlyEvent(el, 'plotly_click', onClick);
    return () => {
      offRelayout();
      offClick();
    };
  }, [graphDiv, peaks, currentExperimentId, drawMode, createPeak, updatePeak, setSelectedPeakId]);

  const handleAutoDetect = async () => {
    if (currentExperimentId == null) return;
    await autoDetectPeaks(currentExperimentId);
  };

  const handleToggleDraw = () => {
    setDrawMode((d) => !d);
  };

  if (currentExperimentId == null) return null;

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Peaks
        </span>

        <button
          onClick={handleToggleDraw}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            drawMode
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-600'
          }`}
          title="Toggle draw mode: click-drag on the plot to create a peak region"
        >
          {drawMode ? 'Drawing… (drag on plot)' : 'Draw Peak'}
        </button>

        <button
          onClick={handleAutoDetect}
          disabled={loading}
          className="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-600 transition-colors disabled:opacity-50"
          title="Auto-detect peaks from the signal"
        >
          Auto-Detect Peaks
        </button>

        {peaks.length > 0 && (
          <span className="text-xs text-slate-500">
            {peaks.length} peak{peaks.length !== 1 ? 's' : ''}
          </span>
        )}

        <span className="ml-auto text-xs text-slate-400">
          Click a region to select · drag edges to resize
        </span>
      </div>

      {error && (
        <div className="mt-1.5 p-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
      {versionConflict && (
        <div className="mt-1.5 p-1.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Version conflict on peak {versionConflict.peakId}: {versionConflict.message}. Peaks reloaded.
        </div>
      )}
    </div>
  );
}