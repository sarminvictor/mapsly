// modules/agency-portal/discover/coverage-matrix.ts · the SERVER loader for the
// per-business per-family enrichment coverage matrix of one discovery.
//
// ONE query path, two consumers:
//   - the workspace page (server) — fetches the matrix inline and passes a plain
//     `{ businessId: DataFamily[] }` map to the client LeadsWorkbench (Pattern 4:
//     plain data only, no functions across the boundary)
//   - the route handler GET /api/agency/research/[discoveryId]/coverage — the
//     doc's batched read for the dot-strip (docs/enrichment-pipeline-plan-v2.md
//     §3 P1 + §10), agency-scoped
//
// Resolution mirrors lead-detail.ts / the workspace page: the discovery's
// businesses come from its `cellKeys` via `rawListWhere` (same hidden/closed gate
// as the visible raw market). Coverage per family is the UNION of real
// enriched-row presence and finished EnrichmentJob rows — see family-coverage.ts
// for why the union is required (ads/search run inline → no job rows, so the job
// matrix alone would re-fake them as never-covered).
//
// AGENCY-SCOPED: the caller passes the resolved agencyId; this loader re-checks
// the discovery belongs to it (cross-agency / missing → null). No external API in
// the request path — pure DB reads (`.claude/rules/security.md`,
// `.claude/rules/cost-discipline.md`).

import prisma from "@/lib/prisma";

import {
  COVERED_JOB_STATUSES,
  ENRICHMENT_FAMILIES,
  FAILED_JOB_STATUSES,
  type EnrichmentTypeKey,
  type FamilyState,
  type TypeState,
  deriveFamilyStates,
  deriveTypeStates,
} from "./family-coverage";
import { type DataFamily } from "./leads-workbench";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { loadFreshTimestamps } from "@/modules/discovery/enrich-fresh-db";

/** One business's honest per-family enrichment RUN state (audit §3). */
export interface CoverageRow {
  businessId: string;
  /** The 2026-07 source of truth: per-family state (enriched / empty / failed /
   *  not_run) derived from RUN records + data presence, not presence alone. */
  states: Record<DataFamily, FamilyState>;
  /** AUDIT A2 · the honest per-TYPE state (the 9 things Tom pays for) — powers
   *  the workbench "Enriched" column badge strip. Threaded ALONGSIDE `states`
   *  (the 5-family display model the A3 coverage panel still reads). */
  typeStates: Record<EnrichmentTypeKey, TypeState>;
  /** Legacy: families with DATA (state === "enriched") — kept so the boolean
   *  dot-strip + the lists page keep working during the migration. */
  families: DataFamily[];
  /** Legacy: families whose enrichment ERRORED (state === "failed"). */
  failed: DataFamily[];
}

/** Ad-platform run status that counts as "the cell's ads/search enrichment ran"
 *  (produced coverage) vs "errored". Ad/SERP runs are cell-scoped (AdMarketRun),
 *  not per-business jobs, so a completed cell run IS the coverage signal. */
const AD_RUN_OK = new Set(["OK", "PARTIAL"]);
const AD_RUN_FAILED = new Set(["FAILED"]);

/** `EnrichmentJobStatus` values that mean a type's enrichment is IN FLIGHT —
 *  QUEUED (claimed, waiting) or RUNNING (executing). The badge pulses while a
 *  job sits in either. */
const RUNNING_JOB_STATUSES = ["QUEUED", "RUNNING"] as const;

/**
 * Cap on businesses resolved into the matrix — matches the workbench's
 * MAX_BUSINESSES page cap so the dot-strip covers exactly the rendered rows.
 */
const MAX_BUSINESSES = 200;

/**
 * Build the coverage matrix for `discoveryId`, scoped to `agencyId`.
 *
 * `scopeBusinessIds` — when the caller already knows the EXACT rows it will
 * render (the paginated workspace window, or a saved list's leads), it passes
 * them so the matrix is scoped to precisely those businesses. This is
 * load-bearing for honesty: without it the loader re-derived its OWN top-N set
 * (order by reviewCount, take 200), which drifts out of the rendered window on
 * page 2+ and on curated lists — and every out-of-set row silently fell back to
 * the legacy boolean-presence model in the client (the exact fake-state lie this
 * audit set out to kill), and corrupted the C5 field-state filters. Omit it only
 * for the standalone coverage route, which has no caller-side window (legacy
 * top-N behaviour preserved for that consumer).
 *
 * Returns `null` when the discovery is missing or belongs to another agency
 * (the caller maps that to 404 / not-found — we never confirm another agency's
 * data). Returns `[]` when the discovery has no cells or no businesses.
 */
