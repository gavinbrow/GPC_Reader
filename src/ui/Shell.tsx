import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  exportResultsCSV,
  exportSignalsCSV,
  exportSliceCSV,
  openSample,
  pickFiles,
  reprocessAll,
  resultsRows,
  saveMethod,
} from '../actions';
import { VIEW_TITLES, useStore, type NavPane, type ViewKind } from '../store';
import {
  IconCamera,
  IconClose,
  IconEasi,
  IconExperiment,
  IconFit,
  IconFolder,
  IconGear,
  IconInstrument,
  IconOpen,
  IconPan,
  IconPrint,
  IconProcedure,
  IconProfile,
  IconResult,
  IconRun,
  IconSave,
  IconSequence,
  IconTable,
  IconZoomIn,
  IconZoomOut,
  IconZoomRect,
} from './icons';
import { SOLVENT_LIBRARY } from '../analysis/solvent';

/* ------------------------------------------------------------------ menu */

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  sep?: boolean;
  checked?: boolean;
}

export const PROCEDURE_VIEWS: ViewKind[] = [
  'basicCollection',
  'despiking',
  'baselines',
  'alignment',
  'bandBroadening',
  'normalization',
  'peaks',
  'molarMass',
  'resultsFitting',
  'distribution',
];

export const RESULT_VIEWS: ViewKind[] = [
  'report',
  'peakResults',
  'peakStats',
  'sliceTable',
  'massVsTime',
  'conformation',
  'markHouwink',
  'storedResults',
  'log',
  'fileContents',
];

function useMenus(): { title: string; items: MenuItem[] }[] {
  const st = useStore();
  const hasExp = !!st.selectedExpId;
  const open = (v: ViewKind) => () => st.openView(v);
  const activeTab = st.tabs.find((t) => t.id === st.activeTabId);
  return [
    {
      title: 'File',
      items: [
        { label: 'Open Experiment…', shortcut: 'Ctrl+O', action: () => pickFiles('.afe8') },
        { label: 'Open Sample Experiment (PS 30 kDa)', action: openSample },
        { label: '', sep: true },
        { label: 'Close Experiment', disabled: !hasExp, action: () => st.selectedExpId && st.closeExperiment(st.selectedExpId) },
        { label: 'Close All Experiments', disabled: !st.experiments.length, action: () => st.experiments.forEach((x) => st.closeExperiment(x.experiment.id)) },
        { label: '', sep: true },
        { label: 'Save Method…', disabled: !hasExp, action: () => saveMethod() },
        { label: 'Apply Method to Experiment…', disabled: !hasExp, action: () => pickFiles('.json') },
        { label: '', sep: true },
        { label: 'Export Peak Results (CSV)', disabled: !st.experiments.length, action: exportResultsCSV },
        { label: 'Export Slice Results (CSV)', disabled: !hasExp, action: () => exportSliceCSV() },
        { label: 'Export Processed Signals (CSV)', disabled: !hasExp, action: () => exportSignalsCSV() },
        { label: '', sep: true },
        { label: 'Print Report…', shortcut: 'Ctrl+P', disabled: !hasExp, action: () => { st.openView('report'); setTimeout(() => window.print(), 300); } },
      ],
    },
    {
      title: 'Edit',
      items: [
        { label: 'Save Graph Image (PNG)', disabled: !activeTab, action: () => st.chartCommand('png') },
        { label: 'Copy Peak Results', disabled: !st.experiments.length, action: () => copyResults() },
      ],
    },
    {
      title: 'View',
      items: [
        { label: 'Experiments Pane', checked: !st.sidebarCollapsed, action: st.toggleSidebar },
        { label: '', sep: true },
        { label: 'Zoom Mode', checked: st.chartMode === 'zoom', action: () => st.setChartMode('zoom') },
        { label: 'Pan Mode', checked: st.chartMode === 'pan', action: () => st.setChartMode('pan') },
        { label: 'Zoom In', action: () => st.chartCommand('zoomIn') },
        { label: 'Zoom Out', action: () => st.chartCommand('zoomOut') },
        { label: 'Autoscale', action: () => st.chartCommand('reset') },
      ],
    },
    {
      title: 'Experiment',
      items: [
        { label: 'Configuration', disabled: !hasExp, action: open('configuration') },
        { label: 'Report', disabled: !hasExp, action: open('report') },
        { label: '', sep: true },
        { label: 'Run (Reprocess All)', action: reprocessAll },
      ],
    },
    {
      title: 'Processing',
      items: PROCEDURE_VIEWS.map((v): MenuItem => ({ label: VIEW_TITLES[v], disabled: !hasExp, action: open(v) })).concat([
        { label: '', sep: true },
        { label: VIEW_TITLES.viscometry, disabled: !hasExp, action: open('viscometry') },
      ]),
    },
    {
      title: 'Results',
      items: RESULT_VIEWS.map((v): MenuItem => ({ label: VIEW_TITLES[v], disabled: !hasExp, action: open(v) })).concat([
        { label: '', sep: true },
        { label: 'EASI Graph', disabled: !st.experiments.length, action: () => st.openView('easiGraph') },
        { label: 'EASI Table', disabled: !st.experiments.length, action: () => st.openView('easiTable') },
      ]),
    },
    {
      title: 'Window',
      items: [
        { label: 'Close Tab', disabled: !activeTab, action: () => activeTab && st.closeTab(activeTab.id) },
        { label: 'Close All Tabs', disabled: !st.tabs.length, action: () => st.tabs.forEach((t) => st.closeTab(t.id)) },
        ...(st.tabs.length ? [{ label: '', sep: true }] : []),
        ...st.tabs.map((t) => ({ label: tabTitle(t.view, t.expId), checked: t.id === st.activeTabId, action: () => st.activateTab(t.id) })),
      ],
    },
    {
      title: 'Help',
      items: [
        { label: 'About OpenMALS / User Guide', action: () => st.openView('about') },
        { label: 'Source code on GitHub', action: () => window.open('https://github.com/gavinbrow/GPC_Reader', '_blank') },
      ],
    },
  ];
}

