// modules/agency-portal/discover/family-coverage.ts · the SINGLE source of truth
// for "is data-family X covered for business Y" across the agency workbench.
//
// Three surfaces must agree on coverage or the portal lies to Tom:
//   1. the workbench TABLE's per-row coverage dot-strip (WorkbenchLeadRow.families)
//   2. the lead DRAWER's data-domain accordions (LeadDomainBlock.enriched in
//      lead-detail.ts — adsEnriched / serpEnriched / reviewsEnriched / …)
//   3. the batched coverage matrix endpoint (GET /research/:id/coverage)
//
// Previously the table HARDCODED `ads:false` + `search:false` (faked negatives)
// while the drawer computed them for real from `AdLibraryEntry` / `SerpResult`
// rows — so the two disagreed. This module makes all three derive ads/search
// (and every family) from the SAME real DB presence.
//
// Coverage for a family is true when EITHER is true:
//   A. a real enriched row exists (the drawer's `*Enriched` derivations), OR
//   B. a finished EnrichmentJob exists for a family that maps to it.
//
// Why the union — not the EnrichmentJob matrix alone: ads (META_ADS / GOOGLE_ADS)
// and search (SERP) run INLINE per-cell in dispatch.fanOutRun and create NO
// per-business EnrichmentJob rows (only CONTACTS / SERVICES / REVIEWS /
// AI_RESEARCH / LIGHTHOUSE do — see modules/enrichment/dispatch.ts buildJobPlan).
// A matrix built from EnrichmentJob.groupBy alone would therefore RE-FAKE
// ads/search as never-covered. Conversely a CONTACTS job that finds zero contacts
// produces a DONE job row but no Contact/scalar — so the job row correctly marks
// the work as done even when the data is empty. Union captures both.
//
// Pure (no DB, no React) so it is unit-testable and importable by both the server
// pages (Pattern 4 — plain data crosses to the client) and the route handler.

import type { DataFamily } from "./leads-workbench";

/**
 * The real-data presence flags for ONE business — exactly the booleans the
 * drawer (lead-detail.ts) derives from its enriched rows. Pass what you have;
 * everything defaults to false (absent = not covered).
 */
export interface FamilyPresence {
  /** Reviews family: a snapshot/Business reviewCount exists (drawer reviewsEnriched). */
  reviews?: boolean;
  /** Website family: a Lighthouse audit OR a detected CMS/tech exists (drawer speed/tech). */
  website?: boolean;
  /** Contacts family: at least one phone/email/contact channel (drawer contactsEnriched). */
  contacts?: boolean;
  /** Ads family: at least one AdLibraryEntry row (drawer adsEnriched). */
  ads?: boolean;
  /** Search family: a SerpResult row exists (drawer serpEnriched). */
  search?: boolean;
}

/**
 * Which `EnrichmentFamily` enum values count as coverage for each `DataFamily`.
 * `identity` is always present (it IS the discovered business) so it has no job
 * mapping. Ads/search map to their (inline, job-less) families for completeness —
 * if a future dispatch ever emits job rows for them, this stays correct.
 */
const FAMILY_JOB_MAP: Record<DataFamily, readonly string[]> = {
  identity: [],
  reviews: ["REVIEWS"],
  website: ["TECH", "LIGHTHOUSE"],
  contacts: ["CONTACTS"],
  ads: ["META_ADS", "GOOGLE_ADS"],
  search: ["SERP"],
};

/**
 * Job statuses that count as "this family's work is done" for coverage. These
 * are the only members of the `EnrichmentJobStatus` enum that mean the unit
 * needed no further work: `DONE` (ran) + `SKIPPED_FRESH` (already fresh, $0).
 * (The doc mentions a `SKIPPED_CACHED` status, but it does NOT exist in the
 * Prisma `EnrichmentJobStatus` enum — only DONE / SKIPPED_FRESH do — so adding
 * it would break the typed `groupBy` where-clause. Add it here if the enum ever
 * gains it.)
 */
export const COVERED_JOB_STATUSES = ["DONE", "SKIPPED_FRESH"] as const;

/**
 * Derive the full `Record<DataFamily, boolean>` coverage map for ONE business.
 *
 * @param presence    real enriched-row presence (the drawer's `*Enriched` flags)
 * @param doneJobFamilies set of `EnrichmentFamily` values with a finished job for
 *                        this business (from EnrichmentJob.groupBy) — optional
 */
export function deriveFamilyCoverage(
  presence: FamilyPresence,
  doneJobFamilies?: ReadonlySet<string>,
): Record<DataFamily, boolean> {
  const jobCovers = (df: DataFamily): boolean => {
    if (!doneJobFamilies || doneJobFamilies.size === 0) return false;
    return FAMILY_JOB_MAP[df].some((f) => doneJobFamilies.has(f));
  };
  return {
    // identity is the discovered business itself — always covered.
    identity: true,
    reviews: presence.reviews === true || jobCovers("reviews"),
    website: presence.website === true || jobCovers("website"),
    contacts: presence.contacts === true || jobCovers("contacts"),
    ads: presence.ads === true || jobCovers("ads"),
    search: presence.search === true || jobCovers("search"),
  };
}

/**
 * The `EnrichmentJobStatus` values that mean "this family's work was ATTEMPTED
 * and ERRORED" — so an un-covered family with a failed job reads "failed",
 * NOT the same grey "not yet" as a family that was never touched. Closes the
 * "failed ≡ never-run" complaint (docs/discover-workbench-research §status).
 */
export const FAILED_JOB_STATUSES = ["FAILED"] as const;

/**
 * Which families FAILED for one business: a family-mapped job errored AND the
 * family is still NOT covered (a later DONE job or a real enriched row would
 * make it covered, so a retry that succeeded never reads as failed). Only the
 * job-backed families (reviews / website / contacts) can fail — ads/search run
 * inline and produce no job rows. Pure.
 *
 * @param coverage           the derived boolean coverage map for this business
 * @param failedJobFamilies  set of `EnrichmentFamily` values with a FAILED job
 */
export function deriveFailedFamilies(
  coverage: Record<DataFamily, boolean>,
  failedJobFamilies?: ReadonlySet<string>,
): DataFamily[] {
  if (!failedJobFamilies || failedJobFamilies.size === 0) return [];
  const out: DataFamily[] = [];
  for (const df of Object.keys(FAMILY_JOB_MAP) as DataFamily[]) {
    if (coverage[df]) continue; // covered (retry landed / real row) → not failed
    if (FAMILY_JOB_MAP[df].some((f) => failedJobFamilies.has(f))) out.push(df);
  }
  return out;
}

/**
 * Map a `DataFamily` to the `EnrichmentType` selection(s) the discover/enrich
 * flow understands, so "enrich missing families" can pre-select the right lines.
 * `identity` has nothing to enrich (it is the business). Returns lowercase
 * enrichment-type tokens matching modules/enrichment's EnrichmentType.
 */
const FAMILY_ENRICH_TYPES: Record<DataFamily, readonly string[]> = {
  identity: [],
  reviews: ["reviews"],
  website: ["tech", "lighthouse"],
  contacts: ["contacts"],
  ads: ["meta_ads", "google_ads"],
  search: ["serp"],
};

/**
 * Translate a set of missing `DataFamily` keys into the de-duped list of
 * enrichment-type tokens to pre-select in the enrich flow (for the deep link).
 */
export function enrichTypesForFamilies(
  families: readonly DataFamily[],
): string[] {
  const out = new Set<string>();
  for (const f of families) for (const t of FAMILY_ENRICH_TYPES[f]) out.add(t);
  return [...out];
}
