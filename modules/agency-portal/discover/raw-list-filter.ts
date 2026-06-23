// modules/agency-portal/discover/raw-list-filter.ts · pure client-side filter
// logic for the Raw List table (Phase 9). The table loads a page of rows server-
// side, then lets the user narrow them client-side (free discovery-time chips:
// has website / reachability / min rating) without a round trip. Kept pure so
// the matching logic is unit-testable (the repo tests logic, not rendered DOM).

/** Reachability tiers a chip can require (mirrors the DB enum surface). */
export type ReachabilityTier =
  | "UNREACHABLE"
  | "EMAIL_ONLY"
  | "PHONE_ONLY"
  | "MULTI"
  | "RICH"
  | "UNKNOWN";

/** The minimal row shape the client filter reads. */
export interface ClientFilterRow {
  rating: number | null;
  website: string | null;
  reachability: string | null;
}

export interface ClientFilters {
  /** Only rows with a non-empty website. */
  hasWebsite?: boolean;
  /** rating >= this (inclusive). 0 / undefined → no rating floor. */
  minRating?: number;
  /** Require one of these reachability tiers (empty → no constraint). */
  reachability?: ReachabilityTier[];
}

/** Whether a single row passes the active client-side chips. Pure. */
export function rowPassesClientFilters(
  row: ClientFilterRow,
  filters: ClientFilters,
): boolean {
  if (filters.hasWebsite) {
    if (!row.website || row.website.trim() === "") return false;
  }
  if (typeof filters.minRating === "number" && filters.minRating > 0) {
    if ((row.rating ?? -1) < filters.minRating) return false;
  }
  if (filters.reachability && filters.reachability.length > 0) {
    const tier = (row.reachability ?? "UNKNOWN") as ReachabilityTier;
    if (!filters.reachability.includes(tier)) return false;
  }
  return true;
}

/** Apply the client-side chips to a page of rows. Pure (no mutation). */
export function applyClientFilters<T extends ClientFilterRow>(
  rows: T[],
  filters: ClientFilters,
): T[] {
  return rows.filter((r) => rowPassesClientFilters(r, filters));
}
