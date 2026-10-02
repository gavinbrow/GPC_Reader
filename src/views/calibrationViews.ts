import type { ComponentType } from 'react';
import type { Tab, ViewKind } from '../store';

/** Configuration / calibration views (alignment, band broadening, normalization, viscometry). */
export const calibrationViews: Partial<Record<ViewKind, ComponentType<{ tab: Tab }>>> = {};
