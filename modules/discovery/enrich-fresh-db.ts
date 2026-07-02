// modules/discovery/enrich-fresh-db.ts · DB-backed glue for per-enrichment
// freshness dedup (Phase 9). Reads the per-business `*LastAt` columns + latest
// LighthouseAudit + per-cell AdMarketRun.ranAt, then defers ALL counting to the
// pure `countFresh` in enrich-fresh.ts (so the math stays unit-testable).
//
// This is the impure half: select-only reads, scoped to the run's businesses +
// cells. No external API, no writes. Safe in the pre-flight (server action) path
// because it touches only the DB.

import prisma, { Prisma } from "@/lib/prisma";
import type { EnrichmentType } from "@/modules/cost/pricing";

import {
  countFresh,
  type FreshByEnrichment,
  type FreshTimestamps,
} from "./enrich-fresh";

/** Map a per-cell family to its AdMarketRun platform marker. */
const CELL_PLATFORM: Partial<Record<EnrichmentType, string>> = {
  meta_ads: "META",
  google_ads: "GOOGLE",
  serp: "SERP",
};

/**
 * Load the last-enriched timestamps for every (unit × family) in scope.
 *
 * Per-business families read the denormalized cursors on Business; lighthouse
 * reads the newest LighthouseAudit per business. Per-cell families read the
 * newest OK/PARTIAL AdMarketRun per (cellKey, platform). Families with no
 * freshness source (services, ai_research) are simply absent → never fresh.
 */
export async function loadFreshTimestamps(
  businessIds: readonly string[],
  cellKeys: readonly string[],
): Promise<FreshTimestamps> {
  const perBusiness: FreshTimestamps["perBusiness"] = new Map();
  const perCell: FreshTimestamps["perCell"] = new Map();

  // ── Per-business cursors (contacts / tech / reviews) + latest lighthouse ──
  if (businessIds.length > 0) {
    const rows = await prisma.business.findMany({
      where: { id: { in: [...businessIds] } },
      select: {
        id: true,
        contactsExtractedAt: true,
        techScanLastAt: true,
        reviewsLastDeltaAt: true,
        lighthouseAudits: {
          take: 1,
          orderBy: { auditedAt: "desc" },
          select: { auditedAt: true },
        },
      },
    });
    for (const b of rows) {
      perBusiness.set(b.id, {
        contacts: b.contactsExtractedAt,
        tech: b.techScanLastAt,
        reviews: b.reviewsLastDeltaAt,
        lighthouse: b.lighthouseAudits[0]?.auditedAt ?? null,
      });
    }
  }

  // ── Per-cell runs (meta_ads / google_ads / serp) ──
  if (cellKeys.length > 0) {
    const platforms = Object.values(CELL_PLATFORM);
    // WP9-3 · DISTINCT ON returns exactly ONE row per (cellKey, platform) — the
    // newest OK/PARTIAL run — instead of the cell's ENTIRE run history (the old
    // unbounded findMany grew O(runs) per cell). platform is cast to text for
    // Neon-adapter deserialization safety.
    const runs = await prisma.$queryRaw<
      { cellKey: string; platform: string; ranAt: Date }[]
    >(Prisma.sql`
      SELECT DISTINCT ON ("cellKey", "platform")
        "cellKey", "platform"::text AS platform, "ranAt"
      FROM "AdMarketRun"
      WHERE "cellKey" IN (${Prisma.join([...cellKeys])})
        AND "platform"::text IN (${Prisma.join(platforms)})
        AND "status" IN ('OK', 'PARTIAL')
      ORDER BY "cellKey", "platform", "ranAt" DESC
    `);
    const platformToFamily: Record<string, EnrichmentType> = {
      META: "meta_ads",
      GOOGLE: "google_ads",
      SERP: "serp",
    };
    for (const r of runs) {
      const family = platformToFamily[r.platform];
      if (!family) continue;
      const existing = perCell.get(r.cellKey) ?? {};
      if (existing[family] == null) {
        existing[family] = r.ranAt;
        perCell.set(r.cellKey, existing);
      }
    }
  }

  return { perBusiness, perCell };
}

/**
 * End-to-end fresh-count for a run: load timestamps, then count via the pure
 * helper. Returns a `{ family → freshCount }` map ready to pass into
 * `buildEnrichLines({ freshByEnrichment })`.
 */
export async function countFreshForRun(input: {
  enrichments: readonly EnrichmentType[];
  businessIds: readonly string[];
  cellKeys: readonly string[];
  now?: Date;
}): Promise<FreshByEnrichment> {
  const now = input.now ?? new Date();
  try {
    const timestamps = await loadFreshTimestamps(
      input.businessIds,
      input.cellKeys,
    );
    return countFresh({
      enrichments: input.enrichments,
      businessIds: input.businessIds,
      cellKeys: input.cellKeys,
      timestamps,
      now,
    });
  } catch (err) {
    // A freshness-read hiccup must NEVER break the quote — degrade to
    // "nothing fresh" (the run is billed in full, never under-charged).
    console.warn(
      `[enrich-fresh] freshness read failed; treating all units as billable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {} as FreshByEnrichment;
  }
}
