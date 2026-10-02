import { useMemo, useRef, useState, useEffect, lazy, Suspense } from 'react';
import type { Data, Layout, PlotRelayoutEvent } from 'plotly.js';

import { useExperimentStore } from '../../stores/experimentStore';
import { useBaselineStore } from '../../stores/baselineStore';
import { usePeakStore } from '../../stores/peakStore';
import { useProcessingStore } from '../../stores/processingStore';
import { applyShift, gaussianBroaden1d } from '../../lib/processing';
import ZoomControls from './ZoomControls';
import BaselineEditor, { buildBaselineShapes } from './BaselineEditor';
import PeakSelector, { buildPeakShapes } from './PeakSelector';
import AlignmentControls from './AlignmentControls';

// Lazy load react-plotly.js to keep initial bundle smaller
const Plot = lazy(() => import('react-plotly.js'));

// Color gradient generator: light to dark
function gradientColors(start: [number, number, number], end: [number, number, number], steps: number): string[] {
  const colors: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const r = Math.round(start[0] + (end[0] - start[0]) * t);
    const g = Math.round(start[1] + (end[1] - start[1]) * t);
    const b = Math.round(start[2] + (end[2] - start[2]) * t);
    colors.push(`rgb(${r}, ${g}, ${b})`);
  }
  return colors;
}

const MALS_COLORS_START: [number, number, number] = [135, 206, 250]; // light blue
const MALS_COLORS_END: [number, number, number] = [0, 50, 120]; // dark blue

const UV_COLORS_START: [number, number, number] = [255, 200, 100]; // light amber
const UV_COLORS_END: [number, number, number] = [150, 50, 0]; // dark amber

const RI_COLOR = 'rgb(34, 139, 34)'; // green

