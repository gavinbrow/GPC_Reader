import type { Tab } from '../store';
import { ViewFrame } from '../ui/ViewFrame';
import { openSample, pickFiles } from '../actions';

const SHORTCUTS: [string, string][] = [
  ['Ctrl+O', 'Open experiment'],
  ['Ctrl+S', 'Save method'],
  ['Ctrl+P', 'Print report'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo the last edit in the current view'],
  ['Ctrl+Enter', 'Apply the changes in the current view'],
  ['Alt+W', 'Close the current tab (middle-click also closes a tab)'],
  ['Alt+PgDn / Alt+PgUp', 'Next / previous tab'],
  ['F1', 'This guide'],
  ['D / Z / P / A', 'Peaks & Baselines: draw mode, zoom mode, pan mode, autoscale'],
  ['Esc', 'Peaks & Baselines: back to draw mode'],
  ['Delete', 'Peaks: delete the selected peak'],
  ['← / →', 'Peaks: select the previous / next peak. Molar Mass: previous / next slice (Shift = 10 slices)'],
  ['↑ / ↓', 'Baselines: previous / next signal. Molar Mass: previous / next peak'],
  ['Home / End', 'Molar Mass: first / last slice of the peak'],
  ['Double-click graph', 'Autoscale'],
];

export function AboutView({ tab }: { tab: Tab }) {
  return (
    <ViewFrame
      tab={tab}
      main={
        <div className="report" style={{ maxWidth: 980 }}>
          <h1>OpenMALS</h1>
          <p>
            An open-source, browser-based tool for analysing size-exclusion chromatography with multi-angle light scattering
            (SEC-MALS / GPC-MALS) data. It reads Wyatt ASTRA experiment files (<code>.afe8</code>) directly and reproduces the
            ASTRA data-analysis workflow. Everything runs locally in your browser — files are never uploaded.
          </p>
          <p>
            <button className="link" onClick={() => pickFiles('.afe8')}>Open an experiment</button> ·{' '}
            <button className="link" onClick={openSample}>open the bundled PS 30 kDa sample</button>
          </p>

          <h2>Workflow</h2>
          <ol>
            <li><b>Basic Collection</b> – raw detector signals as collected (LS detectors, UV, dRI, viscometer, HPLC pressure/flow).</li>
            <li><b>Despiking</b> – removes isolated spikes (Hampel filter; Low / Normal / High).</li>
            <li><b>Baselines</b> – one signal at a time (pick it in the list or with ↑/↓); drag on the graph to set its baseline range, drag the end points to adjust. Snap-Y averages the data at the end points, Autofind places them automatically, Set All copies the range to every signal.</li>
            <li><b>Alignment</b> – interdetector volumes from a narrow standard so every detector sees the same slice of sample.</li>
            <li><b>Band Broadening</b> – Gaussian (instrumental) + exponential (mixing) terms that broaden the upstream detectors to match the concentration detector.</li>
            <li><b>Normalization</b> – relates each LS detector to the 90° detector using an isotropic scatterer (radius correction available).</li>
            <li><b>Peaks</b> – drag on the graph to add a peak; drag its edges to adjust. Click a peak (or its number in the table) to select it and press Delete to remove it. Each peak has its own dn/dc, UV extinction, A2, injected mass, LS model and fit degree.</li>
            <li><b>Molar Mass &amp; Radius from LS</b> – per-slice Zimm / Debye / Berry fit. Scan the slices with ←/→ and switch peaks with ↑/↓ or by clicking a peak; enable or disable detectors.</li>
            <li><b>Results Fitting</b> – polynomial / exponential fits of molar mass or radius vs. time to smooth the distributions.</li>
            <li><b>Distribution Analysis</b> – cumulative and differential weight fractions with user ranges.</li>
            <li><b>Results</b> – report, peak results, peak statistics (column performance), slice table, conformation and Mark–Houwink plots; <b>EASI Graph / Table</b> compare experiments.</li>
          </ol>
          <p>
            Edits in a procedure are drafts until you press <b>Apply</b> or <b>OK</b> (Cancel discards them), as in ASTRA; every edit can be undone.
            Graphs: drag to zoom (in the Peaks and Baselines views choose <b>Zoom</b> first, since a plain drag draws a range there), double-click
            to autoscale, mouse wheel zooms time (Ctrl+wheel zooms the y axis), right-click for image and data export, legend check boxes show or
            hide signals. Save the processing parameters with <i>File → Save Method</i> and apply them to other experiments with <i>File → Apply Method</i>.
            Drag the edge of the experiments pane to resize it.
          </p>

          <h2 id="shortcuts">Keyboard shortcuts</h2>
          <table className="shortcut-table">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k}>
                  <td>
                    {k.split(' / ').map((x, i) => (
                      <span key={x}>
                        {i > 0 && ' / '}
                        <kbd>{x}</kbd>
                      </span>
                    ))}
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Theory</h2>
          <p>
            Rayleigh ratio <code>R(θ) = A · N(θ) · ΔV(θ) · n₀²</code> (A: calibration constant, N: normalization coefficient, ΔV: baseline-subtracted
            detector voltage, n₀: solvent refractive index). Optical constant <code>K* = 4π² n₀² (dn/dc)² / (N<sub>A</sub> λ₀⁴)</code>.
            Concentration from the refractometer <code>c = Δn / (dn/dc)</code> or from UV <code>c = A / (ε l)</code>.
          </p>
          <ul>
            <li>Zimm: <code>K*c/R(θ) = 1/M · (1 + 16π²⟨r²⟩ sin²(θ/2) / 3λ²) + 2A₂c</code></li>
            <li>Debye: <code>R(θ)/K*c = M · (1 − 16π²⟨r²⟩ sin²(θ/2) / 3λ²) − 2A₂cM²</code></li>
            <li>Berry: <code>√(K*c/R(θ))</code> vs <code>sin²(θ/2)</code></li>
          </ul>
          <p>
            λ = λ₀/n₀ is the wavelength in the solvent. Moments: Mn = Σc/Σ(c/M), Mw = ΣcM/Σc, Mz = ΣcM²/ΣcM; rms radius moments
            average ⟨r²⟩ with number, weight and z weights. Uncertainties propagate the per-slice fit uncertainties. Intrinsic viscosity
            [η] = η<sub>sp</sub>/c (or Solomon–Ciuta) and R<sub>h</sub> = (3[η]M / 10πN<sub>A</sub>)<sup>1/3</sup>.
          </p>

          <h2>Compatibility notes</h2>
          <ul>
            <li>Reads ASTRA 7/8 <code>.afe8</code> files: DAWN / miniDAWN light scattering, Optilab refractometers, HPLC UV detectors, viscometers on LS auxiliary inputs and HPLC pump traces, together with the baselines, peaks, angles and calibration constants stored in the file.</li>
            <li>The <i>Stored ASTRA Results</i> view lists the numbers ASTRA saved in the file next to OpenMALS's current results.</li>
            <li>dRI data are used as stored (refractive index units). If your ASTRA installation applies an additional scale to the refractometer signal, set <i>RI data scale</i> in Configuration.</li>
            <li>Instrument control and data collection (Sequences, Instruments) are outside the scope of this tool.</li>
          </ul>

          <h2>License</h2>
          <p>MIT. ASTRA, DAWN, Optilab and ViscoStar are trademarks of Wyatt Technology; this project is independent and not affiliated with Wyatt.</p>
        </div>
      }
    />
  );
}
