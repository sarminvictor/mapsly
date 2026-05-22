/**
 * Agency list-analytics components · barrel export (F.5).
 *
 * Server-component-safe primitives composed by `/(agency)/list-
 * analytics/page.tsx`. None of these need `'use client'` at F.5 — they
 * are purely presentational. If a future iteration adds an interactive
 * affordance (sort header, drill-down, density toggle), that affordance
 * should be split into a thin client wrapper rather than upgrading the
 * whole tree.
 */

export { StatHeader } from "./StatHeader";
export type { StatHeaderProps, StatHeaderLabels } from "./StatHeader";

export { InsightCallout } from "./InsightCallout";
export type {
  InsightCalloutProps,
  InsightCalloutLabels,
} from "./InsightCallout";

export { ListFunnelRow } from "./ListFunnelRow";
export type { ListFunnelRowProps, ListFunnelRowLabels } from "./ListFunnelRow";

export { ListFunnelTable } from "./ListFunnelTable";
export type {
  ListFunnelTableProps,
  ListFunnelTableLabels,
} from "./ListFunnelTable";

export { SignalCorrelationPanel } from "./SignalCorrelationPanel";
export type {
  SignalCorrelationPanelProps,
  SignalCorrelationPanelLabels,
} from "./SignalCorrelationPanel";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps, EmptyStateLabels } from "./EmptyState";
