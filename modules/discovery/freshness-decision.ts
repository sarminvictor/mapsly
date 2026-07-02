// modules/discovery/freshness-decision.ts · the 6-month serve-from-DB gate
// (Phase 2). Given the cells a user wants to discover and when each was last
// discovered, decide which serve from the DB ($0) and which must re-fetch from
// DataForSEO, and attach the pre-flight cost (Phase 0 estimator).

import { isCellFresh } from "@/lib/cell";
import {
  estimateDiscovery,
  type DiscoveryEstimate,
} from "@/modules/cost/estimate";

export interface DiscoveryCellPlanInput {
  cellKey: string;
  /** When this cell was last fully discovered (null = never). */
  lastDiscoveredAt: Date | null;
  /** DfS total_count (or our last-known member count) — drives per-cell cost. */
  expectedListings: number;
}

export type DiscoveryCellOutcome = "SERVED_FROM_DB" | "REFETCH";

export interface DiscoveryCellPlan {
  cellKey: string;
  outcome: DiscoveryCellOutcome;
  fresh: boolean;
}

export interface DiscoveryPlan {
  cells: DiscoveryCellPlan[];
  freshCount: number;
  refetchCount: number;
  /** Pre-flight cost — fresh cells contribute $0. */
  estimate: DiscoveryEstimate;
}

/**
 * Decide the per-cell discovery outcome + total pre-flight cost.
 *
 * `now` is passed explicitly (pure + PPR-safe). A cell discovered within the
 * 6-month window serves from the DB at $0; older or never-discovered cells are
 * re-fetched and billed by expected listing count.
 */
export function decideDiscoveryPlan(
  cells: DiscoveryCellPlanInput[],
  now: Date,
): DiscoveryPlan {
  const plans: DiscoveryCellPlan[] = cells.map((c) => {
    const fresh = isCellFresh(c.lastDiscoveredAt, now);
    return {
      cellKey: c.cellKey,
      fresh,
      outcome: fresh ? "SERVED_FROM_DB" : "REFETCH",
    };
  });

  const estimate = estimateDiscovery(
    cells.map((c, i) => ({
      fresh: plans[i].fresh,
      expectedListings: c.expectedListings,
    })),
  );

  return {
    cells: plans,
    freshCount: plans.filter((p) => p.fresh).length,
    refetchCount: plans.filter((p) => !p.fresh).length,
    estimate,
  };
}

/**
 * Freshness of a cell's anchor, corrected for what's actually in the DB.
 *
 * A `lastDiscoveredAt` within the freshness window normally means "serve from
 * the DB, $0". But a fresh anchor with ZERO businesses behind it is
 * stale/orphaned — the cell's businesses were deleted while its TrackedLocation
 * survived (or a run recorded freshness without persisting rows). Serving that
 * would return an empty market forever. So we ignore the anchor's freshness
 * when the cell is empty, forcing a real refetch.
 *
 * Both the preflight estimate and the discovery run feed their anchor through
 * this so "fresh" always means "fresh AND non-empty" — one source of truth.
 */
export function effectiveLastDiscoveredAt(
  lastDiscoveredAt: Date | null,
  businessCount: number,
): Date | null {
  return businessCount > 0 ? lastDiscoveredAt : null;
}
