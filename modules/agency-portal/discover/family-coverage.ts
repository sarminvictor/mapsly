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

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment RUN-STATE model (the 2026-07 honesty fix · audit §3 · A-cluster).
//
// The legacy `deriveFamilyCoverage` collapses everything to a single boolean
// derived from DATA PRESENCE, which lies twice: (1) a discovery-only business
// with a GBP `reviewCount` reads "reviews covered" though no reviews were pulled
// (false-positive), and (2) an ads/SERP cell run that COMPLETED but found nothing
// reads "not covered" (false-negative). Both come from asking "is there a row?"
// instead of "did an enrichment RUN?".
//
// `deriveFamilyStates` fixes this by sourcing state from the RUN RECORDS
// (EnrichmentJob for the job-backed families, AdMarketRun for the cell-scoped
// ads/search) and using data presence ONLY to split a completed run into
// "enriched" (produced data) vs "empty" (ran, verified nothing). Every workbench
// surface — dot-strip, coverage panel, per-cell affordances, the drawer — reads
// this ONE derivation so they can never disagree again.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The state of ONE data family for ONE business:
 *   - `enriched` · an enrichment ran and produced data → show it
 *   - `empty`    · an enrichment ran but found nothing (verified) → calm "none",
 *                  never re-charge a retry (audit A5)
 *   - `failed`   · the enrichment errored (retries exhausted) → red, retry
 *   - `not_run`  · never attempted → the actionable "enrich" affordance
 */
export type FamilyState = "enriched" | "empty" | "failed" | "not_run";

/**
 * The five real ENRICHMENT families, in render order. `identity` is excluded —
 * it is the discovered business itself, not an enrichment, so it must never
 * count toward "N enriched" or add a permanent dot (audit A1/A2: the old
 * always-on identity dot is what produced the "min 2 dots on everything" lie).
 */
export const ENRICHMENT_FAMILIES: readonly DataFamily[] = [
  "reviews",
  "website",
  "contacts",
  "ads",
  "search",
] as const;

/**
 * The per-business run signals `deriveFamilyStates` reads. `presence` answers
 * "did the run produce data?" (real rows — for reviews this MUST be actual
 * Review rows, never `reviewCount`). The job sets are `EnrichmentFamily` values
 * with a finished / failed job. The cell flags are the completed / failed
 * `AdMarketRun` for THIS business's cell (ads = META_ADS|GOOGLE_ADS, search =
 * SERP run inline per-cell → no per-business job rows exist for them).
 */
export interface FamilyRunInputs {
  presence: FamilyPresence;
  doneJobFamilies?: ReadonlySet<string>;
  failedJobFamilies?: ReadonlySet<string>;
  cellRan?: { ads?: boolean; search?: boolean };
  cellFailed?: { ads?: boolean; search?: boolean };
}

/** Resolve one job-backed family (reviews / website / contacts) to a state. */
function jobBackedState(
  df: DataFamily,
  hasData: boolean,
  done?: ReadonlySet<string>,
  failed?: ReadonlySet<string>,
): FamilyState {
  const fams = FAMILY_JOB_MAP[df];
  if (done && fams.some((f) => done.has(f)))
    return hasData ? "enriched" : "empty";
  if (failed && fams.some((f) => failed.has(f))) return "failed";
  return "not_run";
}

/** Resolve one cell-scoped family (ads / search) to a state. */
function cellBackedState(
  hasData: boolean,
  ran?: boolean,
  failed?: boolean,
): FamilyState {
  if (ran) return hasData ? "enriched" : "empty";
  if (failed) return "failed";
  return "not_run";
}

/**
 * Derive the honest per-family RUN state for ONE business. `identity` is always
 * `enriched` (it IS the discovered business) but callers should iterate
 * {@link ENRICHMENT_FAMILIES} for anything that counts/scores enrichment.
 */
export function deriveFamilyStates(
  inp: FamilyRunInputs,
): Record<DataFamily, FamilyState> {
  const p = inp.presence;
  return {
    identity: "enriched",
    reviews: jobBackedState(
      "reviews",
      p.reviews === true,
      inp.doneJobFamilies,
      inp.failedJobFamilies,
    ),
    website: jobBackedState(
      "website",
      p.website === true,
      inp.doneJobFamilies,
      inp.failedJobFamilies,
    ),
    contacts: jobBackedState(
      "contacts",
      p.contacts === true,
      inp.doneJobFamilies,
      inp.failedJobFamilies,
    ),
    ads: cellBackedState(p.ads === true, inp.cellRan?.ads, inp.cellFailed?.ads),
    search: cellBackedState(
      p.search === true,
      inp.cellRan?.search,
      inp.cellFailed?.search,
    ),
  };
}

