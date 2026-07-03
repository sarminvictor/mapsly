// modules/agency-portal/discover/saved-templates.ts · pure helpers for the
// per-agency saved goal templates (save-as-template · WP5-12).
//
// An `AgencyTemplate` row stores the goal's active signal set in `signalsJson`
// (the SAME `DiscoverySignals` shape `Discovery.signalsJson` uses — see
// discovery-signals.ts), plus a name and the GOAL_TEMPLATES key it was cloned
// from. These helpers shape a DB row into the plain `SavedTemplateRow` the
// GoalStep gallery renders (Pattern 4 — plain data crosses the boundary), and
// hydrate a picked row back into a working `GoalState` exactly like a built-in
// template. Pure (no React, no DB) so the round-trip is unit-testable.

import {
  parseDiscoverySignals,
  type PersistedSignal,
} from "./discovery-signals";
import { SIG_META } from "./goal-templates";
import type { GoalFilter, GoalState } from "./flow-types";

/** A saved template as the GoalStep gallery consumes it (plain serializable). */
export interface SavedTemplateRow {
  id: string;
  name: string;
  /** GOAL_TEMPLATES key this was cloned from (null = from scratch/custom). */
  basedOnTemplate: string | null;
  /** The persisted active signal set (DiscoverySignals.signals). */
  signals: PersistedSignal[];
}

/**
 * Shape one `AgencyTemplate` DB row into a {@link SavedTemplateRow}. Returns
 * null when `signalsJson` doesn't parse to at least one known signal — a
 * corrupt/legacy row silently disappears from the gallery instead of rendering
 * a template that would hydrate an empty goal.
 */
export function savedTemplateRowFromDb(row: {
  id: string;
  name: string;
  basedOnTemplate: string | null;
  signalsJson: unknown;
}): SavedTemplateRow | null {
  const parsed = parseDiscoverySignals(row.signalsJson);
  if (!parsed) return null;
  const signals = parsed.signals.filter((s) => SIG_META[s.key] != null);
  if (signals.length === 0) return null;
  return {
    id: row.id,
    name: row.name,
    basedOnTemplate: row.basedOnTemplate,
    signals,
  };
}

/**
 * Hydrate a saved template into a working {@link GoalState} — the exact same
 * contract as picking a built-in template (loadGoalFrom), except every stored
 * signal comes back ON with its saved tune/conds/match, and the goal opens as
 * `customized` (it IS the user's own tuned bundle).
 */
export function goalFromSavedTemplate(row: SavedTemplateRow): GoalState {
  const filters: GoalFilter[] = row.signals.map((s) => {
    const meta = SIG_META[s.key];
    return {
      key: s.key,
      on: true,
      why: meta?.pitch || meta?.means || "",
      ...(s.tune ? { tune: s.tune } : {}),
      ...(s.conds ? { conds: s.conds } : {}),
      ...(s.match ? { match: s.match } : {}),
    };
  });
  return {
    base: row.basedOnTemplate ?? "custom",
    name: row.name,
    customized: true,
    filters,
    // Carry the row id so re-saving this loaded template UPDATES it in place
    // (template-actions.ts update path) instead of spawning a duplicate.
    templateId: row.id,
  };
}