async function copyResults() {
  const tsv = resultsRows()
    .map((r) => r.map((v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v ?? ''))).join('\t'))
    .join('\n');
  await navigator.clipboard.writeText(tsv);
  useStore.getState().setStatus('Peak results copied to the clipboard');
}

export function tabTitle(view: ViewKind, expId?: string): string {
  const name = expId ? useStore.getState().experiments.find((x) => x.experiment.id === expId)?.experiment.name : undefined;
  return name ? `${name}: ${VIEW_TITLES[view]}` : VIEW_TITLES[view];
}

export function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="menubar" ref={ref}>
      {menus.map((m, i) => (
        <div key={m.title} className="menu" onMouseEnter={() => open !== null && setOpen(i)}>
          <button className={'menu-title' + (open === i ? ' open' : '')} onClick={() => setOpen(open === i ? null : i)}>
            {m.title}
          </button>
          {open === i && (
            <div className="menu-drop">
              {m.items.map((it, k) =>
                it.sep ? (
                  <div key={k} className="menu-sep" />
                ) : (
                  <button
                    key={k}
                    className="menu-item"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.action?.();
                    }}
                  >
                    <span className="menu-check">{it.checked ? '✓' : ''}</span>
                    <span className="menu-label">{it.label}</span>
                    <span className="menu-shortcut">{it.shortcut}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ toolbar */

export function MainToolbar() {
  const st = useStore();
  const hasExp = !!st.selectedExpId;
  const B = ({ icon, label, onClick, title, pressed, disabled }: { icon: ReactNode; label?: string; onClick: () => void; title: string; pressed?: boolean; disabled?: boolean }) => (
    <button className={'tb-btn' + (pressed ? ' pressed' : '')} onClick={onClick} title={title} disabled={disabled}>
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
  return (
    <div className="toolbar">
      <B icon={<IconOpen />} onClick={() => pickFiles('.afe8')} title="Open experiment (.afe8)" />
      <B icon={<IconSave />} onClick={() => saveMethod()} title="Save method (processing parameters)" disabled={!hasExp} />
      <B icon={<IconPrint />} onClick={() => { st.openView('report'); setTimeout(() => window.print(), 300); }} title="Print report" disabled={!hasExp} />
      <span className="tb-sep" />
      <B icon={<IconTable />} label="Report" onClick={() => st.openView('report')} title="Open the experiment report" disabled={!hasExp} />
      <B icon={<IconRun />} label="Run" onClick={reprocessAll} title="Reprocess all experiments" />
      <span className="tb-sep" />
      <B icon={<IconZoomRect />} onClick={() => st.setChartMode('zoom')} title="Zoom mode: drag a rectangle to zoom" pressed={st.chartMode === 'zoom'} />
      <B icon={<IconPan />} onClick={() => st.setChartMode('pan')} title="Pan mode: drag to move the graph" pressed={st.chartMode === 'pan'} />
      <B icon={<IconZoomIn />} onClick={() => st.chartCommand('zoomIn')} title="Zoom in" />
      <B icon={<IconZoomOut />} onClick={() => st.chartCommand('zoomOut')} title="Zoom out" />
      <B icon={<IconFit />} onClick={() => st.chartCommand('reset')} title="Autoscale (or double-click the graph)" />
      <B icon={<IconCamera />} onClick={() => st.chartCommand('png')} title="Save graph as PNG image" />
      <span className="tb-spacer" />
      {st.busy && <span className="tb-busy">Working…</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ sidebar */

const VIEW_ICON: Partial<Record<ViewKind, ReactNode>> = {
  report: <IconTable />,
  peakResults: <IconTable />,
  peakStats: <IconTable />,
  sliceTable: <IconTable />,
  storedResults: <IconTable />,
  log: <IconTable />,
  fileContents: <IconTable />,
};

function TreeItem({ icon, label, onClick, active, depth, toggle, open, bold }: { icon?: ReactNode; label: string; onClick?: () => void; active?: boolean; depth: number; toggle?: () => void; open?: boolean; bold?: boolean }) {
  return (
    <div className={'tree-item' + (active ? ' active' : '')} style={{ paddingLeft: 4 + depth * 14 }} onClick={onClick ?? toggle} title={label}>
      <span className="tree-toggle" onClick={(e) => { if (toggle) { e.stopPropagation(); toggle(); } }}>
        {toggle ? (open ? '⊟' : '⊞') : ''}
      </span>
      {icon}
      <span className={'tree-label' + (bold ? ' bold' : '')}>{label}</span>
    </div>
  );
}

function ExperimentsTree() {
  const st = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (k: string, d = true) => open[k] ?? d;
  const tg = (k: string, d = true) => () => setOpen((o) => ({ ...o, [k]: !isOpen(k, d) }));
  const activeTab = st.tabs.find((t) => t.id === st.activeTabId);
  return (
    <div className="tree">
      <div className="tree-section">Results Comparison</div>
      <TreeItem depth={0} icon={<IconEasi />} label="EASI Graph" onClick={() => st.openView('easiGraph')} active={activeTab?.view === 'easiGraph'} />
      <TreeItem depth={0} icon={<IconEasi />} label="EASI Table" onClick={() => st.openView('easiTable')} active={activeTab?.view === 'easiTable'} />
      <div className="tree-rule" />
      <TreeItem depth={0} icon={<IconExperiment />} label="Experiments" toggle={tg('root')} open={isOpen('root')} />
      {isOpen('root') &&
        st.experiments.map(({ experiment: e }) => {
          const k = e.id;
          const viewItem = (v: ViewKind, depth: number, icon: ReactNode) => (
            <TreeItem
              key={v}
              depth={depth}
              icon={icon}
              label={VIEW_TITLES[v]}
              onClick={() => st.openView(v, e.id)}
              active={activeTab?.view === v && activeTab.expId === e.id}
            />
          );
          return (
            <div key={k}>
              <TreeItem depth={1} icon={<IconExperiment />} label={e.name} bold toggle={tg(k)} open={isOpen(k)} onClick={() => st.selectExperiment(e.id)} active={st.selectedExpId === e.id && !activeTab} />
              {isOpen(k) && (
                <>
                  <TreeItem depth={2} icon={<IconGear />} label={`Configuration (${e.configurationName || 'experiment'})`} onClick={() => st.openView('configuration', e.id)} active={activeTab?.view === 'configuration' && activeTab.expId === e.id} />
                  <TreeItem depth={2} icon={<IconFolder open={isOpen(k + 'p')} />} label="Procedures" toggle={tg(k + 'p')} open={isOpen(k + 'p')} />
                  {isOpen(k + 'p') && PROCEDURE_VIEWS.map((v) => viewItem(v, 3, <IconProcedure />))}
                  {isOpen(k + 'p') && e.vis && viewItem('viscometry', 3, <IconProcedure />)}
                  <TreeItem depth={2} icon={<IconFolder open={isOpen(k + 'r', false)} />} label="Results" toggle={tg(k + 'r', false)} open={isOpen(k + 'r', false)} />
                  {isOpen(k + 'r', false) &&
                    RESULT_VIEWS.filter((v) => v !== 'markHouwink' || !!e.vis).map((v) => viewItem(v, 3, VIEW_ICON[v] ?? <IconResult />))}
                </>
              )}
            </div>
          );
        })}
      {!st.experiments.length && (
        <div className="tree-empty">
          No experiments open.
          <br />
          <button className="link" onClick={() => pickFiles('.afe8')}>Open an .afe8 file…</button>
          <br />
          <button className="link" onClick={openSample}>Open the sample experiment</button>
        </div>
      )}
    </div>
  );
}

function ProfilesPane() {
  return (
    <div className="side-pane">
      <div className="tree-section">Solvent library</div>
      <table className="mini-table">
        <thead>
          <tr>
            <th>Solvent</th>
            <th>n (658 nm)</th>
            <th>η (cP)</th>
          </tr>
        </thead>
        <tbody>
          {SOLVENT_LIBRARY.map((s) => (
            <tr key={s.name} title={s.description}>
              <td>{s.name}</td>
              <td>{s.n.toFixed(4)}</td>
              <td>{s.viscosity.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="side-note">Solvent refractive index can be changed per experiment in Configuration.</p>
    </div>
  );
}

function NotSupportedPane({ what }: { what: string }) {
  return (
    <div className="side-pane">
      <p className="side-note">
        {what} control instruments and data collection. OpenMALS focuses on <b>data analysis</b> of existing ASTRA experiments, so this
        pane is intentionally not available.
      </p>
    </div>
  );
}

export function Sidebar() {
  const st = useStore();
  const navs: { id: NavPane; icon: ReactNode }[] = [
    { id: 'Experiments', icon: <IconExperiment /> },
    { id: 'Sequences', icon: <IconSequence /> },
    { id: 'Profiles', icon: <IconProfile /> },
    { id: 'Instruments', icon: <IconInstrument /> },
  ];
  if (st.sidebarCollapsed) {
    return (
      <div className="sidebar collapsed">
        <button className="icon-btn" onClick={st.toggleSidebar} title="Show experiments pane">»</button>
      </div>
    );
  }
  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <span>{st.nav}</span>
        <button className="icon-btn" onClick={st.toggleSidebar} title="Hide pane">«</button>
      </div>
      <div className="sidebar-body">
        {st.nav === 'Experiments' && <ExperimentsTree />}
        {st.nav === 'Profiles' && <ProfilesPane />}
        {st.nav === 'Sequences' && <NotSupportedPane what="Sequences" />}
        {st.nav === 'Instruments' && <NotSupportedPane what="Instrument profiles" />}
      </div>
      <div className="nav-buttons">
        {navs.map((n) => (
          <button key={n.id} className={'nav-btn' + (st.nav === n.id ? ' active' : '')} onClick={() => st.setNav(n.id)}>
            {n.icon}
            <span>{n.id}</span>
            {n.id === 'Experiments' && st.experiments.length > 0 && <span className="nav-count">{st.experiments.length}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

export function TabStrip() {
  const st = useStore();
  return (
    <div className="tabstrip">
      {st.tabs.map((t) => (
        <div key={t.id} className={'doc-tab' + (t.id === st.activeTabId ? ' active' : '')} onClick={() => st.activateTab(t.id)} onAuxClick={(e) => e.button === 1 && st.closeTab(t.id)}>
          <span>
            {tabTitle(t.view, t.expId)}
            {t.draft ? ' *' : ''}
          </span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              st.closeTab(t.id);
            }}
            title="Close"
          >
            <IconClose size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function StatusBar() {
  const st = useStore();
  return (
    <div className="statusbar">
      <span>{st.status}</span>
      <span className="status-right">
        {st.experiments.length} experiment{st.experiments.length === 1 ? '' : 's'} · all processing runs locally in your browser
      </span>
    </div>
  );
}
