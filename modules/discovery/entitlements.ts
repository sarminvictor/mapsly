// modules/discovery/entitlements.ts · per-agency research entitlement reads
// (entitlement model · Phase 1 · ships DARK, wired in Phase 2).
//
// The revenue-axis analog of enrich-fresh(-db).ts: where freshness asks "is OUR
// DB copy fresh?" (the vendor-run gate), entitlement asks "does THIS agency
// already OWN this (unit × family)?" (the charge gate). Under D1 (PERMANENT-view)
// an entitlement is simply a ledger row that exists — no grantedAt window.
//
// `countEntitled` mirrors `countFresh` exactly (same shape, same per-business /
// per-cell split) so Phase 2 can swap the estimate's `fresh` input for
// `entitled`: `billable = total − entitled` (DB freshness stops being a billing
// input · G6).

import prisma from "@/lib/prisma";
import { ENRICHMENT_PRICES, type EnrichmentType } from "@/modules/cost/pricing";

import {
  isFresh,
  type FreshByEnrichment,
  type FreshTimestamps,
} from "./enrich-fresh";
import { loadFreshTimestamps } from "./enrich-fresh-db";

/** EnrichmentFamily enum value (uppercase) → billable EnrichmentType (lowercase). */
const FAMILY_TO_TYPE: Record<string, EnrichmentType> = {
  CONTACTS: "contacts",
  SERVICES: "services",
  TECH: "tech",
  REVIEWS: "reviews",
  META_ADS: "meta_ads",
  GOOGLE_ADS: "google_ads",
  SERP: "serp",
  LIGHTHOUSE: "lighthouse",
  AI_RESEARCH: "ai_research",
  // PLAYBOOK is a display fold, never a billable/entitled type — omitted.
};

/**
 * Which families an agency already owns, per unit. A unit absent from a map (or
 * present with a family not in its set) is NOT entitled → billable.
 */
export interface EntitlementSet {
  /** businessId → set of owned per-business families. */
  perBusiness: Map<string, Set<EnrichmentType>>;
  /** cellKey → set of owned per-cell families. */
  perCell: Map<string, Set<EnrichmentType>>;
}

/**
 * Load an agency's entitlements for the units in scope. One indexed read over
 * the two batched-read keys ((agencyId, businessId, family) /
 * (agencyId, cellKey, family)). Select-only, safe in the pre-flight path.
 */
export async function loadEntitlements(
  agencyId: string,
  businessIds: readonly string[],
  cellKeys: readonly string[],
): Promise<EntitlementSet> {
  const perBusiness: EntitlementSet["perBusiness"] = new Map();
  const perCell: EntitlementSet["perCell"] = new Map();

  const or: {
    businessId?: { in: string[] };
    cellKey?: { in: string[] };
  }[] = [];
  if (businessIds.length > 0) or.push({ businessId: { in: [...businessIds] } });
  if (cellKeys.length > 0) or.push({ cellKey: { in: [...cellKeys] } });
  if (or.length === 0) return { perBusiness, perCell };

  const rows = await prisma.agencyEntitlement.findMany({
    where: { agencyId, OR: or },
    select: { businessId: true, cellKey: true, family: true },
  });

  for (const r of rows) {
    const type = FAMILY_TO_TYPE[r.family];
    if (!type) continue;
    if (r.businessId) {
      const set = perBusiness.get(r.businessId) ?? new Set<EnrichmentType>();
      set.add(type);
      perBusiness.set(r.businessId, set);
    } else if (r.cellKey) {
      const set = perCell.get(r.cellKey) ?? new Set<EnrichmentType>();
      set.add(type);
      perCell.set(r.cellKey, set);
    }
  }

  return { perBusiness, perCell };
}

/**
 * Count OWNED units per selected enrichment — the entitlement analog of
 * `countFresh`. Pure over the supplied set. A per-business family counts a
 * business owned when its set holds that family; a per-cell family counts a
 * cell owned likewise. The result is the count to subtract from `total` to get
 * the billable count.
 */