export default function ChromatogramPlot() {
  const plotRef = useRef<HTMLDivElement>(null);
  // The actual Plotly graph div (captured on init/update). The overlay
  // controls attach Plotly event-emitter listeners and issue relayout calls
  // against this element.
  const [graphDiv, setGraphDiv] = useState<HTMLElement | null>(null);
  const {
    chromatogram,
    chromatogramBaselineSubtracted,
    chromatogramLoading,
    chromatogramError,
    experimentDetail,
    detectorSelection,
    currentExperimentId,
    fetchBaselineSubtractedChromatogram,
    clearBaselineSubtractedChromatogram,
  } = useExperimentStore();
  const baselines = useBaselineStore((s) => s.baselines);
  const selectedBaselineDetector = useBaselineStore((s) => s.selectedBaselineDetector);
  const baselineSubtractedPreview = useBaselineStore((s) => s.baselineSubtractedPreview);
  const peaks = usePeakStore((s) => s.peaks);
  const selectedPeakId = usePeakStore((s) => s.selectedPeakId);
  const processing = useProcessingStore((s) => s.processing);

  const effectiveChromatogram = baselineSubtractedPreview
    ? chromatogramBaselineSubtracted ?? chromatogram
    : chromatogram;

  useEffect(() => {
    if (currentExperimentId == null) return;
    if (baselineSubtractedPreview) {
      fetchBaselineSubtractedChromatogram(currentExperimentId);
    } else {
      clearBaselineSubtractedChromatogram();
    }
  }, [currentExperimentId, baselineSubtractedPreview, fetchBaselineSubtractedChromatogram, clearBaselineSubtractedChromatogram]);

  // Build Plotly traces based on selected detectors
  const { data, layout } = useMemo<{ data: Partial<Data>[]; layout: Partial<Layout> }>(() => {
    if (!effectiveChromatogram || !effectiveChromatogram.time) {
      return { data: [], layout: {} };
    }

    const traces: Partial<Data>[] = [];
    const yaxes = ['y', 'y2', 'y3'];
    const time = effectiveChromatogram.time;

    // MALS traces
    if (effectiveChromatogram.detectors.MALS) {
      const mals = effectiveChromatogram.detectors.MALS;
      // Each detector carries its own time axis (they are sampled at different
      // rates); fall back to the shared axis for legacy responses.
      const baseTime = mals.time ?? time;
      const proc = processing.MALS ?? {};
      const xTime = applyShift(baseTime, proc.shift ?? 0);
      const colors = gradientColors(MALS_COLORS_START, MALS_COLORS_END, mals.angles.length);
      mals.angles.forEach((angle, i) => {
        if (!detectorSelection.malsAngles.has(i)) return;
        // `data` is stored row-major as [time_index][angle_index]; extract
        // column `i` to get this angle's full time series.
        const col = mals.data.map((row) => row[i]);
        traces.push({
          x: xTime,
          y: gaussianBroaden1d(col, baseTime, proc.broaden ?? 0),
          type: 'scatter',
          mode: 'lines',
          name: `MALS ${angle}°`,
          line: { width: 1.5, color: colors[i] },
          yaxis: yaxes[0],
        });
      });
    }

    // RI trace
    if (effectiveChromatogram.detectors.RI && detectorSelection.ri) {
      const ri = effectiveChromatogram.detectors.RI;
      const baseTime = ri.time ?? time;
      const proc = processing.RI ?? {};
      traces.push({
        x: applyShift(baseTime, proc.shift ?? 0),
        y: gaussianBroaden1d(ri.data, baseTime, proc.broaden ?? 0),
        type: 'scatter',
        mode: 'lines',
        name: ri.name || 'RI',
        line: { width: 1.5, color: RI_COLOR },
        yaxis: yaxes[1],
      });
    }

    // UV traces
    if (effectiveChromatogram.detectors.UV) {
      const uv = effectiveChromatogram.detectors.UV;
      const baseTime = uv.time ?? time;
      const proc = processing.UV ?? {};
      const xTime = applyShift(baseTime, proc.shift ?? 0);
      const colors = gradientColors(UV_COLORS_START, UV_COLORS_END, uv.wavelengths.length);
      uv.wavelengths.forEach((wl, i) => {
        if (!detectorSelection.uvWavelengths.has(i)) return;
        // `data` is [time_index][channel_index]; extract column `i`.
        const col = uv.data.map((row) => row[i]);
        traces.push({
          x: xTime,
          y: gaussianBroaden1d(col, baseTime, proc.broaden ?? 0),
          type: 'scatter',
          mode: 'lines',
          name: `UV ${wl}nm`,
          line: { width: 1.5, color: colors[i] },
          yaxis: yaxes[2],
        });
      });
    }

    const sampleName = experimentDetail?.sample_name || experimentDetail?.sample_config?.name || 'Chromatogram';

    // Build overlay shapes from baseline + peaks
    const currentBaseline =
      baselines.find((b) => b.detector_name === selectedBaselineDetector) ?? null;
    const baselineShapes = buildBaselineShapes(currentBaseline, selectedBaselineDetector);
    const peakShapes = buildPeakShapes(peaks, selectedPeakId);
    const shapes = [...baselineShapes, ...peakShapes];

    const plotLayout: Partial<Layout> = {
      // Preserve the user's zoom/pan across re-renders (detector toggles,
      // baseline/peak edits). Without a stable uirevision every layout rebuild
      // resets the view to full range.
      uirevision: 'chromatogram',
      title: {
        text: baselineSubtractedPreview ? `${sampleName} (baseline subtracted)` : sampleName,
        font: { size: 16 },
      },
      xaxis: {
        title: { text: 'Time (min)' },
        gridcolor: '#e2e8f0',
        zeroline: false,
        domain: [0.08, 1],
      },
      yaxis: {
        title: { text: 'MALS' },
        gridcolor: '#e2e8f0',
        zeroline: false,
        side: 'left',
        domain: [0, 1],
      },
      yaxis2: {
        title: { text: 'RI' },
        gridcolor: 'rgba(0,0,0,0)',
        zeroline: false,
        side: 'left',
        overlaying: 'y',
        showgrid: false,
        anchor: 'free',
        position: 0.02,
      },
      yaxis3: {
        title: { text: 'UV' },
        gridcolor: 'rgba(0,0,0,0)',
        zeroline: false,
        side: 'right',
        overlaying: 'y',
        showgrid: false,
      },
      legend: {
        x: 1,
        y: 1,
        xanchor: 'right',
        yanchor: 'top',
        font: { size: 10 },
        bgcolor: 'rgba(255,255,255,0.8)',
        traceorder: 'normal',
      },
      margin: { l: 60, r: 60, t: 50, b: 50 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      showlegend: true,
      autosize: true,
      shapes: shapes as any,
    };

    return { data: traces, layout: plotLayout };
  }, [effectiveChromatogram, experimentDetail, detectorSelection, baselines, selectedBaselineDetector, peaks, selectedPeakId, baselineSubtractedPreview, processing]);

  if (chromatogramLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400 text-sm">Loading chromatogram...</div>
      </div>
    );
  }

  if (chromatogramError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {chromatogramError}
        </div>
      </div>
    );
  }

  if (!chromatogram) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <svg className="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 13.125 4.5 13.125 7.5 9.375C10.5 5.625 13.5 18.375 16.5 14.625C18 12.75 19.5 12.375 21 12.375" />
        </svg>
        <p className="text-sm">Select an experiment to view its chromatogram</p>
      </div>
    );
  }

  const handleRelayout = (_event: PlotRelayoutEvent) => {
    // ZoomControls / BaselineEditor / PeakSelector handle relayout on the DOM directly
  };

  const config = {
    responsive: true,
    scrollZoom: true, // enable mouse-wheel zoom
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
    toImageButtonOptions: { format: 'png' as const, filename: 'chromatogram' },
  };

  return (
    <div className="flex flex-col h-full">
      <ZoomControls graphDiv={graphDiv} />
      <BaselineEditor graphDiv={graphDiv} />
      <AlignmentControls />
      <PeakSelector graphDiv={graphDiv} />
      <div ref={plotRef} className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              Loading chart library...
            </div>
          }
        >
          <Plot
            data={data as Data[]}
            layout={layout as Layout}
            config={config}
            onRelayout={handleRelayout}
            onInitialized={(_fig, gd) => setGraphDiv(gd as HTMLElement)}
            onUpdate={(_fig, gd) => setGraphDiv(gd as HTMLElement)}
            useResizeHandler={true}
            style={{ width: '100%', height: '100%' }}
          />
        </Suspense>
      </div>
      {chromatogram.downsampled && (
        <div className="px-4 py-1 text-xs text-amber-600 bg-amber-50 border-t border-amber-100">
          ⚠ Data has been downsampled for performance. Zoom in for more detail.
        </div>
      )}
    </div>
  );
}