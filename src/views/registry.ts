import type { ComponentType } from 'react';
import type { Tab, ViewKind } from '../store';

/** Additional views registered by other modules. */
export const extraViews: Partial<Record<ViewKind, ComponentType<{ tab: Tab }>>> = {};
