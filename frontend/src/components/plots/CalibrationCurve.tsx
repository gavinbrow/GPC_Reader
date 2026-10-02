/**
 * CalibrationCurve — log(M) vs elution volume with fitted polynomial curve.
 *
 * Reads resultsStore.calibration and renders scatter (data points) plus a
 * line trace (fitted curve). The R² is shown as an annotation. Fetches on
 * mount / experiment change via fetchCalibration (degree defaults to 3 on the
 * backend when not specified). The degree is set from the CalibrationPanel
 * analysis panel in the Advanced right-tab; this plot reads whatever is
 * already in the store.
 */
import { useEffect, useMemo, lazy, Suspense } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useExperimentStore } from '../../stores/experimentStore';
import { useResultsStore } from '../../stores/resultsStore';

const Plot = lazy(() => import('react-plotly.js'));

function fmtNum(v: number | null | undefined, digits = 4): string {
  if (v == null) return '—';
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

export default function CalibrationCurve() {
  const currentExperimentId = useExperimentStore((s) => s.currentExperimentId);
  const calibration = useResultsStore((s) => s.calibration);
  const loading = useResultsStore((s) => s.loading);
  const error = useResultsStore((s) => s.error);
  const fetchCalibration = useResultsStore((s) => s.fetchCalibration);

  useEffect(() => {
    if (currentExperimentId == null) return;
    fetchCalibration(currentExperimentId);
  }, [currentExperimentId, fetchCalibration]);

  const hasData = useMemo(() => {
    if (!calibration) return false;
    return (
      calibration.elution_volume.length > 0 &&
      calibration.log_m.length > 0
    );
  }, [calibration]);

  const { data, layout } = useMemo<{
    data: Partial<Data>[];
    layout: Partial<Layout>;
  }>(() => {
    if (!calibration || !hasData) {
      return { data: [], layout: {} };
    }
    const scatterX: number[] = [];
    const scatterY: number[] = [];
    calibration.elution_volume.forEach((ev, i) => {
      const lm = calibration.log_m[i];
      if (ev != null && lm != null && Number.isFinite(ev) && Number.isFinite(lm)) {
        scatterX.push(ev);
        scatterY.push(lm);
      }
    });
    const traces: Partial<Data>[] = [
      {
        x: scatterX,
        y: scatterY,
        type: 'scatter',
        mode: 'markers',
        name: 'Data',
        marker: { size: 5, color: 'rgb(0, 50, 120)' },
      },
    ];

    if (calibration.fit_log_m.length > 0) {
      const lineX: number[] = [];
      const lineY: number[] = [];
      calibration.elution_volume.forEach((ev, i) => {
        const fm = calibration.fit_log_m[i];
        if (ev != null && fm != null && Number.isFinite(ev) && Number.isFinite(fm)) {
          lineX.push(ev);
          lineY.push(fm);
        }
      });
      if (lineX.length > 0) {
        traces.push({
          x: lineX,
          y: lineY,
          type: 'scatter',
          mode: 'lines',
          name: 'Fit',
          line: { color: 'rgb(180, 60, 20)', width: 2 },
        });
      }
    }

    const annotations: NonNullable<Layout['annotations']> = [];
    if (calibration.r_squared != null && Number.isFinite(calibration.r_squared)) {
      annotations.push({
        xref: 'paper',
        yref: 'paper',
        x: 0.02,
        y: 0.98,
        xanchor: 'left',
        yanchor: 'top',
        text: `R² = ${fmtNum(calibration.r_squared, 4)} · ${calibration.calibration_type ?? '—'}`,
        showarrow: false,
        font: { size: 11, color: '#334155' },
        bgcolor: 'rgba(255,255,255,0.7)',
      });
    }

    const plotLayout: Partial<Layout> = {
      title: { text: 'Column Calibration Curve', font: { size: 16 } },
      xaxis: {
        title: { text: 'Elution Volume (min)' },
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      yaxis: {
        title: { text: 'log(M)' },
        gridcolor: '#e2e8f0',
        zeroline: false,
      },
      legend: {
        x: 1,
        y: 1,
        xanchor: 'right',
        yanchor: 'top',
        font: { size: 10 },
        bgcolor: 'rgba(255,255,255,0.8)',
      },
      annotations,
      margin: { l: 60, r: 30, t: 50, b: 50 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      showlegend: true,
      autosize: true,
    };
    return { data: traces, layout: plotLayout };
  }, [calibration, hasData]);

  if (currentExperimentId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-sm">Select an experiment to view calibration</p>
      </div>
    );
  }

  if (loading && !calibration) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading calibration...
      </div>
    );
  }

  if (error && !calibration) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!calibration || !hasData) {
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
        <p className="text-sm">Run analysis to see calibration curve</p>
      </div>
    );
  }

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
    toImageButtonOptions: { format: 'png' as const, filename: 'calibration' },
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