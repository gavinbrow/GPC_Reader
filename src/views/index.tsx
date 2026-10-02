import { Component, type ComponentType, type ReactNode } from 'react';
import type { Tab, ViewKind } from '../store';
import { VIEW_TITLES, useStore } from '../store';
import { BasicCollectionView } from './BasicCollectionView';
import { DespikingView } from './DespikingView';
import { BaselinesView } from './BaselinesView';
import { PeaksView } from './PeaksView';
import { MolarMassView } from './MolarMassView';
import { extraViews } from './registry';
import { calibrationViews } from './calibrationViews';
import { resultsViews } from './resultsViews';

export type ViewComponent = ComponentType<{ tab: Tab }>;

const VIEWS: Partial<Record<ViewKind, ViewComponent>> = {
  basicCollection: BasicCollectionView,
  despiking: DespikingView,
  baselines: BaselinesView,
  peaks: PeaksView,
  molarMass: MolarMassView,
  ...calibrationViews,
  ...resultsViews,
  ...extraViews,
};

export function ViewHost({ tab }: { tab: Tab }) {
  const V = VIEWS[tab.view];
  if (!V) return <div className="placeholder">{VIEW_TITLES[tab.view]} is not available yet.</div>;
  return (
    <ViewErrorBoundary tab={tab}>
      <V tab={tab} />
    </ViewErrorBoundary>
  );
}

/** Keeps an error in one view from taking down the whole application. */
class ViewErrorBoundary extends Component<{ tab: Tab; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { tab } = this.props;
    const st = useStore.getState();
    return (
      <div className="placeholder view-error">
        <h3>{VIEW_TITLES[tab.view]} could not be displayed</h3>
        <pre>{error.message}</pre>
        <p>
          {tab.draft && (
            <button
              className="big-btn"
              onClick={() => {
                st.setDraft(tab.id, undefined);
                this.setState({ error: undefined });
              }}
            >
              Discard this view's changes and retry
            </button>
          )}{' '}
          <button className="big-btn" onClick={() => this.setState({ error: undefined })}>
            Retry
          </button>{' '}
          <button className="big-btn" onClick={() => st.closeTab(tab.id)}>
            Close view
          </button>
        </p>
      </div>
    );
  }
}
