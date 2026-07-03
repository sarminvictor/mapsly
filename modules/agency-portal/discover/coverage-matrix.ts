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
  FAILED_JOB_STATUSES,
  deriveFailedFamilies,
  deriveFamilyCoverage,
} from "./family-coverage";
import { DATA_FAMILIES, type DataFamily } from "./leads-workbench";
import { rawListWhere } from "@/modules/discovery/raw-list";

/** One business's COVERED families (only the covered keys are listed). */
export interface CoverageRow {
  businessId: string;
  families: DataFamily[];
  /** Families whose enrichment job ERRORED and are still not covered — drives
   *  the red "failed" dot (distinct from grey "never run"). */
  failed: DataFamily[];
}

/**
 * Cap on businesses resolved into the matrix — matches the workbench's
 * MAX_BUSINESSES page cap so the dot-strip covers exactly the rendered rows.
 */
const MAX_BUSINESSES = 200;

/**
 * Build the coverage matrix for `discoveryId`, scoped to `agencyId`.
 *
 * Returns `null` when the discovery is missing or belongs to another agency
 * (the caller maps that to 404 / not-found — we never confirm another agency's
 * data). Returns `[]` when the discovery has no cells or no businesses.
 */
export async function loadCoverageMatrix(
  discoveryId: string,
  agencyId: string,
): Promise<CoverageRow[] | null> {
  const discovery = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: { agencyId: true, cellKeys: true },
  });
  if (!discovery || discovery.agencyId !== agencyId) return null;

  const cellKeys = discovery.cellKeys;
  if (cellKeys.length === 0) return [];

  // Resolve the discovery's businesses — same gate + ordering as the workspace
  // page so the matrix aligns row-for-row with the rendered workbench.
  const businesses = await prisma.business.findMany({
    where: rawListWhere({ cellKeys }),
    orderBy: [{ reviewCount: "desc" }, { id: "asc" }],
    take: MAX_BUSINESSES,
    select: { id: true, reviewCount: true },
  });
  const businessIds = businesses.map((b) => b.id);
  if (businessIds.length === 0) return [];

  // Real enriched-row presence (the drawer's `*Enriched` derivations) — one
  // indexed existence scan per family — plus the live EnrichmentJob matrix.
  const [snapshots, audits, techs, contacts, ads, serps, jobRows, failedRows] =
    await Promise.all([
      prisma.businessSnapshot.findMany({
        where: { businessId: { in: businessIds }, reviewCount: { not: null } },
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
      prisma.adLibraryEntry.findMany({
        where: { businessId: { in: businessIds } },
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
      // FAILED jobs → "failed" dot (distinct from never-run). Same batched shape.
      prisma.enrichmentJob.groupBy({
        by: ["businessId", "family"],
        where: {
          businessId: { in: businessIds },
          status: { in: [...FAILED_JOB_STATUSES] },
        },
      }),
    ]);

  const reviewSnapSet = new Set(snapshots.map((r) => r.businessId));
  const auditSet = new Set(audits.map((r) => r.businessId));
  const techSet = new Set(techs.map((r) => r.businessId));
  const contactSet = new Set(contacts.map((r) => r.businessId));
  const adsSet = new Set(ads.map((r) => r.businessId));
  const serpSet = new Set(serps.map((r) => r.businessId));

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

  return businesses.map((b) => {
    const coverage = deriveFamilyCoverage(
      {
        // Reviews also count when the Business scalar carries a reviewCount (the
        // drawer's `snapshot?.reviewCount ?? business.reviewCount` fallback).
        reviews: reviewSnapSet.has(b.id) || b.reviewCount != null,
        website: auditSet.has(b.id) || techSet.has(b.id),
        contacts: contactSet.has(b.id),
        ads: adsSet.has(b.id),
        search: serpSet.has(b.id),
      },
      doneJobs.get(b.id),
    );
    return {
      businessId: b.id,
      families: DATA_FAMILIES.filter((f) => coverage[f.key]).map((f) => f.key),
      failed: deriveFailedFamilies(coverage, failedJobs.get(b.id)),
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
