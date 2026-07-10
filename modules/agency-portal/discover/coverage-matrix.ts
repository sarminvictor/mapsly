// modules/agency-portal/discover/coverage-matrix.ts · THE server loader for
// per-business enrichment run-state. ONE derivation chain for every surface:
//
//   DB run records ──▶ loadTypeStatesForBusinesses ──▶ deriveTypeStates (9)
//                                                         └▶ deriveGroupStates (7, client)
//
// Consumers: the workspace page + saved-list page (workbench matrix props) and
// lead-detail.ts (drawer / business page / report / share) — ALL surfaces read
// the same loader so they can never disagree again (2026-07-06 truth
// unification; the Boise ticket was three surfaces reading three derivations).
//
// AGENCY-SCOPED: the caller passes the resolved agencyId; loadCoverageMatrix
// re-checks the discovery belongs to it (cross-agency / missing → null). No
// external API in the request path — pure DB reads.

import prisma from "@/lib/prisma";

import {
  COVERED_JOB_STATUSES,
  FAILED_JOB_STATUSES,
  type DataGroupKey,
  type EnrichmentTypeKey,
  type TypePresence,
  type TypeState,
  deriveTypeStates,
} from "./family-coverage";
import { loadFreshTimestamps } from "@/modules/discovery/enrich-fresh-db";
import { loadEntitlements } from "@/modules/discovery/entitlements";
import { entitlementBillingEnabled } from "@/modules/cost/flags";
import { permanentlyUnavailablePairs } from "@/modules/enrichment/dispatch";

/** One business's honest enrichment RUN state. */
export interface CoverageRow {
  businessId: string;
  /** The atom: per-TYPE state over the 9 purchasable enrichments. */
  typeStates: Record<EnrichmentTypeKey, TypeState>;
}

/** Ad-platform run status that counts as "the cell's ads/search enrichment ran"
 *  (produced coverage) vs "errored". Meta/SERP runs are cell-scoped
 *  (AdMarketRun), not per-business jobs, so a completed cell run IS the
 *  coverage signal. GOOGLE rows are deliberately IGNORED here: the per-business
 *  Google collector writes cell-keyed telemetry rows (google-ads.ts) that made
 *  EVERY business in a cell read "google ran" — the honest GOOGLE_ADS signal is
 *  its per-business EnrichmentJob row (truth unification, 2026-07-06). */
const AD_RUN_OK = new Set(["OK", "PARTIAL"]);
const AD_RUN_FAILED = new Set(["FAILED"]);

/** The job-backed enrichment families — the ONLY ones that produce FAILED
 *  `EnrichmentJob` rows (TECH folds into the CONTACTS job; Meta/SERP are
 *  cell-scoped AdMarketRuns). These are exactly `permanentlyUnavailablePairs`'s
 *  `families` union, kept local so coverage-matrix doesn't depend on a
 *  non-exported dispatch type; a type-guard filter keeps the "unavailable"
 *  computation honest (2026-07-10). */
const JOB_BACKED_FAMILIES_LIST = [
  "CONTACTS",
  "SERVICES",
  "REVIEWS",
  "AI_RESEARCH",
  "LIGHTHOUSE",
  "GOOGLE_ADS",
] as const;
type JobBackedFamily = (typeof JOB_BACKED_FAMILIES_LIST)[number];
const JOB_BACKED_FAMILIES: ReadonlySet<string> = new Set(
  JOB_BACKED_FAMILIES_LIST,
);

/** `EnrichmentJobStatus` values that mean a type's enrichment is IN FLIGHT —
 *  QUEUED (claimed, waiting) or RUNNING (executing). The badge pulses while a
 *  job sits in either. */
const RUNNING_JOB_STATUSES = ["QUEUED", "RUNNING"] as const;

/**
 * THE shared state builder. Given businesses (id + cellKey), load every run
 * record + presence row and derive the honest per-type AND per-family states.
 * Everything that renders enrichment state calls THIS (directly or via
 * loadCoverageMatrix / lead-detail) — never a private re-derivation.
 *
 * `opts.presence` (2026-07-06 render refactor): the workbench row builder
 * already holds every presence fact from its ONE hydration pass — passing it
 * in skips the 9 per-type existence scans, leaving only this loader's
 * genuinely distinct queries (the EnrichmentJob run matrix ×3, the cell-scoped
 * AdMarketRun runs, the active EnrichmentRuns). Callers WITHOUT a data pass
 * (drawer / endpoints) omit it and get the scans as before. The provided map
 * must cover the same semantics as {@link scanTypePresence} — real rows only,
 * never a derived aggregate like `reviewCount`.
 */
