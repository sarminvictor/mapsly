// Daily · ad-library-diff
//
// Pull Meta Ad Library entries for every tracked business and reconcile
// against `AdLibraryEntry` rows in our DB:
//
//   - New ad seen → insert AdLibraryEntry (firstSeenAt = now, isActive)
//   - Already-known ad seen → bump lastSeenAt (heartbeat)
//   - Known ad NOT seen this run → mark isActive=false + set endedAt
//
// Source: `services/meta-ad-library/ads-archive` — Meta's `ads_archive`
// Graph API endpoint. Free per call (unit cost $0) but still cost-tracked.
//
// Cadence: daily 11:15 UTC per `vercel.json`. Bounded to 50 businesses per
// run; each business may have N pages of ads which the adapter handles
// internally with a `MAX_RESULTS_PER_QUERY` ceiling.

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { adsArchiveSearch, parseBand } from "@/services/meta-ad-library";
import type { AdsArchiveRow } from "@/services/meta-ad-library";
import { runBatch, statusFromOutcome } from "../_lib/batch";

const JOB = "daily:ad-library-diff";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface BusinessRow {
  id: string;
  slug: string;
  name: string;
  country: string | null;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);

  // Prefer claimed/owned businesses first — those are the paying customers.
  // Within that, oldest lastRefreshedAt wins to round-robin coverage.
  const candidates = await prisma.business.findMany({
    where: { isActive: true, name: { not: "" } },
    select: { id: true, slug: true, name: true, country: true },
    take: limit,
    orderBy: [
      { isClaimed: "desc" },
      { lastRefreshedAt: { sort: "asc", nulls: "first" } },
    ],
  });

  const revalidatedSlugs = new Set<string>();
  let newAds = 0;
  let endedAds = 0;
  let bumpedAds = 0;

  const outcome = await runBatch(candidates, async (biz: BusinessRow) => {
    const country = biz.country ?? "US";
    const result = await adsArchiveSearch({
      search_terms: biz.name,
      ad_active_status: "ALL",
      ad_reached_countries: [country.toUpperCase().slice(0, 2)],
      limit: 100,
    });

    const seenExternalIds = new Set<string>();
    for (const row of result.rows) {
      seenExternalIds.add(row.id);
    }

    // Snapshot current known ads for this business — needed for the "ended"
    // sweep below. Select only the columns we read.
    const knownAds = await prisma.adLibraryEntry.findMany({
      where: { businessId: biz.id, platform: "META" },
      select: { externalAdId: true, isActive: true },
    });
    const knownById = new Map(knownAds.map((a) => [a.externalAdId, a]));

    // Upsert each Meta-returned ad. `externalAdId` is globally unique → use
    // upsert + filter by businessId for the heartbeat / new-row split.
    for (const row of result.rows) {
      const data = adRowToPersist(row, biz.id);
      const known = knownById.get(row.id);
      if (known) {
        // Heartbeat — bump lastSeenAt, re-activate if it had ended.
        await prisma.adLibraryEntry.update({
          where: { externalAdId: row.id },
          data: {
            ...data,
            lastSeenAt: new Date(),
            ...(known.isActive ? {} : { isActive: true, endedAt: null }),
          },
        });
        bumpedAds += 1;
      } else {
        // Brand-new ad: insert.
        await prisma.adLibraryEntry.create({
          data: {
            ...data,
            externalAdId: row.id,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            isActive: true,
          },
        });
        newAds += 1;
      }
    }

    // Sweep ads we previously knew about but didn't see this run → mark
    // inactive. Use updateMany so a single SQL hits all stale rows.
    const knownIds = knownAds
      .filter((a) => a.isActive && !seenExternalIds.has(a.externalAdId))
      .map((a) => a.externalAdId);
    if (knownIds.length > 0) {
      const upd = await prisma.adLibraryEntry.updateMany({
        where: { externalAdId: { in: knownIds } },
        data: { isActive: false, endedAt: new Date() },
      });
      endedAds += upd.count;
    }

    revalidatedSlugs.add(biz.slug);
  });

  for (const slug of revalidatedSlugs) {
    revalidateTag(`business-${slug}`, "hours");
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
      newAds,
      endedAds,
      bumpedAds,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        businessId: (f.item as BusinessRow).id,
        error: f.error,
      })),
    },
  };
});

/**
 * Translate a Meta `AdsArchiveRow` to the AdLibraryEntry write shape.
 *
 * Banded estimates (`spend.lower_bound`, `impressions.lower_bound`) come
 * back as strings — pass through `parseBand` for the midpoint. Returns
 * `null` when Meta omitted the field, which Prisma treats as "leave the
 * column as-is" on update / "null" on create — both correct.
 */
function adRowToPersist(
  row: AdsArchiveRow,
  businessId: string,
): {
  businessId: string;
  platform: "META";
  adCreativeBody: string | null;
  landingUrl: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  impressionsMid: number | null;
  spendMidLow: number | null;
  spendMidHigh: number | null;
} {
  const startedAt = parseIsoOrNull(row.ad_delivery_start_time);
  const endedAt = parseIsoOrNull(row.ad_delivery_stop_time);
  const impressions = bandMidpoint(row.impressions);
  const spendLow = bandLower(row.spend);
  const spendHigh = bandUpper(row.spend);

  const creativeBody =
    Array.isArray(row.ad_creative_bodies) && row.ad_creative_bodies.length > 0
      ? (row.ad_creative_bodies[0] ?? null)
      : null;

  const landingUrl =
    Array.isArray(row.ad_creative_link_captions) &&
    row.ad_creative_link_captions.length > 0
      ? (row.ad_creative_link_captions[0] ?? null)
      : (row.ad_snapshot_url ?? null);

  return {
    businessId,
    platform: "META",
    adCreativeBody: creativeBody,
    landingUrl,
    startedAt,
    endedAt,
    impressionsMid: impressions,
    spendMidLow: spendLow,
    spendMidHigh: spendHigh,
  };
}

function parseIsoOrNull(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function bandMidpoint(
  band: { lower_bound?: string; upper_bound?: string } | undefined,
): number | null {
  const parsed = parseBand(band);
  return parsed ? Math.round(parsed.mid) : null;
}

function bandLower(
  band: { lower_bound?: string; upper_bound?: string } | undefined,
): number | null {
  const parsed = parseBand(band);
  return parsed ? parsed.low : null;
}

function bandUpper(
  band: { lower_bound?: string; upper_bound?: string } | undefined,
): number | null {
  const parsed = parseBand(band);
  return parsed ? parsed.high : null;
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
  DEFAULT_LIMIT,
  MAX_LIMIT,
  adRowToPersist,
  parseIsoOrNull,
  bandMidpoint,
  bandLower,
  bandUpper,
  clampLimitFromEnv,
};
