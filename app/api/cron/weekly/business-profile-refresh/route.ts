// Weekly · business-profile-refresh
//
// Heaviest of the weekly cadence in terms of row count: re-pull Maps data
// for active businesses to refresh their canonical profile fields
// (rating, reviewCount, photosCount, hours, address, phone, website,
// claimed-status). Per `docs/data-cadence.md`, weekly handlers re-anchor
// the profile state that daily deltas (`new-reviews-delta`,
// `brand-hijack-scan`) drift on top of.
//
// Source: `services/dataforseo/maps-search` (Live tier, cached 24h). We
// re-run the same category search around each business's recorded lat/lng
// and match the returned row by `cid` (preferred) or `place_id` (fallback).
//
// Cadence: weekly Monday 11:00 UTC per `vercel.json`. Bounded to 30
// businesses per run — the 2.1M-business catalog isn't yet realized, but
// the cap protects against runaway invocations on a backfilled dataset.
// Rotation is by `lastRefreshedAt asc nulls first` so freshly-indexed
// businesses get the first refresh pass.

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { mapsSearch } from "@/services/dataforseo";
import type { MapsBusinessRow } from "@/services/dataforseo";
import { runBatch, statusFromOutcome } from "../../_lib/batch";

const JOB = "weekly:business-profile-refresh";
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 150;
const SEARCH_RADIUS_KM = 5;
const SEARCH_DEPTH = 50;
/** Skip businesses re-pulled within this window — protects against
 *  manual retries on the same day. */
const REFRESH_FRESH_MS = 5 * 24 * 60 * 60 * 1000;

interface BusinessRow {
  id: string;
  slug: string;
  category: string;
  googleCid: string | null;
  googlePlaceId: string | null;
  country: string | null;
  lat: number;
  lng: number;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);
  const cutoff = new Date(Date.now() - REFRESH_FRESH_MS);

  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      lat: { not: null },
      lng: { not: null },
      category: { not: "" },
      OR: [
        { lastRefreshedAt: null },
        { lastRefreshedAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      slug: true,
      category: true,
      googleCid: true,
      googlePlaceId: true,
      country: true,
      lat: true,
      lng: true,
    },
    take: limit,
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
  });

  const rows: BusinessRow[] = candidates
    .filter(
      (c): c is BusinessRow =>
        typeof c.lat === "number" &&
        typeof c.lng === "number" &&
        typeof c.category === "string" &&
        c.category.length > 0,
    )
    .map((c) => ({ ...c, lat: c.lat as number, lng: c.lng as number }));

  const revalidatedSlugs = new Set<string>();
  let updatedCount = 0;
  let notFoundCount = 0;

  const outcome = await runBatch(rows, async (biz: BusinessRow) => {
    const coord = `${biz.lat.toFixed(6)},${biz.lng.toFixed(6)},${SEARCH_RADIUS_KM}`;
    const result = await mapsSearch({
      categories: [biz.category],
      location_coordinate: coord,
      language_code: "en",
      limit: SEARCH_DEPTH,
    });

    const match = pickMatch(result.items, biz);
    if (!match) {
      notFoundCount += 1;
      // Even when no match — stamp lastRefreshedAt so we don't keep
      // re-pulling the same out-of-bounds business every weekly run.
      await prisma.business.update({
        where: { id: biz.id },
        data: { lastRefreshedAt: new Date() },
      });
      return;
    }

    const updates = mapsRowToProfileUpdate(match);
    if (Object.keys(updates).length === 0) {
      await prisma.business.update({
        where: { id: biz.id },
        data: { lastRefreshedAt: new Date() },
      });
      return;
    }

    await prisma.business.update({
      where: { id: biz.id },
      data: {
        ...updates,
        lastRefreshedAt: new Date(),
      },
    });

    updatedCount += 1;
    revalidatedSlugs.add(biz.slug);
  });

  for (const slug of revalidatedSlugs) {
    revalidateTag(`business-${slug}`, "weeks");
  }

  return {
    itemsProcessed: outcome.succeeded,
    status: statusFromOutcome(outcome),
    meta: {
      runId,
      limit,
      attempted: outcome.attempted,
      succeeded: outcome.succeeded,
      failed: outcome.failures.length,
      updatedCount,
      notFoundCount,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        businessId: (f.item as BusinessRow).id,
        error: f.error,
      })),
    },
  };
});

/**
 * Find the Maps row that corresponds to `biz`. Match by cid first (exact),
 * then place_id, then by name+phone fuzzy as a last resort. Returns null
 * if no confident match in the returned set — caller stamps refresh
 * timestamp so we don't thrash on businesses that drifted out of the
 * 5km radius (closed, moved, renamed).
 */
export function pickMatch(
  items: readonly MapsBusinessRow[],
  biz: { googleCid: string | null; googlePlaceId: string | null },
): MapsBusinessRow | null {
  if (biz.googleCid) {
    const m = items.find((i) => i.cid === biz.googleCid);
    if (m) return m;
  }
  if (biz.googlePlaceId) {
    const m = items.find((i) => i.place_id === biz.googlePlaceId);
    if (m) return m;
  }
  return null;
}

/**
 * Convert a fresh Maps row into a partial Business update. Only includes
 * fields the row actually carries — never overwrites a populated DB
 * column with a null we got from a partial response.
 */
export function mapsRowToProfileUpdate(row: MapsBusinessRow): {
  rating?: number;
  reviewCount?: number;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  isClaimed?: boolean;
  categories?: string[];
} {
  const out: ReturnType<typeof mapsRowToProfileUpdate> = {};
  if (typeof row.rating?.value === "number") out.rating = row.rating.value;
  if (typeof row.rating?.votes_count === "number")
    out.reviewCount = row.rating.votes_count;
  if (typeof row.phone === "string" && row.phone.length > 0)
    out.phone = row.phone;
  if (typeof row.url === "string" && row.url.length > 0) out.website = row.url;
  const address = row.address ?? row.address_info?.address;
  if (typeof address === "string" && address.length > 0) out.address = address;
  if (typeof row.address_info?.city === "string")
    out.city = row.address_info.city;
  if (typeof row.address_info?.region === "string")
    out.province = row.address_info.region;
  if (typeof row.address_info?.zip === "string")
    out.postalCode = row.address_info.zip;
  if (typeof row.is_claimed === "boolean") out.isClaimed = row.is_claimed;
  if (
    Array.isArray(row.additional_categories) &&
    row.additional_categories.length > 0
  ) {
    out.categories = row.additional_categories.slice(0, 10);
  }
  return out;
}

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SEARCH_RADIUS_KM,
  SEARCH_DEPTH,
  REFRESH_FRESH_MS,
  pickMatch,
  mapsRowToProfileUpdate,
  clampLimitFromEnv,
};
