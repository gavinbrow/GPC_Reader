import type { ReactNode } from 'react';
import type { Tab } from '../store';
import type { Experiment } from '../afe8/types';
import type { DelayKind, Method } from '../analysis/method';
import { SOLVENT_LIBRARY } from '../analysis/solvent';
import { ViewFrame } from '../ui/ViewFrame';
import { PropertyGrid, type PGCell, type PGRow } from '../ui/PropertyGrid';
import { useViewContext } from '../ui/useView';
import { sci } from '../ui/format';

/** Editable number shown in exponential notation (e.g. calibration constants). */
function sciCell(value: number, onChange: (v: number) => void, title?: string): PGCell {
  return {
    value: sci(value, 4),
    kind: 'text',
    title,
    onChange: (v) => {
      const x = parseFloat(String(v).replace(',', '.'));
      if (Number.isFinite(x) && x !== value) onChange(x);
    },
  };
}

const ro = (v: string | number | undefined, digits?: number, unit?: string): PGCell => ({
  value: v === undefined || v === '' ? '–' : v,
  kind: 'readonly',
  digits,
  unit: typeof v === 'number' ? unit : undefined,
});

/** Display name of the instrument a flow-path node refers to. */
function nodeName(e: Experiment, node: string): { name: string; kind: string } {
  const cls = node.split(' ')[0];
  if (e.ls && e.ls.profileClass === cls) return { name: e.ls.name, kind: 'LS' };
  if (e.ri && e.ri.profileClass === cls) return { name: e.ri.name, kind: 'RI' };
  if (e.uv && e.uv.profileClass === cls) return { name: e.uv.name, kind: 'UV' };
  if (e.vis && e.vis.profileClass === cls) return { name: e.vis.name, kind: 'VIS' };
  return { name: node, kind: 'HPLC' };
}

const KIND_COLORS: Record<string, string> = { LS: '#e53935', RI: '#1e40ff', UV: '#2e9d2e', VIS: '#222', HPLC: '#789' };

