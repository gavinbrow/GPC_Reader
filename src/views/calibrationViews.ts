import type { ComponentType } from 'react';
import type { Tab, ViewKind } from '../store';
import { ConfigurationView } from './ConfigurationView';
import { AlignmentView } from './AlignmentView';
import { BandBroadeningView } from './BandBroadeningView';
import { NormalizationView } from './NormalizationView';
import { ViscometryView } from './ViscometryView';

/** Configuration / calibration views (alignment, band broadening, normalization, viscometry). */
export const calibrationViews: Partial<Record<ViewKind, ComponentType<{ tab: Tab }>>> = {
  configuration: ConfigurationView,
  alignment: AlignmentView,
  bandBroadening: BandBroadeningView,
  normalization: NormalizationView,
  viscometry: ViscometryView,
};
