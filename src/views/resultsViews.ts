import type { ComponentType } from 'react';
import type { Tab, ViewKind } from '../store';

/** Graph-oriented results views (results fitting, distributions, plots, EASI graph). */
export const resultsViews: Partial<Record<ViewKind, ComponentType<{ tab: Tab }>>> = {};