/** True once ANY enrichment family has run (enriched / empty / failed) — the
 *  predicate behind the "Enriched only" workbench view (audit B1). */
export function anyEnrichmentRan(
  states: Record<DataFamily, FamilyState>,
): boolean {
  return ENRICHMENT_FAMILIES.some((f) => states[f] !== "not_run");
}

/** A ran-with-data family counts toward the "N enriched" summary; empty/failed/
 *  not_run do not. */
export function enrichedFamilyCount(
  states: Record<DataFamily, FamilyState>,
): number {
  return ENRICHMENT_FAMILIES.filter((f) => states[f] === "enriched").length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment TYPE run-state model (audit A2 · the 9 things Tom pays for).
//
// The 5-family model above (`DataFamily`) is a DISPLAY grouping — it collapses
// "tech + lighthouse" into one "website" dot and "meta_ads + google_ads" into
// one "ads" dot. That's right for the A3 coverage PANEL (which speaks in the
// data domains a lead has), but it LIES about billing: Tom pays per
// `EnrichmentFamily`, and the workbench's "Enriched" column should show the
// state of each thing he can buy. `EnrichmentJob` is keyed by the 9-value
// `EnrichmentFamily` enum (PLAYBOOK excluded — it's an internal roll-up, never
// a purchasable line), so per-TYPE run-state IS derivable from the same run
// records the family model reads.
//
// This block adds `deriveTypeStates` — the per-type analogue of
// `deriveFamilyStates`. The family model is kept intact (A3 reads it); the
// per-type model is threaded ALONGSIDE it to the workbench's enriched column.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 9 purchasable enrichment TYPES, keyed by their `EnrichmentFamily` enum
 * value (PLAYBOOK excluded — internal roll-up, never billed). This is the exact
 * axis of the "Enriched" column badge strip.
 */
export type EnrichmentTypeKey =
  | "CONTACTS"
  | "SERVICES"
  | "TECH"
  | "REVIEWS"
  | "META_ADS"
  | "GOOGLE_ADS"
  | "SERP"
  | "LIGHTHOUSE"
  | "AI_RESEARCH";

/**
 * The per-type run state. Superset of {@link FamilyState} with `running` —
 * a QUEUED/RUNNING job is in flight, so the badge pulses. (The family model
 * never surfaced `running` server-side; the workbench inferred it client-side
 * from the enrich-scope bus. The per-type strip reads the honest QUEUED/RUNNING
 * job status instead, so a badge pulses even after a page refresh.)
 */
export type TypeState = FamilyState | "running";

/**
 * The 9 types in render order, each with a full label + a 2-letter chip glyph
 * for the compact column strip. Order groups the domains a human scans together
 * (identity/contacts → reviews → site → ads → search → AI).
 */
export const ENRICHMENT_TYPES: readonly {
  key: EnrichmentTypeKey;
  label: string;
  chip: string;
}[] = [
  { key: "CONTACTS", label: "Contacts", chip: "Co" },
  { key: "SERVICES", label: "Services", chip: "Sv" },
  { key: "REVIEWS", label: "Reviews", chip: "Rv" },
  { key: "TECH", label: "Tech", chip: "Te" },
  { key: "LIGHTHOUSE", label: "Lighthouse", chip: "Lh" },
  { key: "META_ADS", label: "Meta ads", chip: "Ma" },
  { key: "GOOGLE_ADS", label: "Google ads", chip: "Ga" },
  { key: "SERP", label: "Search", chip: "Se" },
  { key: "AI_RESEARCH", label: "AI research", chip: "Ai" },
] as const;

/** All 9 type keys, in render order. */
export const ENRICHMENT_TYPE_KEYS: readonly EnrichmentTypeKey[] =
  ENRICHMENT_TYPES.map((t) => t.key);

/**
 * Real-data presence per TYPE — "did this type's enrichment produce a row?".
 * Every flag has a clean backing table EXCEPT nothing here is presence-only:
 * presence only ever SPLITS a completed run into enriched-vs-empty, so a flag
 * with no run behind it never fakes "enriched" (same honesty guarantee as the
 * family model). Absent = false.
 *
 * Backing rows (see coverage-matrix.ts):
 *   - contacts   → Contact rows
 *   - services   → BusinessService rows
 *   - tech       → BusinessTech rows
 *   - reviews    → real Review rows (NEVER Business.reviewCount — the audit bug)
 *   - metaAds    → AdLibraryEntry(META) / a completed META AdMarketRun
 *   - googleAds  → AdLibraryEntry(GOOGLE) / a completed GOOGLE AdMarketRun
 *   - serp       → SerpResult rows / a completed SERP AdMarketRun
 *   - lighthouse → LighthouseAudit rows
 *   - aiResearch → BusinessEnrichment row
 */
export interface TypePresence {
  contacts?: boolean;
  services?: boolean;
  tech?: boolean;
  reviews?: boolean;
  metaAds?: boolean;
  googleAds?: boolean;
  serp?: boolean;
  lighthouse?: boolean;
  aiResearch?: boolean;
}

/**
 * The per-business run signals `deriveTypeStates` reads. Each set holds the
 * `EnrichmentFamily` values with a job in that terminal/in-flight state for this
 * business. Ads/SERP additionally read the cell-scoped `AdMarketRun` (they run
 * inline per-cell and produce no per-business job rows — the same asymmetry the
 * family model handles).
 */
export interface TypeRunInputs {
  presence: TypePresence;
  /** `EnrichmentFamily` values with a DONE / SKIPPED_FRESH job. */
  doneJobFamilies?: ReadonlySet<string>;
  /** `EnrichmentFamily` values with a FAILED job (retries exhausted). */
  failedJobFamilies?: ReadonlySet<string>;
  /** `EnrichmentFamily` values with a QUEUED / RUNNING job (in flight). */
  runningJobFamilies?: ReadonlySet<string>;
  /** Completed (OK/PARTIAL) cell run for this business's cell. */
  cellRan?: { metaAds?: boolean; googleAds?: boolean; serp?: boolean };
  /** Failed (and never-completed) cell run for this business's cell. */
  cellFailed?: { metaAds?: boolean; googleAds?: boolean; serp?: boolean };
}

/**
 * Resolve one type's state, precedence: running (in flight) → done (enriched /
 * empty by data presence) → failed → not_run. `ran`/`failed` fold BOTH the
 * per-business job signal and the cell-scoped run signal so a job-less inline
 * family (ads/SERP) resolves the same way a job-backed one does. Pure.
 */
function typeState(inp: {
  hasData: boolean;
  running: boolean;
  ran: boolean;
  failed: boolean;
}): TypeState {
  if (inp.running) return "running";
  if (inp.ran) return inp.hasData ? "enriched" : "empty";
  if (inp.failed) return "failed";
  return "not_run";
}

/**
 * Derive the honest per-TYPE run state for ONE business over the 9 purchasable
 * enrichment types. The per-type analogue of {@link deriveFamilyStates}: the
 * same run records, the same enriched/empty split, plus a `running` state from
 * QUEUED/RUNNING jobs. Pure — server-computed, crosses to the client as plain
 * data (Pattern 4).
 */
export function deriveTypeStates(
  inp: TypeRunInputs,
): Record<EnrichmentTypeKey, TypeState> {
  const p = inp.presence;
  const done = inp.doneJobFamilies;
  const failed = inp.failedJobFamilies;
  const running = inp.runningJobFamilies;
  const has = (set: ReadonlySet<string> | undefined, fam: string): boolean =>
    !!set && set.has(fam);

  /** A job-backed type (contacts/services/tech/reviews/lighthouse/ai_research). */
  const jobType = (fam: EnrichmentTypeKey, hasData: boolean): TypeState =>
    typeState({
      hasData,
      running: has(running, fam),
      ran: has(done, fam),
      failed: has(failed, fam),
    });

  return {
    CONTACTS: jobType("CONTACTS", p.contacts === true),
    SERVICES: jobType("SERVICES", p.services === true),
    TECH: jobType("TECH", p.tech === true),
    REVIEWS: jobType("REVIEWS", p.reviews === true),
    LIGHTHOUSE: jobType("LIGHTHOUSE", p.lighthouse === true),
    AI_RESEARCH: jobType("AI_RESEARCH", p.aiResearch === true),
    // Ads/SERP: cell-scoped run signal ∪ any per-business job signal (a future
    // dispatch that emits job rows for them stays correct either way).
    META_ADS: typeState({
      hasData: p.metaAds === true,
      running: has(running, "META_ADS"),
      ran: has(done, "META_ADS") || inp.cellRan?.metaAds === true,
      failed: has(failed, "META_ADS") || inp.cellFailed?.metaAds === true,
    }),
    GOOGLE_ADS: typeState({
      hasData: p.googleAds === true,
      running: has(running, "GOOGLE_ADS"),
      ran: has(done, "GOOGLE_ADS") || inp.cellRan?.googleAds === true,
      failed: has(failed, "GOOGLE_ADS") || inp.cellFailed?.googleAds === true,
    }),
    SERP: typeState({
      hasData: p.serp === true,
      running: has(running, "SERP"),
      ran: has(done, "SERP") || inp.cellRan?.serp === true,
      failed: has(failed, "SERP") || inp.cellFailed?.serp === true,
    }),
  };
}

/** True once ANY of the 9 types has run (running / enriched / empty / failed) —
 *  the per-type predicate behind the "Enriched only" workbench view. */
export function anyTypeRan(
  states: Record<EnrichmentTypeKey, TypeState>,
): boolean {
  return ENRICHMENT_TYPE_KEYS.some((k) => states[k] !== "not_run");
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA GROUPS · the ONE user-facing vocabulary (the presentation-layer reframe).
//
// The 9 purchasable TYPES above are the billing axis — right for the SETTLE
// path, wrong for the human. Tom (and the founder) think in terms of the DATA
// they get, not the research jobs that fetch it: "Contacts & site tech" is ONE
// thing to him even though it's two jobs (contacts + tech ride one DOM fetch);
// "Ad activity" is ONE thing even though Meta runs per-market and Google runs
// per-lead. This block collapses the 9 types into 7 DATA GROUPS and is the
// SINGLE denominator every coverage surface reads (the row chip strip, the
// toolbar badge, the coverage panel) so they can never disagree (was /5, /6
// AND /9 across the three surfaces).
//
// Pure (no DB, no React) — server-computed, crosses to the client as plain data
// (Pattern 4), unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

/** The 7 user-facing data-group keys, in render order. */
export type DataGroupKey =
  | "contacts_tech"
  | "reviews"
  | "site_speed"
  | "services"
  | "ai_brief"
  | "ads"
  | "search";

/**
 * A data group: the label + plain description Tom reads, the billing TYPES it
 * rolls up, a 2-letter chip glyph for the compact row strip, and whether it is
 * priced/scoped per LEAD (business basis) or per MARKET (cell basis · runs once
 * for the whole cell). `marketNote` is the short tag shown on a market group
 * ("market · per cell") — Meta is per-cell, Google per-lead, so the mixed Ad
 * group carries a nuanced note.
 */
export interface DataGroup {
  key: DataGroupKey;
  /** The one plain label — the SAME string on every surface. */
  label: string;
  /** A plain-English description of the DATA the user gets (not the job name). */
  desc: string;
  /** The billing `EnrichmentTypeKey`(s) this group rolls up. */
  types: readonly EnrichmentTypeKey[];
  /** A market group runs once per cell (Meta/SERP); a lead group is per-lead. */
  basis: "lead" | "market";
  /** 2-letter chip glyph for the compact per-row strip. */
  chip: string;
  /** Optional per-market nuance ("market · per cell") for the sheet + tooltip. */
  marketNote?: string;
}

/**
 * The canonical 9-type → 7-group mapping. THE one place the vocabulary lives.
 *   - Contacts & site tech ← CONTACTS + TECH (one DOM fetch; shown as one)
 *   - Reviews              ← REVIEWS
 *   - Site speed & SEO     ← LIGHTHOUSE
 *   - Services             ← SERVICES
 *   - AI brief             ← AI_RESEARCH
 *   - Ad activity          ← META_ADS (market · per cell) + GOOGLE_ADS (per lead)
 *   - Search rank          ← SERP (market · per cell)
 * (Services + AI brief stay two groups for now — they'll merge into one AI job
 * later; keeping them split matches the billing types 1:1 until then.)
 */
export const DATA_GROUPS: readonly DataGroup[] = [
  {
    key: "contacts_tech",
    label: "Contacts & site tech",
    desc: "Emails, phones, socials + the tools their site runs on",
    types: ["CONTACTS", "TECH"],
    basis: "lead",
    chip: "Ct",
  },
  {
    key: "reviews",
    label: "Reviews",
    desc: "Google rating, review count, reply rate, recency",
    types: ["REVIEWS"],
    basis: "lead",
    chip: "Rv",
  },
  {
    key: "site_speed",
    label: "Site speed & SEO",
    desc: "Lighthouse mobile performance + on-page SEO health",
    types: ["LIGHTHOUSE"],
    basis: "lead",
    chip: "Sp",
  },
  {
    key: "services",
    label: "Services",
    desc: "The treatments / services they list on their site",
    types: ["SERVICES"],
    basis: "lead",
    chip: "Sv",
  },
  {
    key: "ai_brief",
    label: "AI brief",
    desc: "An AI-written read on the business + pitch angles",
    types: ["AI_RESEARCH"],
    basis: "lead",
    chip: "Ai",
  },
  {
    key: "ads",
    label: "Ad activity",
    desc: "Meta + Google ads they're running right now",
    types: ["META_ADS", "GOOGLE_ADS"],
    basis: "market",
    chip: "Ad",
    marketNote: "Meta runs per market cell · Google per lead",
  },
  {
    key: "search",
    label: "Search rank",
    desc: "Where they rank in the local map pack + organic search",
    types: ["SERP"],
    basis: "market",
    chip: "Se",
    marketNote: "market · runs once per cell",
  },
] as const;

/** All 7 data-group keys, in render order — THE coverage denominator (`/ 7`). */
export const DATA_GROUP_KEYS: readonly DataGroupKey[] = DATA_GROUPS.map(
  (g) => g.key,
);

/** Look up a group by key (stable reference to the shared DATA_GROUPS entry). */
export function dataGroupFor(key: DataGroupKey): DataGroup {
  // Non-null: `key` is a DataGroupKey, so the find always hits.
  return DATA_GROUPS.find((g) => g.key === key)!;
}

/** The billing `EnrichmentType` tokens (lowercase, as the enrich flow uses) a
 *  data group maps to — for pre-selecting the right lines in the enrich sheet.
 *  META_ADS → meta_ads, TECH → tech, etc. */
const TYPE_KEY_TO_ENRICH_TOKEN: Record<EnrichmentTypeKey, string> = {
  CONTACTS: "contacts",
  SERVICES: "services",
  TECH: "tech",
  REVIEWS: "reviews",
  META_ADS: "meta_ads",
  GOOGLE_ADS: "google_ads",
  SERP: "serp",
  LIGHTHOUSE: "lighthouse",
  AI_RESEARCH: "ai_research",
};

/** De-duped enrichment-type tokens for a set of data groups (for the sheet's
 *  pre-select + the coverage-CTA deep-seed). */
export function enrichTypesForGroups(keys: readonly DataGroupKey[]): string[] {
  const out = new Set<string>();
  for (const k of keys)
    for (const t of dataGroupFor(k).types) out.add(TYPE_KEY_TO_ENRICH_TOKEN[t]);
  return [...out];
}

/**
 * Roll the per-TYPE states of ONE group into a single group state by precedence:
 *   running (any type in flight)  →  failed (any errored, none running)  →
 *   not_run (ALL never scanned)   →  enriched (EVERY type has data)      →
 *   empty (ran everywhere but ≥1 produced nothing / mixed).
 *
 * The order matters: `running` and `failed` are actionable-now signals that win
 * over a stale mix; a group is only "enriched" (green, done) when EVERY type it
 * spans produced data; "not_run" only when NONE of its types ran (so a partly-
 * run group reads `empty`, i.e. "ran, but not fully" — never a false "not yet"
 * that would re-charge the type that already ran).
 */
export function rollUpGroupState(
  types: Record<EnrichmentTypeKey, TypeState>,
  group: DataGroup,
): TypeState {
  const states = group.types.map((t) => types[t]);
  if (states.some((s) => s === "running")) return "running";
  if (states.some((s) => s === "failed")) return "failed";
  if (states.every((s) => s === "not_run")) return "not_run";
  if (states.every((s) => s === "enriched")) return "enriched";
  return "empty";
}

/** The full per-group state map for ONE business, rolled up from its 9 type
 *  states. THE input every coverage surface reads. */
export function deriveGroupStates(
  types: Record<EnrichmentTypeKey, TypeState>,
): Record<DataGroupKey, TypeState> {
  const out = {} as Record<DataGroupKey, TypeState>;
  for (const g of DATA_GROUPS) out[g.key] = rollUpGroupState(types, g);
  return out;
}

/** How many of the 7 groups produced data (the "N / 7" numerator). */
export function enrichedGroupCount(
  states: Record<DataGroupKey, TypeState>,
): number {
  return DATA_GROUP_KEYS.filter((k) => states[k] === "enriched").length;
}

/** True once ANY of the 7 groups has run (running / enriched / empty / failed) —
 *  the group-level predicate behind the "Enriched only" workbench view. */
export function anyGroupRan(states: Record<DataGroupKey, TypeState>): boolean {
  return DATA_GROUP_KEYS.some((k) => states[k] !== "not_run");
}