export async function loadTypeStatesForBusinesses(
  businesses: readonly { id: string; cellKey: string | null }[],
  agencyId: string,
  opts?: { presence?: ReadonlyMap<string, TypePresence> },
): Promise<Map<string, CoverageRow>> {
  const businessIds = businesses.map((b) => b.id);
  if (businessIds.length === 0) return new Map();

  // Meta/SERP runs are CELL-scoped — cover exactly the cells these businesses
  // live in.
  const runCellKeys = Array.from(
    new Set(
      businesses.map((b) => b.cellKey).filter((k): k is string => k != null),
    ),
  );

  // Real enriched-row presence (caller-provided or scanned) — plus
  // the EnrichmentJob run matrix, the cell-scoped AdMarketRun runs, and the
  // ACTIVE EnrichmentRuns (for the refresh-surviving Meta/SERP "running").
  const [presence, jobRows, failedRows, runningRows, adRuns, activeRuns] =
    await Promise.all([
      opts?.presence
        ? Promise.resolve(opts.presence)
        : scanTypePresence(businessIds),
      // Captures work that produced no scalar (e.g. a contacts scan finding 0).
      prisma.enrichmentJob.groupBy({
        by: ["businessId", "family"],
        where: {
          businessId: { in: businessIds },
          status: { in: [...COVERED_JOB_STATUSES] },
        },
      }),
      prisma.enrichmentJob.groupBy({
        by: ["businessId", "family"],
        where: {
          businessId: { in: businessIds },
          status: { in: [...FAILED_JOB_STATUSES] },
        },
      }),
      prisma.enrichmentJob.groupBy({
        by: ["businessId", "family"],
        where: {
          businessId: { in: businessIds },
          status: { in: [...RUNNING_JOB_STATUSES] },
        },
      }),
      runCellKeys.length > 0
        ? prisma.adMarketRun.groupBy({
            by: ["cellKey", "platform", "status"],
            where: { cellKey: { in: runCellKeys } },
          })
        : Promise.resolve(
            [] as { cellKey: string; platform: string; status: string }[],
          ),
      // ACTIVE runs (PENDING/RUNNING) that cover a cell with a cell-basis type
      // (meta_ads/serp). Those collectors run inline per-cell and write their
      // AdMarketRun only on completion — the ONLY in-flight record is the
      // EnrichmentRun itself. This is what lets a Meta/SERP field read `running`
      // after a page refresh.
      prisma.enrichmentRun.findMany({
        where: { agencyId, status: { in: ["PENDING", "RUNNING"] } },
        select: { enrichmentsJson: true, scopeRefsJson: true },
        orderBy: { startedAt: "desc" },
        take: 50,
      }),
    ]);

  const foldJobs = (
    rows: { businessId: string; family: string }[],
  ): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    for (const g of rows) {
      const set = map.get(g.businessId) ?? new Set<string>();
      set.add(g.family);
      map.set(g.businessId, set);
    }
    return map;
  };
  const doneJobs = foldJobs(jobRows);
  const failedJobs = foldJobs(failedRows);
  const runningJobs = foldJobs(runningRows);

  // 2026-07-10 · of the FAILED (business, family) pairs, which are PERMANENTLY
  // unavailable — dead site / parked domain / no source, OR the cross-run
  // attempt cap hit? These are ALREADY skipped at fan-out + excluded from the
  // enrich quote (permanentlyUnavailablePairs is the same predicate the billing
  // preflight uses); surfacing them here stops the workbench cell from showing a
  // pointless "failed · retry" and renders a terminal "Not available" instead.
  // Scoped to the distinct FAILED families (no extra work when nothing failed);
  // ONE indexed read inside permanentlyUnavailablePairs. Type-GUARD to the
  // job-backed families (no unchecked `as` · conventions.md): only these ever
  // land as FAILED EnrichmentJob rows — TECH folds into CONTACTS, Meta/SERP
  // write AdMarketRun not job rows — so a stray family can never mis-mark a
  // cell type "unavailable" and diverge from the quote's jobFamilyForType keying.
  const failedFamilies = Array.from(
    new Set(failedRows.map((r) => r.family)),
  ).filter((f): f is JobBackedFamily => JOB_BACKED_FAMILIES.has(f));
  const deadPairs =
    failedFamilies.length > 0
      ? await permanentlyUnavailablePairs(businessIds, failedFamilies)
      : new Set<string>();
  // Fold "${businessId}:${family}" → per-business unavailable-family sets.
  const unavailableJobs = new Map<string, Set<string>>();
  for (const key of deadPairs) {
    const sep = key.lastIndexOf(":");
    if (sep <= 0) continue;
    const bizId = key.slice(0, sep);
    const fam = key.slice(sep + 1);
    const set = unavailableJobs.get(bizId) ?? new Set<string>();
    set.add(fam);
    unavailableJobs.set(bizId, set);
  }

  // Per-cell Meta/SERP run state, folded from the grouped AdMarketRun rows.
  // GOOGLE rows are skipped (see AD_RUN_OK comment) — google_ads truth is the
  // per-business job rail.
  interface CellRuns {
    metaRan: boolean;
    metaFailed: boolean;
    searchRan: boolean;
    searchFailed: boolean;
  }
  const cellRuns = new Map<string, CellRuns>();
  const cellOf = (k: string): CellRuns => {
    let c = cellRuns.get(k);
    if (!c) {
      c = {
        metaRan: false,
        metaFailed: false,
        searchRan: false,
        searchFailed: false,
      };
      cellRuns.set(k, c);
    }
    return c;
  };
  for (const g of adRuns) {
    if (g.platform === "GOOGLE") continue; // per-business telemetry — not cell truth
    const c = cellOf(g.cellKey);
    const ok = AD_RUN_OK.has(g.status);
    const failed = AD_RUN_FAILED.has(g.status);
    if (g.platform === "SERP") {
      if (ok) c.searchRan = true;
      else if (failed) c.searchFailed = true;
    } else {
      // Any non-SERP, non-GOOGLE platform is Meta (the default ad source).
      if (ok) c.metaRan = true;
      else if (failed) c.metaFailed = true;
    }
  }

  // ACTIVE runs → per-cell "in flight" for the cell-basis types.
  const cellRunning = new Map<string, { metaAds: boolean; serp: boolean }>();
  for (const run of activeRuns) {
    const tokens = Array.isArray(run.enrichmentsJson)
      ? (run.enrichmentsJson as unknown[]).filter(
          (t): t is string => typeof t === "string",
        )
      : [];
    const wantsMeta = tokens.includes("meta_ads");
    const wantsSerp = tokens.includes("serp");
    if (!wantsMeta && !wantsSerp) continue;
    const scope = run.scopeRefsJson as { cellKeys?: unknown } | null;
    const keys = Array.isArray(scope?.cellKeys)
      ? (scope.cellKeys as unknown[]).filter(
          (k): k is string => typeof k === "string",
        )
      : [];
    for (const k of keys) {
      const c = cellRunning.get(k) ?? { metaAds: false, serp: false };
      if (wantsMeta) c.metaAds = true;
      if (wantsSerp) c.serp = true;
      cellRunning.set(k, c);
    }
  }

  // Read gate (G9/S10 · entitlement model): coverage's "enriched" truth is
  // GLOBAL today (any agency's jobs + real-row presence). Under the flag, a
  // family THIS agency doesn't own reads as `not_run` ("available to enrich /
  // unlock") instead of leaking a rival's paid research as "done". One batched
  // read; no-op when the flag is off.
  const entMode = entitlementBillingEnabled();
  const entSet = entMode
    ? await loadEntitlements(agencyId, businessIds, runCellKeys)
    : null;

  const out = new Map<string, CoverageRow>();
  for (const b of businesses) {
    const cell = b.cellKey ? cellRuns.get(b.cellKey) : undefined;
    const running = b.cellKey ? cellRunning.get(b.cellKey) : undefined;
    const typeStates = deriveTypeStates({
      presence: presence.get(b.id) ?? {},
      doneJobFamilies: doneJobs.get(b.id),
      failedJobFamilies: failedJobs.get(b.id),
      unavailableJobFamilies: unavailableJobs.get(b.id),
      runningJobFamilies: runningJobs.get(b.id),
      cellRan: {
        metaAds: cell?.metaRan,
        serp: cell?.searchRan,
      },
      cellFailed: {
        metaAds: cell ? cell.metaFailed && !cell.metaRan : false,
        serp: cell ? cell.searchFailed && !cell.searchRan : false,
      },
      cellRunning: running
        ? { metaAds: running.metaAds, serp: running.serp }
        : undefined,
    });
    if (entMode && entSet) {
      const ownedBiz = entSet.perBusiness.get(b.id);
      const ownedCell = b.cellKey ? entSet.perCell.get(b.cellKey) : undefined;
      for (const key of Object.keys(typeStates) as EnrichmentTypeKey[]) {
        const lc = key.toLowerCase();
        const isCell = lc === "meta_ads" || lc === "serp";
        const owned = isCell
          ? (ownedCell?.has(lc as never) ?? false)
          : (ownedBiz?.has(lc as never) ?? false);
        // Keep this agency's own in-flight run visible ("running"); everything
        // un-owned collapses to not_run (the teaser state).
        if (!owned && typeStates[key] !== "running") {
          typeStates[key] = "not_run";
        }
      }
    }
    out.set(b.id, { businessId: b.id, typeStates });
  }
  return out;
}

