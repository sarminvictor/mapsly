// modules/agency-portal/discover/family-coverage.ts · the PURE derivation for
// enrichment run-state — the ONE source of truth every surface reads
// (2026-07-06 truth unification):
//
//   run records ──▶ deriveTypeStates (9 types, the atom)
//                     └▶ deriveGroupStates (7 user-facing data groups)
//
// Fed exclusively by coverage-matrix.ts loadTypeStatesForBusinesses (which the
// workbench pages AND lead-detail both call), so the table, the enrich popup,
// the drawer, the business page, and the report can never disagree.
//
// Wave 2 of the unification (2026-07-06) RETIRED the legacy 5-family display
// axis (DataFamily / FamilyState / deriveFamilyStates): the 9-type model is
// the only derivation and the 7-group roll-up the only display vocabulary.
//
// Pure (no DB, no React) so it is unit-testable and importable by both the
// server pages and client components (Pattern 4 — plain data only).

import {
  CREDIT_PRICES,
  ENRICHMENT_PRICES,
  type EnrichmentType,
} from "@/modules/cost/pricing";

/**
 * Job statuses that count as "this type's work is done" for coverage. These
 * are the members of the `EnrichmentJobStatus` enum that mean the unit needed
 * no further work: `DONE` (ran) + `SKIPPED_FRESH` (already fresh, $0) + the
 * entitlement-model successes `CHARGED_FROM_DB` (served from our DB, charged)
 * and `SKIPPED_ENTITLED` (already owned, $0). All four are terminal-success and
 * are UI-indistinguishable from a live run (D3). Legacy runs never emit the two
 * entitlement statuses, so including them here is a no-op when the flag is off.
 */
export const COVERED_JOB_STATUSES = [
  "DONE",
  "SKIPPED_FRESH",
  "CHARGED_FROM_DB",
  "SKIPPED_ENTITLED",
] as const;

/**
 * The `EnrichmentJobStatus` values that mean "this type's work was ATTEMPTED
 * and ERRORED" — so an un-covered type with a failed job reads "failed",
 * NOT the same grey "not yet" as a type that was never touched. Closes the
 * "failed ≡ never-run" complaint (docs/discover-workbench-research §status).
 */
export const FAILED_JOB_STATUSES = ["FAILED"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment TYPE run-state model (audit A2 · the 9 things Tom pays for).
//
// State comes from RUN RECORDS (EnrichmentJob for the job-backed types,
// AdMarketRun for the cell-scoped Meta/SERP), and data presence ONLY splits a
// completed run into "enriched" (produced data) vs "empty" (ran, verified
// nothing) — presence without a run never fakes "enriched" (the reviewCount
// bug), and a completed run with no data never reads "not_run" (which would
// re-charge a retry). Tom pays per `EnrichmentFamily`; `EnrichmentJob` is
// keyed by the 9-value enum (PLAYBOOK excluded — an internal roll-up, never a
// purchasable line), so per-TYPE run-state derives from the run records.
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
 * The run state of ONE enrichment type for ONE business:
 *   - `enriched` · a run completed and produced data → show it
 *   - `empty`    · a run completed but found nothing (verified) → calm "none",
 *                  never re-charge a retry (audit A5)
 *   - `failed`   · the run errored (retries exhausted) → red, retry
 *   - `not_run`  · never attempted → the actionable "enrich" affordance
 *   - `running`  · a QUEUED/RUNNING job (or active cell run) is in flight —
 *                  the badge pulses, and it survives a page refresh because it
 *                  reads the honest job status, not a client-side bus flag.
 */
export type TypeState = "enriched" | "empty" | "failed" | "not_run" | "running";

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
 * with no run behind it never fakes "enriched". Absent = false.
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
 * inline per-cell and produce no per-business job rows).
 */
