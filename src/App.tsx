import { useEffect, useState } from 'react';
import { openFiles, openSample, pickFiles } from './actions';
import { useStore } from './store';
import { MainToolbar, MenuBar, Sidebar, StatusBar, TabStrip, tabTitle } from './ui/Shell';
import { ActiveTabContext } from './ui/ViewFrame';
import { ViewHost } from './views';
import { IconClose, IconExperiment, IconOpen } from './ui/icons';

export function App() {
  const st = useStore();
  const [dragging, setDragging] = useState(false);
  const active = st.tabs.find((t) => t.id === st.activeTabId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        pickFiles('.afe8');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.title = active ? `OpenMALS - [${tabTitle(active.view, active.expId)}]` : 'OpenMALS';
  }, [active]);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files);
      }}
    >
      <div className="titlebar">
        <IconExperiment />
        <span>OpenMALS{active ? ` - ${tabTitle(active.view, active.expId)}` : ''}</span>
      </div>
      <MenuBar />
      <MainToolbar />
      {st.error && (
        <div className="error-bar">
          {st.error}
          <button className="icon-btn" onClick={() => st.setError(undefined)}>
            <IconClose />
          </button>
        </div>
      )}
      <div className="workspace">
        <Sidebar />
        <div className="docs">
          <TabStrip />
          <div className="doc-area">
            {st.tabs.map((t) => (
              <div key={t.id} className="doc" style={{ display: t.id === st.activeTabId ? 'flex' : 'none' }}>
                <ActiveTabContext.Provider value={{ active: t.id === st.activeTabId, title: tabTitle(t.view, t.expId) }}>
                  <ViewHost tab={t} />
                </ActiveTabContext.Provider>
              </div>
            ))}
            {!st.tabs.length && <Welcome />}
          </div>
        </div>
      </div>
      <StatusBar />
      {dragging && <div className="drop-overlay">Drop ASTRA .afe8 experiments (or an OpenMALS method .json) to open them</div>}
    </div>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <h1>OpenMALS</h1>
      <p className="welcome-sub">Open-source SEC-MALS / GPC light scattering analysis in your browser.</p>
      <p>
        Open Wyatt ASTRA experiment files (<code>.afe8</code>) to view raw detector data and run the full analysis:
        despiking, baselines, alignment, band broadening, normalization, peaks, molar mass &amp; rms radius from light
        scattering, results fitting, distributions, viscometry and reports. Files never leave your computer.
      </p>
      <div className="welcome-actions">
        <button className="big-btn" onClick={() => pickFiles('.afe8')}>
          <IconOpen size={20} /> Open experiment…
        </button>
        <button className="big-btn" onClick={openSample}>
          <IconExperiment size={20} /> Open sample (PS 30 kDa)
        </button>
      </div>
      <p className="welcome-hint">…or drag &amp; drop .afe8 files anywhere on this window.</p>
    </div>
  );
}
