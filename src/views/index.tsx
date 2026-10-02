import type { ComponentType } from 'react';
import type { Tab, ViewKind } from '../store';
import { VIEW_TITLES } from '../store';
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
  return <V tab={tab} />;
}
