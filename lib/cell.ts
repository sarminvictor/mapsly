// lib/cell.ts · Cell identity + discovery-freshness helpers (Phase 1/2).
//
// A Cell = 1 metro × 1 category. The canonical key matches the existing
// CellMetric/BusinessSnapshot.cellKey shape. Freshness is the 6-month rule:
// a cell discovered within CELL_DISCOVERY_FRESHNESS_DAYS serves from the DB at
// $0; older than that, re-fetch from DataForSEO.
//
// All time math takes an explicit `now` so it's pure/testable AND safe under
// Next 16 PPR (no argless `new Date()` — INC-09). Route handlers pass a
// runtime `new Date()`.

export const CELL_DISCOVERY_FRESHNESS_DAYS = 182; // ~6 months
const MS_PER_DAY = 86_400_000;

/** Canonical cell key: "categorySlug|metroSlug|country". */
export function cellKey(
  categorySlug: string,
  metroSlug: string,
  country = "US",
): string {
  return `${categorySlug}|${metroSlug}|${country}`;
}

export interface ParsedCellKey {
  categorySlug: string;
  metroSlug: string;
  country: string;
}

export function parseCellKey(key: string): ParsedCellKey | null {
  const parts = key.split("|");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  return { categorySlug: parts[0], metroSlug: parts[1], country: parts[2] };
}

/** Whole days between two dates (b − a), floored. */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** When a cell discovered now goes stale. */
export function nextStaleAt(
  lastDiscoveredAt: Date,
  days = CELL_DISCOVERY_FRESHNESS_DAYS,
): Date {
  return new Date(lastDiscoveredAt.getTime() + days * MS_PER_DAY);
}

/** True if the cell was discovered within the freshness window (serve $0). */
export function isCellFresh(
  lastDiscoveredAt: Date | null,
  now: Date,
  days = CELL_DISCOVERY_FRESHNESS_DAYS,
): boolean {
  if (!lastDiscoveredAt) return false;
  return daysBetween(lastDiscoveredAt, now) < days;
}

export type FreshnessState = "never" | "fresh" | "aging" | "stale";

/**
 * UI freshness chip state. `fresh` < 70% of the window, `aging` in the last
 * 30% before it goes stale, `stale` past the window, `never` if undiscovered.
 */
export function cellFreshnessState(
  lastDiscoveredAt: Date | null,
  now: Date,
  days = CELL_DISCOVERY_FRESHNESS_DAYS,
): FreshnessState {
  if (!lastDiscoveredAt) return "never";
  const age = daysBetween(lastDiscoveredAt, now);
  if (age >= days) return "stale";
  if (age >= days * 0.7) return "aging";
  return "fresh";
}
