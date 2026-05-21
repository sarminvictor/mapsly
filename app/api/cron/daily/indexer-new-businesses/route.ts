// Daily · indexer-new-businesses
//
// Discover new businesses entering tracked markets. The seed set of
// (category, lat, lng) "anchors" comes from the existing Business index —
// every distinct (category, city, country) combination with at least one
// active business defines a tracked market. For each anchor we run a Maps
// category search and insert any business not already in our index.
//
// Source: `services/dataforseo/maps-search` (Live tier, cached 24h).
// Cadence: daily 12:30 UTC per `vercel.json`. Bounded to 5 anchors per run
// — the indexer is exploratory; running it across every market every day
// would dwarf the daily budget. Anchors rotate via lastRefreshedAt asc.

import { revalidateTag } from "next/cache";
import { Prisma } from "@/lib/prisma";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { mapsSearch } from "@/services/dataforseo";
import type { MapsBusinessRow } from "@/services/dataforseo";
import { runBatch, statusFromOutcome } from "../_lib/batch";

const JOB = "daily:indexer-new-businesses";
const DEFAULT_ANCHOR_LIMIT = 5;
const MAX_ANCHOR_LIMIT = 25;
const ANCHOR_RADIUS_KM = 5;
const ANCHOR_LIMIT_PER_QUERY = 100;

interface AnchorRow {
  category: string;
  country: string | null;
  centroidLat: number;
  centroidLng: number;
  representativeId: string;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const anchorLimit = clampLimitFromEnv(DEFAULT_ANCHOR_LIMIT, MAX_ANCHOR_LIMIT);

  // Pick rotating anchors: one representative business per (category, city,
  // country) bucket, ordered by oldest indexer scan. Each anchor's lat/lng
  // becomes the search centroid.
  //
  // Selecting via $queryRaw lets us GROUP BY (category, city, country) and
  // pick the freshest-lat/lng row from each bucket in one query, instead of
  // findMany'ing every business and de-duping in Node.
  const anchors = (await prisma.$queryRaw<
    Array<{
      category: string;
      country: string | null;
      centroidLat: number;
      centroidLng: number;
      representativeId: string;
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON (b.category, b.city, b.country)
      b.category AS category,
      b.country AS country,
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

  const outcome = await runBatch(anchors, async (anchor: AnchorRow) => {
    const coord = `${anchor.centroidLat.toFixed(6)},${anchor.centroidLng.toFixed(6)},${ANCHOR_RADIUS_KM}`;
    const result = await mapsSearch({
      categories: [anchor.category],
      location_coordinate: coord,
      language_code: "en",
      limit: ANCHOR_LIMIT_PER_QUERY,
    });

    for (const row of result.items) {
      const persistShape = mapsRowToPersist(row, anchor.country);
      if (!persistShape) continue;

      // Match by googleCid first (most reliable), then placeId. Slug is our
      // own URL-safe identifier; we mint it if neither match returns.
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
        select: { id: true },
      });
      if (existing) {
        alreadyIndexed += 1;
        continue;
      }

      const slug = await mintUniqueSlug(persistShape.name);
      try {
        await prisma.business.create({
          data: {
            ...persistShape,
            slug,
            firstSeenOnGoogle: new Date(),
            isActive: true,
          },
        });
        newBusinesses += 1;
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

  // Coarse revalidate — a new business landed in market X, refresh market X
  // listings + the global indexer aggregate.
  for (const anchor of anchors) {
    revalidateTag(
      `indexer-${anchor.category}-${anchor.country ?? "US"}`,
      "days",
    );
  }
  if (newBusinesses > 0) {
    revalidateTag("seo-sitemap", "days");
  }

  return {
    itemsProcessed: outcome.succeeded,
    status: statusFromOutcome(outcome),
    meta: {
      runId,
      anchorLimit,
      attempted: outcome.attempted,
      succeeded: outcome.succeeded,
      failed: outcome.failures.length,
      newBusinesses,
      alreadyIndexed,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        category: (f.item as AnchorRow).category,
        country: (f.item as AnchorRow).country,
        error: f.error,
      })),
    },
  };
});

/**
 * Map a DataForSEO Maps row → Business insert shape. Returns null when the
 * minimum identity (name + either cid or placeId) is missing.
 */
export function mapsRowToPersist(
  row: MapsBusinessRow,
  fallbackCountry: string | null,
): {
  name: string;
  category: string;
  googleCid: string | null;
  googlePlaceId: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  postalCode: string | null;
  phone: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  isClaimed: boolean;
  categories: string[];
} | null {
  const name = row.title ?? null;
  if (!name) return null;
  const cid = row.cid ?? null;
  const placeId = row.place_id ?? null;
  if (!cid && !placeId) return null;

  return {
    name,
    category: row.category ?? "uncategorized",
    googleCid: cid,
    googlePlaceId: placeId,
    address: row.address ?? row.address_info?.address ?? null,
    city: row.address_info?.city ?? null,
    province: row.address_info?.region ?? null,
    country: (row.address_info?.country_code ?? fallbackCountry ?? "US")
      .toUpperCase()
      .slice(0, 3),
    postalCode: row.address_info?.zip ?? null,
    phone: row.phone ?? null,
    website: row.url ?? null,
    lat: typeof row.latitude === "number" ? row.latitude : null,
    lng: typeof row.longitude === "number" ? row.longitude : null,
    rating: row.rating?.value ?? null,
    reviewCount: row.rating?.votes_count ?? null,
    isClaimed: row.is_claimed === true,
    categories:
      Array.isArray(row.additional_categories) &&
      row.additional_categories.length
        ? row.additional_categories.slice(0, 10)
        : [],
  };
}

/**
 * Slugify a business name into a unique slug. We don't lock the slug
 * column at the DB layer to avoid a unique-violation retry loop;
 * instead, we probe up to 10 suffixes (`-2` … `-10`) before falling back
 * to a 6-char random tail. 10 suffixes is enough for almost any
 * realistic name collision; the fallback ensures we never block on this.
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
  // Final fallback: short random suffix
  const tail = Math.random().toString(36).slice(2, 8);
  return `${base}-${tail}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_DAILY_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_ANCHOR_LIMIT,
  MAX_ANCHOR_LIMIT,
  ANCHOR_RADIUS_KM,
  ANCHOR_LIMIT_PER_QUERY,
  mapsRowToPersist,
  slugify,
  clampLimitFromEnv,
};
