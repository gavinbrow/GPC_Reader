import { useState, useEffect } from 'react';
import { loadPlotly, onPlotlyEvent } from '../../lib/plotly';

interface ZoomControlsProps {
  graphDiv: HTMLElement | null;
}

export default function ZoomControls({ graphDiv }: ZoomControlsProps) {
  const [xAxisOnly, setXAxisOnly] = useState(false);
  const [timeRange, setTimeRange] = useState<{ start: number; end: number } | null>(null);

  const relayout = async (update: Record<string, unknown>) => {
    if (!graphDiv) return;
    const Plotly = await loadPlotly();
    Plotly.relayout(graphDiv, update);
  };

  const handleReset = () => {
    relayout({
      'xaxis.autorange': true,
      'yaxis.autorange': true,
      'yaxis2.autorange': true,
      'yaxis3.autorange': true,
    });
    setTimeRange(null);
  };

  const handleAutoScale = () => {
    relayout({
      'yaxis.autorange': true,
      'yaxis2.autorange': true,
      'yaxis3.autorange': true,
    });
  };

  const toggleXAxisOnly = () => {
    const next = !xAxisOnly;
    setXAxisOnly(next);
    relayout({
      'yaxis.fixedrange': next,
      'yaxis2.fixedrange': next,
      'yaxis3.fixedrange': next,
    });
  };

  // Listen for relayout events to track the visible time range.
  useEffect(() => {
    const handler = (event: any) => {
      if (event['xaxis.range[0]'] !== undefined && event['xaxis.range[1]'] !== undefined) {
        setTimeRange({
          start: event['xaxis.range[0]'],
          end: event['xaxis.range[1]'],
        });
      } else if (event['xaxis.autorange']) {
        setTimeRange(null);
      }
    };
    return onPlotlyEvent(graphDiv, 'plotly_relayout', handler);
  }, [graphDiv]);

  const fmt = (v: number | undefined) => (v !== undefined ? v.toFixed(2) : '—');

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
      <button
        onClick={handleReset}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-600 transition-colors"
        title="Reset zoom to full view"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
        </svg>
        Reset Zoom
      </button>

      <button
        onClick={handleAutoScale}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-600 transition-colors"
        title="Auto-scale Y axes"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L6 4.5m0 0L9 7.5M6 4.5v15m15-3l-3 3m0 0l-3-3m3 3v-15" />
        </svg>
        Auto-Scale Y
      </button>

      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-2">
        <input
          type="checkbox"
          checked={xAxisOnly}
          onChange={toggleXAxisOnly}
          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
        />
        X-Axis Only Zoom
      </label>

      <div className="ml-auto text-xs text-slate-400 font-mono">
        {timeRange ? (
          <span>
            Time: {fmt(timeRange.start)} – {fmt(timeRange.end)} min
          </span>
        ) : (
          <span>Full range</span>
        )}
      </div>
    </div>
  );
}