/**
 * The 9 per-type existence scans (one indexed `distinct businessId` each) for
 * callers WITHOUT a data pass of their own. Reviews presence is REAL `Review`
 * rows, NOT `reviewCount` (a discovery GBP aggregate present on almost every
 * business — the audit bug). Presence only ever SPLITS a completed run into
 * enriched-vs-empty; a flag with no run behind it never fakes "enriched".
 */
async function scanTypePresence(
  businessIds: readonly string[],
): Promise<Map<string, TypePresence>> {
  const [
    reviewRows,
    audits,
    techs,
    contacts,
    services,
    aiResearch,
    metaAds,
    googleAds,
    serps,
  ] = await Promise.all([
    prisma.review.findMany({
      where: { businessId: { in: [...businessIds] } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.lighthouseAudit.findMany({
      where: { businessId: { in: [...businessIds] } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.businessTech.findMany({
      where: { businessId: { in: [...businessIds] } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.contact.findMany({
      where: { businessId: { in: [...businessIds] } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.businessService.findMany({
      where: { businessId: { in: [...businessIds] } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.businessEnrichment.findMany({
      where: { businessId: { in: [...businessIds] } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.adLibraryEntry.findMany({
      where: { businessId: { in: [...businessIds] }, platform: "META" },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.adLibraryEntry.findMany({
      where: { businessId: { in: [...businessIds] }, platform: "GOOGLE" },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.serpResult.findMany({
      where: { businessId: { in: [...businessIds] } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
  ]);

  const reviewSet = new Set(reviewRows.map((r) => r.businessId));
  const auditSet = new Set(audits.map((r) => r.businessId));
  const techSet = new Set(techs.map((r) => r.businessId));
  const contactSet = new Set(contacts.map((r) => r.businessId));
  const serviceSet = new Set(services.map((r) => r.businessId));
  const aiSet = new Set(aiResearch.map((r) => r.businessId));
  // AdLibraryEntry.businessId is nullable in the schema; the `in: businessIds`
  // filter never returns a null one, but narrow it for the typed Set anyway.
  const metaAdsSet = new Set(
    metaAds.map((r) => r.businessId).filter((id): id is string => id != null),
  );
  const googleAdsSet = new Set(
    googleAds.map((r) => r.businessId).filter((id): id is string => id != null),
  );
  const serpSet = new Set(serps.map((r) => r.businessId));

  const out = new Map<string, TypePresence>();
  for (const id of businessIds) {
    out.set(id, {
      contacts: contactSet.has(id),
      services: serviceSet.has(id),
      tech: techSet.has(id),
      reviews: reviewSet.has(id),
      metaAds: metaAdsSet.has(id),
      googleAds: googleAdsSet.has(id),
      serp: serpSet.has(id),
      lighthouse: auditSet.has(id),
      aiResearch: aiSet.has(id),
    });
  }
  return out;
}

/**
 * Build the coverage matrix for `discoveryId`, scoped to `agencyId`, over
 * EXACTLY the businesses the caller will render (`scopeBusinessIds` is
 * REQUIRED — the old unscoped top-N fallback drifted from the rendered window
 * and was deleted with its orphan route in the 2026-07-06 truth unification).
 *
 * Returns `null` when the discovery is missing or belongs to another agency.
 */
export async function loadCoverageMatrix(
  discoveryId: string,
  agencyId: string,
  scopeBusinessIds: string[],
): Promise<CoverageRow[] | null> {
  const discovery = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: { agencyId: true, cellKeys: true },
  });
  if (!discovery || discovery.agencyId !== agencyId) return null;
  if (scopeBusinessIds.length === 0) return [];

  const businesses = await prisma.business.findMany({
    where: { id: { in: scopeBusinessIds } },
    select: { id: true, cellKey: true },
  });
  const rows = await loadTypeStatesForBusinesses(businesses, agencyId);
  return businesses.map((b) => rows.get(b.id)!).filter(Boolean);
}

/** Flatten the per-TYPE state maps (the 9 billed types) — THE source of truth
 *  for every workbench/popup/drawer state read (Pattern 4). */
export function coverageTypeStatesToMap(
  rows: CoverageRow[],
): Record<string, Record<EnrichmentTypeKey, TypeState>> {
  const map: Record<string, Record<EnrichmentTypeKey, TypeState>> = {};
  for (const r of rows) map[r.businessId] = r.typeStates;
  return map;
}

/**
 * AUDIT U16 · per-business per-DATA-GROUP last-scanned ISO date for the
 * workbench's provenance tooltip ("scanned {when}"). Reads the SAME freshness
 * cursors the billing pre-flight uses (`loadFreshTimestamps`) so the tip's date
 * is the real last-enrichment time, not a guess. Group mapping:
 * contacts_tech→newer(contacts, tech), reviews→reviews cursor,
 * site_speed→lighthouse, ai_brief→newer(services, ai_research),
 * google_ads→per-business google_ads cursor, meta_ads→Meta cell run,
 * search→SERP cell run. A group with no timestamp is omitted (the tip drops
 * the date). Returns a plain map (Pattern 4).
 */
export async function loadScannedAtMap(
  businesses: { id: string; cellKey: string | null }[],
): Promise<Record<string, Partial<Record<DataGroupKey, string>>>> {
  const businessIds = businesses.map((b) => b.id);
  if (businessIds.length === 0) return {};
  const cellKeys = Array.from(
    new Set(
      businesses.map((b) => b.cellKey).filter((k): k is string => k != null),
    ),
  );

  let timestamps;
  try {
    timestamps = await loadFreshTimestamps(businessIds, cellKeys);
  } catch {
    // Provenance is a nicety — never let a freshness-read hiccup break the page.
    return {};
  }
  const { perBusiness, perCell } = timestamps;

  const iso = (d?: Date | null): string | undefined =>
    d ? d.toISOString() : undefined;
  const newer = (a?: Date | null, b?: Date | null): Date | null => {
    if (!a) return b ?? null;
    if (!b) return a;
    return a.getTime() >= b.getTime() ? a : b;
  };

  const map: Record<string, Partial<Record<DataGroupKey, string>>> = {};
  for (const b of businesses) {
    const pb = perBusiness.get(b.id);
    const pc = b.cellKey ? perCell.get(b.cellKey) : undefined;
    const entry: Partial<Record<DataGroupKey, string>> = {};
    const contactsTech = iso(newer(pb?.contacts, pb?.tech));
    if (contactsTech) entry.contacts_tech = contactsTech;
    const reviews = iso(pb?.reviews);
    if (reviews) entry.reviews = reviews;
    const siteSpeed = iso(pb?.lighthouse);
    if (siteSpeed) entry.site_speed = siteSpeed;
    const aiBrief = iso(newer(pb?.services, pb?.ai_research));
    if (aiBrief) entry.ai_brief = aiBrief;
    const metaAds = iso(pc?.meta_ads);
    if (metaAds) entry.meta_ads = metaAds;
    const googleAds = iso(pb?.google_ads);
    if (googleAds) entry.google_ads = googleAds;
    const search = iso(pc?.serp);
    if (search) entry.search = search;
    if (Object.keys(entry).length > 0) map[b.id] = entry;
  }
  return map;
}
