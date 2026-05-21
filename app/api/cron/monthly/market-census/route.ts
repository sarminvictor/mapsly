// Monthly · market-census
//
// Deep re-scan of tracked markets to discover businesses the daily
// indexer missed (newly added to Google Maps, drifted-position records,
// churned listings). The daily indexer covers 5 anchors/day at radius 5km
// — a narrow slice. The monthly census widens the radius (10km) and
// lifts the per-query result cap so each (category, country, city)
// bucket gets one thorough sweep per month.
//
// Source: `services/dataforseo/maps-search` (Live tier · cached 24h ·
// `withCostCounter` enforced).
//
// Cadence: monthly day-1 08:00 UTC per `vercel.json`. Bounded to 50
// anchors per run by default — the census is budget-heavy (50 anchors ×
// $0.001/call ≈ $0.05 base, plus per-business inserts). MAX_ANCHOR_LIMIT
// 200 protects ad-hoc backfills via `?limit=N`.
//
// Reuses the daily indexer's `mapsRowToPersist` + `slugify` helpers so
// both routes always agree on Business shape + slug normalization. The
// only behavior diff is the census's wider radius + higher per-query
// result cap.

import { revalidateTag } from "next/cache";
import { Prisma } from "@/lib/prisma";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { mapsSearch } from "@/services/dataforseo";
import {
  mapsRowToPersist,
  slugify,
} from "../../daily/indexer-new-businesses/route";
import {
  resolveBatchLimit,
  runBatch,
  statusFromOutcome,
} from "../../_lib/batch";

const JOB = "monthly:market-census";
const DEFAULT_ANCHOR_LIMIT = 50;
const MAX_ANCHOR_LIMIT = 200;
/** Wider sweep than the daily indexer's 5km — month gives us room to
 *  cover larger markets without slicing across boroughs. */
const CENSUS_RADIUS_KM = 10;
const CENSUS_LIMIT_PER_QUERY = 200;

interface AnchorRow {
  category: string;
  country: string | null;
  city: string | null;
  centroidLat: number;
  centroidLng: number;
  representativeId: string;
}

export const GET = cronHandler(JOB, async (ctx) => {
  return await processMonthlyMarketCensus(undefined, ctx);
});

/**
 * Implementation entrypoint. Extracted so unit tests can invoke it
 * directly without going through the cron-secret + ALS plumbing in
 * `cronHandler`.
 */
export async function processMonthlyMarketCensus(
  req: Request | undefined,
  ctx: { runId: string; job: string },
) {
  const anchorLimit = req
    ? resolveBatchLimit(req, DEFAULT_ANCHOR_LIMIT, MAX_ANCHOR_LIMIT)
    : DEFAULT_ANCHOR_LIMIT;

  // Rotating anchors: one representative business per (category, city,
  // country) bucket, ordered by oldest census scan first.
  const anchors = (await prisma.$queryRaw<AnchorRow[]>(Prisma.sql`
    SELECT DISTINCT ON (b.category, b.city, b.country)
      b.category AS category,
      b.country AS country,
      b.city AS city,
      b.lat AS "centroidLat",
      b.lng AS "centroidLng",
      b.id AS "representativeId"
    FROM "Business" b
    WHERE b."isActive" = TRUE
      AND b.lat IS NOT NULL
      AND b.lng IS NOT NULL
      AND b.category IS NOT NULL AND b.category <> ''
    ORDER BY b.category, b.city, b.country, b."lastRefreshedAt" ASC NULLS FIRST
    LIMIT ${anchorLimit}
  `)) as AnchorRow[];

  let newBusinesses = 0;
  let alreadyIndexed = 0;
  let skippedNoIdentifier = 0;
  const revalidatedSlugs = new Set<string>();

  const outcome = await runBatch(anchors, async (anchor: AnchorRow) => {
    const coord = `${anchor.centroidLat.toFixed(6)},${anchor.centroidLng.toFixed(6)},${CENSUS_RADIUS_KM}`;
    const result = await mapsSearch({
      categories: [anchor.category],
      location_coordinate: coord,
      language_code: "en",
      limit: CENSUS_LIMIT_PER_QUERY,
    });

    for (const row of result.items) {
      const persistShape = mapsRowToPersist(row, anchor.country);
      if (!persistShape) {
        skippedNoIdentifier += 1;
        continue;
      }

      // Match by googleCid first (most reliable), then placeId.
      const existing = await prisma.business.findFirst({
        where: {
          OR: [
            persistShape.googleCid
              ? { googleCid: persistShape.googleCid }
              : { id: "__never__" },
            persistShape.googlePlaceId
              ? { googlePlaceId: persistShape.googlePlaceId }
              : { id: "__never__" },
          ],
        },
        select: { id: true, slug: true },
      });

      if (existing) {
        alreadyIndexed += 1;
        continue;
      }

      const slug = await mintUniqueSlug(persistShape.name);
      try {
        const created = await prisma.business.create({
          data: {
            ...persistShape,
            slug,
            firstSeenOnGoogle: new Date(),
            isActive: true,
          },
          select: { slug: true },
        });
        newBusinesses += 1;
        revalidatedSlugs.add(created.slug);
      } catch (err) {
        // Race condition on unique slug / cid — re-check + treat as known.
        const reRead = await prisma.business.findFirst({
          where: persistShape.googleCid
            ? { googleCid: persistShape.googleCid }
            : { slug },
          select: { id: true },
        });
        if (reRead) {
          alreadyIndexed += 1;
        } else {
          throw err;
        }
      }
    }
  });

  // Census discovered new rows → revalidate the sitemap + per-business
  // tags so SEO surfaces (B.5) reflect the expanded index promptly.
  if (newBusinesses > 0) revalidateTag("seo-sitemap", "days");
  for (const slug of revalidatedSlugs) {
    revalidateTag(`business-${slug}`, "weeks");
  }

  return {
    itemsProcessed: outcome.succeeded,
    status: statusFromOutcome(outcome),
    meta: {
      runId: ctx.runId,
      anchorLimit,
      attempted: outcome.attempted,
      succeeded: outcome.succeeded,
      failed: outcome.failures.length,
      newBusinesses,
      alreadyIndexed,
      skippedNoIdentifier,
      radiusKm: CENSUS_RADIUS_KM,
      perQueryLimit: CENSUS_LIMIT_PER_QUERY,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        category: (f.item as AnchorRow).category,
        city: (f.item as AnchorRow).city,
        error: f.error,
      })),
    },
  };
}

/**
 * Mint a slug that's unique against the Business table, falling back to
 * a short random suffix if the base + 10 numeric variants are all taken.
 * Mirrors the daily indexer's helper so the two routes never disagree on
 * shape — kept local here because the indexer's helper is module-private.
 */
async function mintUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "business";
  for (let i = 0; i < 10; i += 1) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.business.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!taken) return slug;
  }
  const tail = Math.random().toString(36).slice(2, 8);
  return `${base}-${tail}`;
}

export const __test = {
  JOB,
  DEFAULT_ANCHOR_LIMIT,
  MAX_ANCHOR_LIMIT,
  CENSUS_RADIUS_KM,
  CENSUS_LIMIT_PER_QUERY,
  processMonthlyMarketCensus,
  mintUniqueSlug,
};