export interface TypeRunInputs {
  presence: TypePresence;
  /** `EnrichmentFamily` values with a DONE / SKIPPED_FRESH job. */
  doneJobFamilies?: ReadonlySet<string>;
  /** `EnrichmentFamily` values with a FAILED job (retries exhausted). */
  failedJobFamilies?: ReadonlySet<string>;
  /** `EnrichmentFamily` values with a QUEUED / RUNNING job (in flight). */
  runningJobFamilies?: ReadonlySet<string>;
  /** Completed (OK/PARTIAL) cell run for this business's cell. GOOGLE is
   *  deliberately absent — google_ads is a per-BUSINESS research whose truth
   *  is its EnrichmentJob row; the cell-keyed GOOGLE AdMarketRun telemetry
   *  polluted whole cells (2026-07-06 truth unification). */
  cellRan?: { metaAds?: boolean; serp?: boolean };
  /** Failed (and never-completed) cell run for this business's cell. */
  cellFailed?: { metaAds?: boolean; serp?: boolean };
  /**
   * An ACTIVE (PENDING/RUNNING) EnrichmentRun covers this business's cell for a
   * cell-basis type. Meta/SERP run inline per-cell and write their AdMarketRun
   * only on completion — so without this flag they can NEVER read `running`
   * server-side (the issue-11 gap: no loader, stale value, lost on refresh).
   * The coverage matrix derives it from active runs' scopeRefsJson.cellKeys ×
   * enrichmentsJson.
   */
  cellRunning?: { metaAds?: boolean; serp?: boolean };
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
 * enrichment types: run records decide ran/failed/running, presence only splits
 * a completed run into enriched vs empty. Pure — server-computed, crosses to
 * the client as plain data (Pattern 4).
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
    // TECH rides the CONTACTS job — dispatch.buildJobPlan folds contacts+tech
    // into ONE `family:"CONTACTS"` job (the same DOM fetch feeds both), so a
    // TECH-family job row NEVER exists. Without folding the CONTACTS signals in,
    // TECH is permanently `not_run`: the workbench's "Custom / unknown" branch
    // was dead code, the Built on / Booking tool cells lied "— enrich" over
    // scanned data, and no loader ever showed during the scan (issues 8+9).
    TECH: typeState({
      hasData: p.tech === true,
      running: has(running, "TECH") || has(running, "CONTACTS"),
      ran: has(done, "TECH") || has(done, "CONTACTS"),
      failed: has(failed, "TECH") || has(failed, "CONTACTS"),
    }),
    REVIEWS: jobType("REVIEWS", p.reviews === true),
    LIGHTHOUSE: jobType("LIGHTHOUSE", p.lighthouse === true),
    AI_RESEARCH: jobType("AI_RESEARCH", p.aiResearch === true),
    // Ads/SERP: cell-scoped run signal ∪ any per-business job signal (a future
    // dispatch that emits job rows for them stays correct either way). The
    // in-flight signal comes from ACTIVE EnrichmentRuns covering the cell
    // (cellRunning) — Meta/SERP write no job rows and their AdMarketRun lands
    // only on completion.
    META_ADS: typeState({
      hasData: p.metaAds === true,
      running: has(running, "META_ADS") || inp.cellRunning?.metaAds === true,
      ran: has(done, "META_ADS") || inp.cellRan?.metaAds === true,
      failed: has(failed, "META_ADS") || inp.cellFailed?.metaAds === true,
    }),
    // GOOGLE_ADS is per-business: its EnrichmentJob row is the ONLY run signal
    // (no cell fold — see TypeRunInputs.cellRan doc).
    GOOGLE_ADS: typeState({
      hasData: p.googleAds === true,
      running: has(running, "GOOGLE_ADS"),
      ran: has(done, "GOOGLE_ADS"),
      failed: has(failed, "GOOGLE_ADS"),
    }),
    SERP: typeState({
      hasData: p.serp === true,
      running: has(running, "SERP") || inp.cellRunning?.serp === true,
      ran: has(done, "SERP") || inp.cellRan?.serp === true,
      failed: has(failed, "SERP") || inp.cellFailed?.serp === true,
    }),
  };
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
  | "ai_brief"
  | "meta_ads"
  | "google_ads"
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
 *   - AI brief             ← SERVICES + AI_RESEARCH (services is part of the AI
 *                            read; shown as ONE door, not two)
 *   - Meta ads             ← META_ADS (market · runs once per cell)
 *   - Google ads           ← GOOGLE_ADS (per lead · target-host attribution)
 *   - Search rank          ← SERP (market · per cell)
 * Meta and Google ads are DELIBERATELY separate groups — distinct sources, cost
 * bases, and reliability, even when one signal triggers both. Services folds into
 * the AI brief (both read the same fetched DOM; the user gets one "AI brief").
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
    key: "ai_brief",
    label: "AI brief",
    desc: "Services they list + an AI-written read on the business & pitch angles",
    types: ["SERVICES", "AI_RESEARCH"],
    basis: "lead",
    chip: "Ai",
  },
  {
    key: "meta_ads",
    label: "Meta ads",
    desc: "Facebook / Instagram ads they're running right now",
    types: ["META_ADS"],
    basis: "market",
    chip: "Ma",
    marketNote: "market · runs once per cell",
  },
  {
    key: "google_ads",
    label: "Google ads",
    desc: "Google Search / Display ads they're running right now",
    types: ["GOOGLE_ADS"],
    basis: "lead",
    chip: "Ga",
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

/** Inverse of the token map — resolve an enrichment-type token ("meta_ads") to
 *  its `EnrichmentTypeKey` ("META_ADS"). Undefined for unknown tokens. Used by
 *  the workbench to match a column's enrich tokens against the per-type
 *  `running` state (the refresh-surviving loader source). */
export function typeKeyForEnrichToken(
  token: string,
): EnrichmentTypeKey | undefined {
  for (const [key, tok] of Object.entries(TYPE_KEY_TO_ENRICH_TOKEN))
    if (tok === token) return key as EnrichmentTypeKey;
  return undefined;
}

/** The enrichment-type tokens that are CELL-basis (run once per market cell for
 *  the whole cohort — dispatch's CELL_FAMILIES). A run of one of these updates
 *  EVERY lead in the cell, so "is this cell updating" must ignore the per-lead
 *  id scope. */
export const CELL_BASIS_TOKENS: ReadonlySet<string> = new Set([
  "meta_ads",
  "serp",
]);

/**
 * ONE client-side price helper pair for a data group — extracted here so the
 * enrich sheet, the workbench toolbar button, and the bulk bar all price a
 * group identically (they used to run three different estimators; the button
 * said "~10 cr" while the sheet's rows said 30+ — issue 2 of the 2026-07-06
 * browser test). The server preflight stays the authoritative billed net.
 */
export function groupLeadCredits(group: DataGroup): number {
  let c = 0;
  for (const t of enrichTypesForGroups([group.key])) {
    const key = t as EnrichmentType;
    if (ENRICHMENT_PRICES[key].unit === "business") c += CREDIT_PRICES[key];
  }
  return c;
}

/** Per-CELL credit price of a group (Meta / SERP — cell-unit types only). */
export function groupCellCredits(group: DataGroup): number {
  let c = 0;
  for (const t of enrichTypesForGroups([group.key])) {
    const key = t as EnrichmentType;
    if (ENRICHMENT_PRICES[key].unit === "cell") c += CREDIT_PRICES[key];
  }
  return c;
}

/**
 * Roll the per-TYPE states of ONE group into a single group state by precedence:
 *   running (any type in flight)  →  failed (any errored, none running)  →
 *   not_run (ALL never scanned)   →  enriched (ANY type has data)        →
 *   empty (ran, nothing found anywhere).
 *
 * The order matters: `running` and `failed` are actionable-now signals that win
 * over a stale mix; "not_run" only when NONE of its types ran (so a partly-run
 * group never reads a false "not yet" that would re-charge the type that ran).
 */
export function rollUpGroupState(
  types: Record<EnrichmentTypeKey, TypeState>,
  group: DataGroup,
): TypeState {
  const states = group.types.map((t) => types[t]);
  if (states.some((s) => s === "running")) return "running";
  if (states.some((s) => s === "failed")) return "failed";
  if (states.every((s) => s === "not_run")) return "not_run";
  // TRUTH UNIFICATION (2026-07-06) · "enriched" = ANY type produced data (was
  // EVERY). The strict rule marked the whole AI-brief group "empty" when the
  // AI research HAD data but the services sub-scan found no menu — the drawer
  // showed a real AI brief while the strip said "no data" (the Boise 3/7
  // ticket). A group with SOMETHING to show is enriched; "empty" is reserved
  // for ran-and-found-nothing-at-all.
  if (states.some((s) => s === "enriched")) return "enriched";
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

/** The per-LEAD group keys — `basis:"lead"` only (excludes the per-market
 *  `meta_ads`/`search`). A cell-level ad/SERP scan must NOT read as a personal
 *  enrichment on every lead in the cohort. */
export const LEAD_GROUP_KEYS: readonly DataGroupKey[] = DATA_GROUPS.filter(
  (g) => g.basis === "lead",
).map((g) => g.key);

/** True once any PER-LEAD group has run — the honest predicate behind "Enriched
 *  only" (skips per-market groups so it means "a personal enrichment ran"). */
export function anyLeadGroupRan(
  states: Record<DataGroupKey, TypeState>,
): boolean {
  return LEAD_GROUP_KEYS.some((k) => states[k] !== "not_run");
}
