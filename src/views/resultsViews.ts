import type { ComponentType } from 'react';
import type { Tab, ViewKind } from '../store';
import { ResultsFittingView } from './ResultsFittingView';
import { DistributionView } from './DistributionView';
import { MassVsTimeView } from './MassVsTimeView';
import { ConformationView } from './ConformationView';
import { MarkHouwinkView } from './MarkHouwinkView';
import { EasiGraphView } from './EasiGraphView';

/** Graph-oriented results views (results fitting, distributions, plots, EASI graph). */
export const resultsViews: Partial<Record<ViewKind, ComponentType<{ tab: Tab }>>> = {
  resultsFitting: ResultsFittingView,
  distribution: DistributionView,
  massVsTime: MassVsTimeView,
  conformation: ConformationView,
  markHouwink: MarkHouwinkView,
  easiGraph: EasiGraphView,
};