export function countEntitled(input: {
  enrichments: readonly EnrichmentType[];
  businessIds: readonly string[];
  cellKeys: readonly string[];
  entitlements: EntitlementSet;
}): FreshByEnrichment {
  const { enrichments, businessIds, cellKeys, entitlements } = input;
  const out: FreshByEnrichment = {};

  for (const enrichment of enrichments) {
    const price = ENRICHMENT_PRICES[enrichment];
    if (!price) continue;
    let owned = 0;

    if (price.unit === "business") {
      for (const id of businessIds) {
        if (entitlements.perBusiness.get(id)?.has(enrichment)) owned += 1;
      }
    } else {
      for (const key of cellKeys) {
        if (entitlements.perCell.get(key)?.has(enrichment)) owned += 1;
      }
    }

    out[enrichment] = owned;
  }

  return out;
}

/**
 * Count FREE units per selected enrichment — the estimate's billing reducer
 * under the entitlement model. The ONLY free quadrant is owned ∧ fresh
 * (SKIPPED_ENTITLED); an owner refreshing STALE data pays (D1), so it is NOT
 * netted out here. Pure over the two supplied inputs. `billable = total − free`.
 */
export function countFreeUnits(input: {
  enrichments: readonly EnrichmentType[];
  businessIds: readonly string[];
  cellKeys: readonly string[];
  entitlements: EntitlementSet;
  timestamps: FreshTimestamps;
  now: Date;
}): FreshByEnrichment {
  const { enrichments, businessIds, cellKeys, entitlements, timestamps, now } =
    input;
  const out: FreshByEnrichment = {};

  for (const enrichment of enrichments) {
    const price = ENRICHMENT_PRICES[enrichment];
    if (!price) continue;
    const window = price.freshnessDays;
    let free = 0;

    if (price.unit === "business") {
      for (const id of businessIds) {
        const owned =
          entitlements.perBusiness.get(id)?.has(enrichment) ?? false;
        const fresh = isFresh(
          timestamps.perBusiness.get(id)?.[enrichment] ?? null,
          window,
          now,
        );
        if (owned && fresh) free += 1;
      }
    } else {
      for (const key of cellKeys) {
        const owned = entitlements.perCell.get(key)?.has(enrichment) ?? false;
        const fresh = isFresh(
          timestamps.perCell.get(key)?.[enrichment] ?? null,
          window,
          now,
        );
        if (owned && fresh) free += 1;
      }
    }

    out[enrichment] = free;
  }

  return out;
}

/**
 * End-to-end FREE-count for a run: load BOTH the agency's entitlements and the
 * DB freshness timestamps, then count owned∧fresh via the pure helper. This is
 * the estimate reducer when ENTITLEMENT_BILLING is on. Degrades to "nothing
 * free" (billed in full — never under-charged) on a read hiccup.
 */
export async function countFreeForRun(input: {
  agencyId: string;
  enrichments: readonly EnrichmentType[];
  businessIds: readonly string[];
  cellKeys: readonly string[];
  now?: Date;
}): Promise<FreshByEnrichment> {
  const now = input.now ?? new Date();
  try {
    const [entitlements, timestamps] = await Promise.all([
      loadEntitlements(input.agencyId, input.businessIds, input.cellKeys),
      loadFreshTimestamps(input.businessIds, input.cellKeys),
    ]);
    return countFreeUnits({
      enrichments: input.enrichments,
      businessIds: input.businessIds,
      cellKeys: input.cellKeys,
      entitlements,
      timestamps,
      now,
    });
  } catch (err) {
    console.warn(
      `[entitlements] free-count read failed; treating all units as billable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {} as FreshByEnrichment;
  }
}

/**
 * End-to-end owned-count for a run: load the agency's entitlements, then count
 * via the pure helper. Degrades to "nothing owned" on a read hiccup (the run is
 * billed in full — never under-charged), matching `countFreshForRun`.
 */
export async function countEntitledForRun(input: {
  agencyId: string;
  enrichments: readonly EnrichmentType[];
  businessIds: readonly string[];
  cellKeys: readonly string[];
}): Promise<FreshByEnrichment> {
  try {
    const entitlements = await loadEntitlements(
      input.agencyId,
      input.businessIds,
      input.cellKeys,
    );
    return countEntitled({
      enrichments: input.enrichments,
      businessIds: input.businessIds,
      cellKeys: input.cellKeys,
      entitlements,
    });
  } catch (err) {
    console.warn(
      `[entitlements] read failed; treating all units as billable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {} as FreshByEnrichment;
  }
}