/** Schematic of the instrument chain with the fluid-connection volumes between devices. */
function FlowPath({ e, method }: { e: Experiment; method: Method }) {
  const nodes = e.flowPath;
  if (!nodes.length) return <div className="placeholder">No flow path information in this experiment.</div>;
  const items: ReactNode[] = [];
  nodes.forEach((node, i) => {
    const { name, kind } = nodeName(e, node);
    if (i > 0) {
      const c = e.fluidConnections.find((f) => f.from === nodes[i - 1] && f.to === node);
      items.push(
        <div key={`c${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70, color: '#555', fontSize: 11 }}>
          <span>{c ? `${c.volume.toFixed(4)} mL` : ''}</span>
          <span style={{ width: '100%', borderTop: '2px solid #888', position: 'relative', height: 0, margin: '3px 0' }}>
            <span style={{ position: 'absolute', right: -1, top: -6, color: '#888', lineHeight: 1 }}>▶</span>
          </span>
        </div>,
      );
    }
    const d = kind === 'UV' || kind === 'RI' || kind === 'VIS' ? method.delays[kind as DelayKind] : kind === 'LS' ? 0 : undefined;
    items.push(
      <div key={`n${i}`} style={{ border: `2px solid ${KIND_COLORS[kind]}`, borderRadius: 4, padding: '6px 12px', background: '#fff', textAlign: 'center', minWidth: 110 }}>
        <div style={{ fontWeight: 600, color: KIND_COLORS[kind] }}>{kind === 'HPLC' ? 'HPLC' : kind === 'RI' ? 'dRI' : kind}</div>
        <div style={{ fontSize: 11, color: '#444', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
          {name}
        </div>
        {d !== undefined && (
          <div style={{ fontSize: 11, color: '#777' }}>{kind === 'LS' ? 'reference' : `${d >= 0 ? '+' : ''}${d.toFixed(4)} mL vs. LS`}</div>
        )}
      </div>,
    );
  });
  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', gap: 0, padding: '8px 16px', background: '#fafafa' }}>
      <div style={{ display: 'flex', alignItems: 'center', margin: 'auto' }}>
        <span style={{ marginRight: 10, color: '#555', fontWeight: 600 }}>Flow path</span>
        {items}
      </div>
    </div>
  );
}

export function ConfigurationView({ tab }: { tab: Tab }) {
  const ctx = useViewContext(tab);
  if (!ctx) return null;
  const { experiment: e, method, update } = ctx;
  const ls = e.ls;

  const set = (fn: (m: Method) => Method) => update(fn);
  const num = (v: number, onChange: (v: number) => void, digits = 4, unit?: string, title?: string): PGCell => ({
    value: v,
    kind: 'number',
    digits,
    unit,
    title,
    onChange: (x) => onChange(Number(x)),
  });
  const row = (key: string, label: ReactNode, cell: PGCell, title?: string): PGRow => ({ key, label, cells: [cell], title });

  const setLsArray = (key: 'angles' | 'normalization', j: number, v: number) =>
    set((m) => ({ ...m, ls: { ...m.ls, [key]: m.ls[key].map((x, k) => (k === j ? v : x)) } }));

  const general: PGRow[] = [
    row('cfgname', 'Configuration name', ro(e.configurationName)),
    row('file', 'File name', ro(e.fileName)),
    row('ver', 'ASTRA version', ro(e.astraVersion)),
    row('flow', 'Flow rate (mL/min)', num(method.flowRate, (v) => v > 0 && set((m) => ({ ...m, flowRate: v })), 4)),
    row('csrc', 'Concentration source', {
      value: method.concentrationSource,
      kind: 'select',
      options: e.uv ? ['RI', 'UV'] : ['RI'],
      onChange: (v) => set((m) => ({ ...m, concentrationSource: v as Method['concentrationSource'] })),
    }),
    row('rec', '100% mass recovery', {
      value: method.hundredPercentRecovery,
      kind: 'checkbox',
      onChange: (v) => set((m) => ({ ...m, hundredPercentRecovery: !!v })),
    }, 'Rescale the concentration of every peak so that the integrated mass equals the injected mass.'),
    row(
      'riscale',
      'RI data scale',
      num(method.riScale, (v) => v > 0 && set((m) => ({ ...m, riScale: v })), 4, undefined, 'Multiplies the stored dRI values (RIU per stored unit) before the concentration is computed.'),
      'Multiplies the stored dRI values (RIU per stored unit) before the concentration is computed.',
    ),
  ];

  const lsRows: PGRow[] = ls
    ? [
        row('lsname', 'Name', ro(ls.name)),
        row('lsfw', 'Firmware', ro(ls.firmware)),
        row('lswl', 'Wavelength (nm)', num(method.ls.wavelength, (v) => v > 0 && set((m) => ({ ...m, ls: { ...m.ls, wavelength: v } })), 1)),
        row('lscal', 'Calibration constant (1/(V cm))', sciCell(method.ls.calibrationConstant, (v) => set((m) => ({ ...m, ls: { ...m.ls, calibrationConstant: v } })))),
        row('lstemp', 'Cell temperature (°C)', ro(ls.temperature, 1)),
        row('lscell', 'Cell type', ro(ls.cellType)),
        ...method.ls.angles.map((a, j) => ({
          key: `det${j}`,
          label: `Detector ${j + 1}`,
          children: [
            row(`det${j}n`, 'Nominal angle (°)', ro(ls.nominalAngles[j], 2)),
            row(`det${j}a`, 'Angle in solvent (°)', num(a, (v) => setLsArray('angles', j, v), 3)),
            row(`det${j}c`, 'Normalization coefficient', num(method.ls.normalization[j] ?? 1, (v) => setLsArray('normalization', j, v), 4)),
            row(`det${j}e`, 'Enabled', {
              value: method.ls.enabled[j] !== false,
              kind: 'checkbox',
              onChange: (v) => set((m) => ({ ...m, ls: { ...m.ls, enabled: m.ls.angles.map((_, k) => (k === j ? !!v : m.ls.enabled[k] !== false)) } })),
            }),
          ],
        })),
      ]
    : [];

  const T = ls?.temperature ?? 25;
  const libMatch = SOLVENT_LIBRARY.find((s) => Math.abs(s.n + s.dndT * (T - 25) - method.solventRI) < 1e-6);
  const solventRows: PGRow[] = [
    row('sname', 'Name', ro(e.solvent.name)),
    row('sdesc', 'Description', ro(e.solvent.description)),
    row('sri', `Refractive index at ${method.ls.wavelength.toFixed(0)} nm`, num(method.solventRI, (v) => v > 1 && set((m) => ({ ...m, solventRI: v })), 5)),
    row('slib', 'Set from solvent library', {
      value: libMatch?.name ?? '',
      kind: 'select',
      options: [{ value: '', label: libMatch ? libMatch.name : '(choose…)' }, ...SOLVENT_LIBRARY.filter((s) => s !== libMatch).map((s) => ({ value: s.name, label: s.name }))],
      onChange: (v) => {
        const s = SOLVENT_LIBRARY.find((x) => x.name === v);
        if (s) set((m) => ({ ...m, solventRI: s.n + s.dndT * (T - 25) }));
      },
    }, `Sets the refractive index to the library value corrected to the LS cell temperature (${T.toFixed(1)} °C) with dn/dT.`),
    row('slam', 'Wavelength in solvent, λ/n (nm)', ro(method.ls.wavelength / method.solventRI, 2)),
  ];

  const groups: PGRow[] = [
    { key: 'general', label: 'General', defaultOpen: true, children: general },
  ];
  if (ls) groups.push({ key: 'ls', label: 'Light scattering instrument', defaultOpen: true, children: lsRows });
  groups.push({ key: 'solvent', label: 'Solvent', defaultOpen: true, children: solventRows });
  if (e.ri) {
    groups.push({
      key: 'ri',
      label: 'RI instrument',
      defaultOpen: true,
      children: [
        row('rin', 'Name', ro(e.ri.name)),
        row('riw', 'Wavelength (nm)', ro(e.ri.wavelength, 1)),
        row('rit', 'Temperature (°C)', ro(e.ri.temperature, 1)),
        row('ric', 'Calibration constant', ro(e.ri.calibrationConstant, 6)),
      ],
    });
  }
  if (e.uv) {
    const uv = e.uv;
    groups.push({
      key: 'uv',
      label: 'UV instrument',
      defaultOpen: true,
      children: [
        row('uvn', 'Name', ro(uv.name)),
        row('uvl', 'Cell length (cm)', num(method.uvCellLength, (v) => v > 0 && set((m) => ({ ...m, uvCellLength: v })), 3)),
        row('uvch', 'Channel', {
          value: String(method.uvChannel),
          kind: 'select',
          options: Array.from({ length: Math.max(1, uv.channelCount) }, (_, i) => ({
            value: String(i),
            label: `Channel ${i + 1}${uv.wavelengths[i] ? ` (${uv.wavelengths[i]} nm)` : ''}`,
          })),
          onChange: (v) => set((m) => ({ ...m, uvChannel: Number(v) })),
        }),
        row('uvw', 'Wavelengths (nm)', ro(uv.wavelengths.length ? uv.wavelengths.join(', ') : undefined)),
      ],
    });
  }
  if (e.vis) {
    groups.push({
      key: 'vis',
      label: 'Viscometer',
      defaultOpen: true,
      children: [
        row('visn', 'Name', ro(e.vis.name)),
        row('viss', 'Signal source', ro(e.vis.source + (e.vis.auxChannel !== undefined ? ` (aux channel ${e.vis.auxChannel})` : ''))),
        row('visc', 'Calibration constant', ro(e.vis.calibrationConstant, 6)),
        row('vist', 'Temperature (°C)', ro(e.vis.temperature, 1)),
        row('vissc', 'Solomon–Ciuta equation', {
          value: method.viscosity.solomonCiuta,
          kind: 'checkbox',
          onChange: (v) => set((m) => ({ ...m, viscosity: { ...m.viscosity, solomonCiuta: !!v } })),
        }, 'Compute the intrinsic viscosity from sqrt(2(η_sp − ln(1+η_sp)))/c, valid also at high specific viscosity.'),
      ],
    });
  }
  if (e.hplcDevices.length) {
    groups.push({
      key: 'hplc',
      label: 'HPLC devices',
      defaultOpen: true,
      children: e.hplcDevices.map((d, i) => row(`hplc${i}`, `Device ${i + 1}`, ro(d))),
    });
  }

  const delayKinds: [DelayKind, string, boolean][] = [
    ['UV', 'UV delay volume (mL)', !!e.uv],
    ['RI', 'RI delay volume (mL)', !!e.ri],
    ['VIS', 'VIS delay volume (mL)', !!e.vis],
  ];
  groups.push({
    key: 'delays',
    label: 'Interdetector volumes (relative to LS)',
    defaultOpen: true,
    children: delayKinds
      .filter((d) => d[2])
      .map(([k, label]) =>
        row(`d${k}`, label, num(method.delays[k], (v) => set((m) => ({ ...m, delays: { ...m.delays, [k]: v } })), 4), 'Positive values are downstream of the light scattering detector.'),
      ),
  });

  const insts = (['LS', 'UV', 'VIS'] as const).filter((k) => (k === 'LS' ? !!e.ls : k === 'UV' ? !!e.uv : !!e.vis));
  const setTerm = (k: 'LS' | 'UV' | 'VIS', f: 'instrumental' | 'mixing', v: number) =>
    set((m) => ({
      ...m,
      bandBroadening: { ...m.bandBroadening, terms: { ...m.bandBroadening.terms, [k]: { ...m.bandBroadening.terms[k], [f]: Math.max(0, v) } } },
    }));
  groups.push({
    key: 'bb',
    label: 'Band broadening',
    defaultOpen: true,
    children: [
      row('bben', 'Enabled', {
        value: method.bandBroadening.enabled,
        kind: 'checkbox',
        onChange: (v) => set((m) => ({ ...m, bandBroadening: { ...m.bandBroadening, enabled: !!v } })),
      }),
      ...insts.map((k) => ({
        key: `bb${k}`,
        label: k === 'LS' ? 'LS' : k === 'UV' ? 'UV' : 'VIS',
        defaultOpen: true,
        children: [
          row(`bb${k}i`, 'Instrumental term (µL)', num(method.bandBroadening.terms[k].instrumental, (v) => setTerm(k, 'instrumental', v), 2)),
          row(`bb${k}m`, 'Mixing term (µL)', num(method.bandBroadening.terms[k].mixing, (v) => setTerm(k, 'mixing', v), 2)),
        ],
      })),
    ],
  });

  return (
    <ViewFrame
      tab={tab}
      main={<FlowPath e={e} method={method} />}
      bottom={<PropertyGrid columns={['Value']} rows={groups} labelWidth={320} columnWidth={300} />}
      bottomFraction={0.82}
    />
  );
}
