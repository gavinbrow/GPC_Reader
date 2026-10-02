/**
 * ZimmPlot — classic K*c/R vs sin^2(theta/2) + k*c Zimm plot.
 *
 * Reads resultsStore.zimmPlot and renders a scatter plot of the Zimm data
 * points. The x-axis is sin^2(theta/2) + k*c (the Zimm abscissa), and the
 * y-axis is K*c/R(theta). Annotations show A2, Mw, and Rg from the fit.
 * Uses fetchZimmPlot on mount / experiment change.
 */
import { useEffect, useMemo, lazy, Suspense } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';

const Plot = lazy(() => import('react-plotly.js'));

function fmtSci(v: number | null | undefined, digits = 3): string {
  if (v == null) return '\u2014';
  return Number.isFinite(v) ? v.toExponential(digits) : '\u2014';
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null) return '\u2014';
  return Number.isFinite(v) ? v.toFixed(digits) : '\u2014';
}

export default function ZimmPlot() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const zimmPlot = useResultsStore((s) => s.zimmPlot);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchZimmPlot = useResultsStore((s) => s.fetchZimmPlot);

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchZimmPlot(currentExperimentId);
  }, [currentExperimentId, fetchZimmPlot]);

  const { data, layout } = useMemo<{
    data: Partial<Data>[];
    layout: Partial<Layout>;
  }>(() => {
    if (!zimmPlot || zimmPlot.x.length === 0) {
      return { data: [], layout: {} };
    }

    const traces: Partial<Data>[] = [];
    const x: number[] = [];
    const y: number[] = [];
    const colors: number[] = [];

    const angles = zimmPlot.angles;
    const maxAngle = angles.length > 0 ? Math.max(...angles) : 90;
    const minAngle = angles.length > 0 ? Math.min(...angles) : 0;

    zimmPlot.x.forEach((xv, i) => {
      const yv = zimmPlot.y[i];
      if (Number.isFinite(xv) && Number.isFinite(yv)) {
        x.push(xv);
        y.push(yv);
        const a = angles[i] ?? 0;
        colors.push((a - minAngle) / (maxAngle - minAngle || 1));
      }
    });

    traces.push({
      x,
      y,
      type: 'scatter',
      mode: 'markers',
      name: 'Zimm data',
      marker: {
        size: 5,
        color: colors,
        colorscale: 'Viridis',
        showscale: true,
        colorbar: {
          title: { text: 'Angle' },
          thickness: 12,
          len: 0.6,
        },
      },
    });

    const annotations: NonNullable<Layout['annotations']> = [];
    if (zimmPlot.a2 != null || zimmPlot.mw != null || zimmPlot.rg != null) {
      annotations.push({
        xref: 'paper',
        yref: 'paper',
        x: 0.02,
        y: 0.98,
        xanchor: 'left',
        yanchor: 'top',
        text: `A2 = ${fmtSci(zimmPlot.a2)} mol\u00b7g\u207b\u00b2 \u00b7 Mw = ${fmtNum(zimmPlot.mw)} g/mol \u00b7 Rg = ${fmtNum(zimmPlot.rg)} nm`,
        showarrow: false,
        font: { size: 11, color: 'rgb(0, 50, 120)' },
        bgcolor: 'rgba(255,255,255,0.8)',
      });
    }

    const plotLayout: Partial<Layout> = {
      title: { text: 'Zimm Plot', font: { size: 16 } },
      xaxis: {
        title: { text: 'sin\u00b2(\u03b8/2) + k\u00b7c' },
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      yaxis: {
        title: { text: 'K\u00b7c / R(\u03b8)' },
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      annotations,
      margin: { l: 60, r: 60, t: 50, b: 50 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      showlegend: false,
      autosize: true,
    };
    return { data: traces, layout: plotLayout };
  }, [zimmPlot]);

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-sm">Select an experiment to view Zimm plot</p>
      </div>
    );
  }

  if (loading && !zimmPlot) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading Zimm plot...
      </div>
    );
  }

  if (error && !zimmPlot) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!zimmPlot || zimmPlot.x.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <svg
          className="h-16 w-16 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 13.125 4.5 13.125 7.5 9.375C10.5 5.625 13.5 18.375 16.5 14.625C18 12.75 19.5 12.375 21 12.375"
          />
        </svg>
        <p className="text-sm">Run analysis to see Zimm plot</p>
      </div>
    );
  }

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
    toImageButtonOptions: { format: 'png' as const, filename: 'zimm_plot' },
  };

  return (
    <div className="flex-1 overflow-hidden">
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
          useResizeHandler={true}
          style={{ width: '100%', height: '100%' }}
        />
      </Suspense>
    </div>
  );
}