export async function loadCoverageMatrix(
  discoveryId: string,
  agencyId: string,
  scopeBusinessIds?: string[],
): Promise<CoverageRow[] | null> {
  const discovery = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: { agencyId: true, cellKeys: true },
  });
  if (!discovery || discovery.agencyId !== agencyId) return null;

  const cellKeys = discovery.cellKeys;
  if (cellKeys.length === 0) return [];

  const scoped = scopeBusinessIds && scopeBusinessIds.length > 0;
  // Resolve the business set. When the caller passes the exact rendered rows we
  // scope to THOSE (aligns row-for-row, no drift); otherwise fall back to the
  // discovery's top-N by reviewCount (same gate + ordering as the raw market).
  const businesses = scoped
    ? await prisma.business.findMany({
        where: { id: { in: scopeBusinessIds } },
        select: { id: true, cellKey: true },
      })
    : await prisma.business.findMany({
        where: rawListWhere({ cellKeys }),
        orderBy: [{ reviewCount: "desc" }, { id: "asc" }],
        take: MAX_BUSINESSES,
        select: { id: true, cellKey: true },
      });
  const businessIds = businesses.map((b) => b.id);
  if (businessIds.length === 0) return [];

  // Ad/SERP runs are CELL-scoped. Cover exactly the cells the resolved
  // businesses live in (⊆ the discovery's cells) so per-business ad folding is
  // complete even for a curated list subset that spans a different cell set.
  const runCellKeys = scoped
    ? Array.from(
        new Set(
          businesses
            .map((b) => b.cellKey)
            .filter((k): k is string => k != null),
        ),
      )
    : cellKeys;

  // Real enriched-row presence — one indexed existence scan per family — plus
  // the EnrichmentJob run matrix and the cell-scoped AdMarketRun runs.
  //
  // AUDIT §3 FIX: reviews presence is REAL `Review` rows, NOT `reviewCount` (a
  // discovery GBP aggregate present on almost every business) — the old
  // false-positive that showed "Reviews enriched" on un-enriched leads.
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
    jobRows,
    failedRows,
    runningRows,
    adRuns,
  ] = await Promise.all([
    prisma.review.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.lighthouseAudit.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.businessTech.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.contact.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    // AUDIT A2 · services enrichment writes BusinessService rows (see
    // modules/services-general/extract.ts) — an honest per-type presence signal.
    prisma.businessService.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    // AUDIT A2 · AI research writes a BusinessEnrichment row per business.
    prisma.businessEnrichment.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    // AUDIT A2 · split ad presence by platform so meta_ads / google_ads are
    // distinct types (the 5-family model collapsed both into "ads").
    prisma.adLibraryEntry.findMany({
      where: { businessId: { in: businessIds }, platform: "META" },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.adLibraryEntry.findMany({
      where: { businessId: { in: businessIds }, platform: "GOOGLE" },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    prisma.serpResult.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
    // Captures work that produced no scalar (e.g. a contacts scan finding 0).
    prisma.enrichmentJob.groupBy({
      by: ["businessId", "family"],
      where: {
        businessId: { in: businessIds },
        status: { in: [...COVERED_JOB_STATUSES] },
      },
    }),
    // FAILED jobs → "failed" state (distinct from never-run). Same batched shape.
    prisma.enrichmentJob.groupBy({
      by: ["businessId", "family"],
      where: {
        businessId: { in: businessIds },
        status: { in: [...FAILED_JOB_STATUSES] },
      },
    }),
    // AUDIT A2 · QUEUED/RUNNING jobs → the per-type badge pulses "running".
    prisma.enrichmentJob.groupBy({
      by: ["businessId", "family"],
      where: {
        businessId: { in: businessIds },
        status: { in: [...RUNNING_JOB_STATUSES] },
      },
    }),
    // AUDIT §3 FIX: ads/SERP are CELL-scoped (no per-business job rows). A
    // COMPLETED AdMarketRun for the cell IS the coverage signal — so a cell
    // that ran and matched 0 ads reads "ran, none found" (empty), not "not
    // enriched" (the old false-negative). Grouped per (cell, platform, status).
    prisma.adMarketRun.groupBy({
      by: ["cellKey", "platform", "status"],
      where: { cellKey: { in: runCellKeys } },
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
  // The 5-family model's "ads" = either platform having a real AdLibraryEntry.
  const adsSet = new Set<string>([...metaAdsSet, ...googleAdsSet]);

  const doneJobs = new Map<string, Set<string>>();
  for (const g of jobRows) {
    const set = doneJobs.get(g.businessId) ?? new Set<string>();
    set.add(g.family);
    doneJobs.set(g.businessId, set);
  }

  const failedJobs = new Map<string, Set<string>>();
  for (const g of failedRows) {
    const set = failedJobs.get(g.businessId) ?? new Set<string>();
    set.add(g.family);
    failedJobs.set(g.businessId, set);
  }

  const runningJobs = new Map<string, Set<string>>();
  for (const g of runningRows) {
    const set = runningJobs.get(g.businessId) ?? new Set<string>();
    set.add(g.family);
    runningJobs.set(g.businessId, set);
  }

  // Per-cell ad/search run state, folded from the grouped AdMarketRun rows.
  // The FAMILY model collapses both ad platforms into one "ads" flag; the TYPE
  // model needs them split (meta_ads vs google_ads), so track both grains.
  // platform "META" → meta_ads, "GOOGLE" → google_ads, "SERP" → search.
  interface CellRuns {
    adsRan: boolean; // family "ads": either ad platform completed
    adsFailed: boolean;
    metaRan: boolean;
    metaFailed: boolean;
    googleRan: boolean;
    googleFailed: boolean;
    searchRan: boolean;
    searchFailed: boolean;
  }
  const cellRuns = new Map<string, CellRuns>();
  const cellOf = (k: string): CellRuns => {
    let c = cellRuns.get(k);
    if (!c) {
      c = {
        adsRan: false,
        adsFailed: false,
        metaRan: false,
        metaFailed: false,
        googleRan: false,
        googleFailed: false,
        searchRan: false,
        searchFailed: false,
      };
      cellRuns.set(k, c);
    }
    return c;
  };
  for (const g of adRuns) {
    const c = cellOf(g.cellKey);
    const ok = AD_RUN_OK.has(g.status);
    const failed = AD_RUN_FAILED.has(g.status);
    if (g.platform === "SERP") {
      if (ok) c.searchRan = true;
      else if (failed) c.searchFailed = true;
    } else if (g.platform === "GOOGLE") {
      if (ok) {
        c.googleRan = true;
        c.adsRan = true;
      } else if (failed) {
        c.googleFailed = true;
        c.adsFailed = true;
      }
    } else {
      // Any non-SERP, non-GOOGLE platform is Meta (the default ad source).
      if (ok) {
        c.metaRan = true;
        c.adsRan = true;
      } else if (failed) {
        c.metaFailed = true;
        c.adsFailed = true;
      }
    }
  }

  return businesses.map((b) => {
    const cell = b.cellKey ? cellRuns.get(b.cellKey) : undefined;
    const states = deriveFamilyStates({
      presence: {
        reviews: reviewSet.has(b.id),
        website: auditSet.has(b.id) || techSet.has(b.id),
        contacts: contactSet.has(b.id),
        ads: adsSet.has(b.id),
        search: serpSet.has(b.id),
      },
      doneJobFamilies: doneJobs.get(b.id),
      failedJobFamilies: failedJobs.get(b.id),
      cellRan: { ads: cell?.adsRan, search: cell?.searchRan },
      // A cell "failed" only counts if it never also completed (a later OK wins).
      cellFailed: {
        ads: cell ? cell.adsFailed && !cell.adsRan : false,
        search: cell ? cell.searchFailed && !cell.searchRan : false,
      },
    });
    // AUDIT A2 · the per-TYPE state over the 9 purchasable types, from the SAME
    // run records (presence only splits enriched↔empty; QUEUED/RUNNING → running).
    const typeStates = deriveTypeStates({
      presence: {
        contacts: contactSet.has(b.id),
        services: serviceSet.has(b.id),
        tech: techSet.has(b.id),
        reviews: reviewSet.has(b.id),
        metaAds: metaAdsSet.has(b.id),
        googleAds: googleAdsSet.has(b.id),
        serp: serpSet.has(b.id),
        lighthouse: auditSet.has(b.id),
        aiResearch: aiSet.has(b.id),
      },
      doneJobFamilies: doneJobs.get(b.id),
      failedJobFamilies: failedJobs.get(b.id),
      runningJobFamilies: runningJobs.get(b.id),
      cellRan: {
        metaAds: cell?.metaRan,
        googleAds: cell?.googleRan,
        serp: cell?.searchRan,
      },
      // A cell "failed" only counts if it never also completed (a later OK wins).
      cellFailed: {
        metaAds: cell ? cell.metaFailed && !cell.metaRan : false,
        googleAds: cell ? cell.googleFailed && !cell.googleRan : false,
        serp: cell ? cell.searchFailed && !cell.searchRan : false,
      },
    });
    return {
      businessId: b.id,
      states,
      typeStates,
      families: ENRICHMENT_FAMILIES.filter((f) => states[f] === "enriched"),
      failed: ENRICHMENT_FAMILIES.filter((f) => states[f] === "failed"),
    };
  });
}

/** Flatten a CoverageRow[] into the plain `{ businessId: families[] }` map the
 *  client LeadsWorkbench consumes (Pattern 4: plain serializable prop). */
export function coverageMatrixToMap(
  rows: CoverageRow[],
): Record<string, DataFamily[]> {
  const map: Record<string, DataFamily[]> = {};
  for (const r of rows) map[r.businessId] = r.families;
  return map;
}

/** Flatten the FAILED families into the same plain-map shape (only businesses
 *  with ≥1 failed family appear), for the dot-strip's red "failed" state. */
export function coverageFailedToMap(
  rows: CoverageRow[],
): Record<string, DataFamily[]> {
  const map: Record<string, DataFamily[]> = {};
  for (const r of rows) if (r.failed.length > 0) map[r.businessId] = r.failed;
  return map;
}

/** Flatten the per-family STATE maps — the audit §3 source of truth the client
 *  workbench reads for honest dots / cells / coverage (Pattern 4: plain data). */
export function coverageStatesToMap(
  rows: CoverageRow[],
): Record<string, Record<DataFamily, FamilyState>> {
  const map: Record<string, Record<DataFamily, FamilyState>> = {};
  for (const r of rows) map[r.businessId] = r.states;
  return map;
}

/** AUDIT A2 · flatten the per-TYPE state maps (the 9 billed types) — the source
 *  of truth for the workbench "Enriched" column badge strip (Pattern 4). */
export function coverageTypeStatesToMap(
  rows: CoverageRow[],
): Record<string, Record<EnrichmentTypeKey, TypeState>> {
  const map: Record<string, Record<EnrichmentTypeKey, TypeState>> = {};
  for (const r of rows) map[r.businessId] = r.typeStates;
  return map;
}

/**
 * AUDIT U16 · per-business per-family last-scanned ISO date for the workbench's
 * provenance tooltip ("scanned {when}"). Reads the SAME freshness cursors the
 * billing pre-flight uses (`loadFreshTimestamps`) so the tip's date is the real
 * last-enrichment time, not a guess. Family mapping: contacts→contacts cursor,
 * website→newer(tech, lighthouse), reviews→reviews cursor, ads→newer(meta,
 * google) cell run, search→serp cell run. A family with no timestamp is omitted
 * (the tip drops the date). Returns a plain map (Pattern 4).
 */
export async function loadScannedAtMap(
  businesses: { id: string; cellKey: string | null }[],
): Promise<Record<string, Partial<Record<DataFamily, string>>>> {
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

  const map: Record<string, Partial<Record<DataFamily, string>>> = {};
  for (const b of businesses) {
    const pb = perBusiness.get(b.id);
    const pc = b.cellKey ? perCell.get(b.cellKey) : undefined;
    const entry: Partial<Record<DataFamily, string>> = {};
    const contacts = iso(pb?.contacts);
    if (contacts) entry.contacts = contacts;
    const website = iso(newer(pb?.tech, pb?.lighthouse));
    if (website) entry.website = website;
    const reviews = iso(pb?.reviews);
    if (reviews) entry.reviews = reviews;
    const ads = iso(newer(pc?.meta_ads, pc?.google_ads));
    if (ads) entry.ads = ads;
    const search = iso(pc?.serp);
    if (search) entry.search = search;
    if (Object.keys(entry).length > 0) map[b.id] = entry;
  }
  return map;
}
