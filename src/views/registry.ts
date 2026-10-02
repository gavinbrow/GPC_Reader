import type { ComponentType } from 'react';
import type { Tab, ViewKind } from '../store';
import { AboutView } from './AboutView';
import { ReportView } from './ReportView';
import { EasiTableView, FileContentsView, LogView, PeakResultsView, PeakStatsView, SliceTableView, StoredResultsView } from './ResultsTables';

/** Report / table views. */
export const extraViews: Partial<Record<ViewKind, ComponentType<{ tab: Tab }>>> = {
  report: ReportView,
  peakResults: PeakResultsView,
  peakStats: PeakStatsView,
  sliceTable: SliceTableView,
  storedResults: StoredResultsView,
  log: LogView,
  fileContents: FileContentsView,
  easiTable: EasiTableView,
  about: AboutView,
};
