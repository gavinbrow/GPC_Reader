import type { ChartSeries } from '../chart/types';
import type { Tab } from '../store';
import { ChartPane, ToolButton, ViewFrame } from '../ui/ViewFrame';
import { useViewContext } from '../ui/useView';
import { num, sci } from '../ui/format';
import { IconExport, IconPrint } from '../ui/icons';
import { exportResultsCSV, exportSliceCSV } from '../actions';
import { familyTraces } from './PeaksView';
import { activeLines, formatResult } from './ResultsTables';

const PEAK_COLORS = ['#000000', '#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00'];

/** ASTRA-style printable experiment report. */
export function ReportView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  if (!ctx) return null;
  const { experiment: e, method: m, processed: p } = ctx;
  const groups = activeLines(p.peaks);

  const mvt: ChartSeries[] = [
    ...familyTraces(p).map((s) => ({ ...s, axis: `rel:${s.id}` })),
    ...p.peaks.map((pr, i) => ({
      id: `M${i}`,
      label: `Molar Mass ${pr.peak.name}`,
      x: pr.t,
      y: pr.Mused,
      color: PEAK_COLORS[i % PEAK_COLORS.length],
      style: 'dots' as const,
      markerSize: 2,
    })),
  ];
  const tMin = Math.min(...m.peaks.map((x) => x.start));
  const tMax = Math.max(...m.peaks.map((x) => x.end));
  const pad = 0.15 * (tMax - tMin || 1);
  const dist: ChartSeries[] = p.peaks
    .filter((pr) => pr.distribution.mass)
    .map((pr, i) => ({
      id: `W${i}`,
      label: `cumulative ${pr.peak.name}`,
      x: pr.distribution.mass!.x,
      y: pr.distribution.mass!.cumulative,
      color: PEAK_COLORS[i % PEAK_COLORS.length],
      style: 'line' as const,
    }));

  const kv = (rows: [string, string | number][]) => (
    <table>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{typeof v === 'number' ? num(v) : v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ViewFrame
      tab={tab}
      toolbar={
        <>
          <ToolButton icon={<IconPrint />} onClick={() => window.print()}>
            Print / Save as PDF
          </ToolButton>
          <ToolButton icon={<IconExport />} onClick={exportResultsCSV}>
            Export Results CSV
          </ToolButton>
          <ToolButton icon={<IconExport />} onClick={() => exportSliceCSV(e.id)}>
            Export Slice Data CSV
          </ToolButton>
        </>
      }
      main={
        <div className="report">
          <h1>Experiment report: {e.name}</h1>
          <div className="muted">
            Generated {new Date().toLocaleString()} by OpenMALS · source file {e.fileName}
            {e.astraVersion ? ` (collected with ASTRA ${e.astraVersion})` : ''}
          </div>

          <h2>Results</h2>
          {p.peaks.length ? (
            <table>
              <thead>
                <tr>
                  <th />
                  {p.peaks.map((pr) => (
                    <th key={pr.peak.id}>{pr.peak.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((g) => [
                  <tr key={g.group}>
                    <td colSpan={p.peaks.length + 1}>
                      <b>{g.group}</b>
                    </td>
                  </tr>,
                  ...g.lines.map((l) => (
                    <tr key={g.group + l.label}>
                      <td>
                        {l.label}
                        {l.unit ? ` (${l.unit})` : ''}
                      </td>
                      {p.peaks.map((pr) => (
                        <td key={pr.peak.id}>{formatResult(l, l.get(pr.moments, pr))}</td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          ) : (
            <p className="muted">No peaks defined.</p>
          )}
          {p.peaks.some((pr) => pr.warnings.length) && (
            <ul>
              {p.peaks.flatMap((pr) => pr.warnings.map((w, i) => <li key={pr.peak.id + i}>{`${pr.peak.name}: ${w}`}</li>))}
            </ul>
          )}

          {p.peaks.length > 0 && (
            <>
              <h2>Molar mass vs. time</h2>
              <div className="report-graph">
                <ChartPane
                  primary={false}
                  title="Molar Mass vs. Time"
                  series={mvt}
                  legend="top"
                  xAxis={{ label: 'time (min)', min: tMin - pad, max: tMax + pad }}
                  yAxis={{ label: 'Molar Mass (g/mol)', log: true }}
                  regions={m.peaks.map((pk) => ({ id: pk.id, x1: pk.start, x2: pk.end, label: pk.name }))}
                />
              </div>
              {dist.length > 0 && (
                <>
                  <h2>Cumulative molar mass distribution</h2>
                  <div className="report-graph">
                    <ChartPane
                      primary={false}
                      title="Cumulative Weight Fraction"
                      series={dist}
                      legend="top"
                      xAxis={{ label: 'Molar Mass (g/mol)', log: true }}
                      yAxis={{ label: 'Cumulative Weight Fraction', min: 0, max: 1 }}
                    />
                  </div>
                </>
              )}
            </>
          )}

          <h2>Peaks</h2>
          <table>
            <thead>
              <tr>
                <th>Peak</th>
                <th>Start (min)</th>
                <th>Stop (min)</th>
                <th>dn/dc (mL/g)</th>
                <th>UV ext. (mL/(mg cm))</th>
                <th>A2 (mol mL/g²)</th>
                <th>Injected mass (µg)</th>
                <th>LS model</th>
                <th>Fit degree</th>
                <th>Results fit</th>
              </tr>
            </thead>
            <tbody>
              {m.peaks.map((pk) => (
                <tr key={pk.id}>
                  <td>{pk.name}</td>
                  <td>{pk.start.toFixed(3)}</td>
                  <td>{pk.end.toFixed(3)}</td>
                  <td>{pk.dndc.toFixed(4)}</td>
                  <td>{pk.uvExtinction.toFixed(4)}</td>
                  <td>{sci(pk.a2)}</td>
                  <td>{(pk.injectedMass * 1e6).toFixed(2)}</td>
                  <td>{pk.lsModel}</td>
                  <td>{pk.fitDegree}</td>
                  <td>{m.massFit[pk.id]?.model === 'None' || !m.massFit[pk.id] ? 'None' : `${m.massFit[pk.id].model} (${m.massFit[pk.id].order})`}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Configuration</h2>
          {kv([
            ['Configuration', e.configurationName || '—'],
            ['Solvent', `${e.solvent.name} (n = ${m.solventRI.toFixed(4)} at ${m.ls.wavelength.toFixed(1)} nm)`],
            ['Flow rate (mL/min)', m.flowRate],
            ['Injection volume (µL)', e.collection.injectionVolume],
            ['Concentration source', m.concentrationSource + (m.hundredPercentRecovery ? ' (100% recovery)' : '')],
            ...(e.ls
              ? ([
                  ['Light scattering', `${e.ls.name} — λ ${m.ls.wavelength} nm, calibration constant ${sci(m.ls.calibrationConstant, 4)} 1/(V cm), ${e.ls.temperature} °C`],
                ] as [string, string][])
              : []),
            ...(e.ri ? ([['Refractometer', `${e.ri.name} — λ ${e.ri.wavelength} nm${m.riScale !== 1 ? `, dRI scale ${m.riScale}` : ''}`]] as [string, string][]) : []),
            ...(e.uv ? ([['UV detector', `${e.uv.name} — channel ${m.uvChannel + 1}, cell ${m.uvCellLength} cm`]] as [string, string][]) : []),
            ...(e.vis ? ([['Viscometer', `${e.vis.name} (${e.vis.source})`]] as [string, string][]) : []),
          ])}

          <h2>Processing</h2>
          {kv([
            ['Despiking', m.despike.enabled ? m.despike.level : 'Off'],
            ['Interdetector volumes (mL)', `UV ${m.delays.UV.toFixed(4)} · RI ${m.delays.RI.toFixed(4)} · VIS ${m.delays.VIS.toFixed(4)}`],
            [
              'Band broadening',
              m.bandBroadening.enabled
                ? Object.entries(m.bandBroadening.terms)
                    .map(([k, t]) => `${k}: instr. ${t.instrumental.toFixed(1)} µL, mixing ${t.mixing.toFixed(1)} µL`)
                    .join(' · ')
                : 'Off',
            ],
          ])}
          {e.ls && (
            <table>
              <thead>
                <tr>
                  <th>Detector</th>
                  {m.ls.angles.map((_, i) => (
                    <th key={i}>{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Angle in solvent (°)</td>
                  {m.ls.angles.map((a, i) => (
                    <td key={i}>{a.toFixed(2)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Normalization coefficient</td>
                  {m.ls.normalization.map((a, i) => (
                    <td key={i}>{a.toFixed(4)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Enabled</td>
                  {m.ls.enabled.map((a, i) => (
                    <td key={i}>{a ? 'yes' : 'no'}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          <table>
            <thead>
              <tr>
                <th>Baseline</th>
                <th>Style</th>
                <th>X1 (min)</th>
                <th>Y1</th>
                <th>X2 (min)</th>
                <th>Y2</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(p.series)
                .filter((s) => s.baseline)
                .map((s) => (
                  <tr key={s.raw.id}>
                    <td>{s.raw.id}</td>
                    <td>{s.baseline!.style}</td>
                    <td>{s.baseline!.x1.toFixed(4)}</td>
                    <td>{sci(s.baseline!.y1, 4)}</td>
                    <td>{s.baseline!.x2.toFixed(4)}</td>
                    <td>{sci(s.baseline!.y2, 4)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}
