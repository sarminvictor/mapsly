// Weekly · competitor-diff
//
// For each tracked market — defined as a (category, city, country)
// triple with at least one active business — pull the latest Maps
// category search around the market centroid and diff against the prior
// week's snapshot. Flag entrants (businesses present this week but not
// last week) and exits (present last week, absent this week).
//
// This is the "a new competitor moved into your zip code" signal that
// powers SMB competitor alerts (E.3) and the agency's "moats" filter.
// Anchored to a tracked market — records a per-market entrant/exit count.
// New rows enter our Business index via the admin-triggered discovery
// path (modules/business-discovery), not via this handler.
//
// Source: `services/dataforseo/maps-search` (Live tier, cached 24h).
// Cadence: weekly Monday 13:00 UTC per `vercel.json`. Bounded to 25
// markets per run.

import { revalidateTag } from "next/cache";
import prisma, { Prisma } from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { mapsSearch } from "@/services/dataforseo";
import { runBatch, statusFromOutcome } from "../../_lib/batch";

const JOB = "weekly:competitor-diff";
const DEFAULT_MARKET_LIMIT = 25;
const MAX_MARKET_LIMIT = 100;
const SEARCH_RADIUS_KM = 5;
const SEARCH_LIMIT = 100;
const LOOKBACK_DAYS = 8;

interface MarketAnchor {
  category: string;
  city: string;
  country: string | null;
  centroidLat: number;
  centroidLng: number;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const marketLimit = clampLimitFromEnv(DEFAULT_MARKET_LIMIT, MAX_MARKET_LIMIT);

  const anchors = (await prisma.$queryRaw<MarketAnchor[]>(Prisma.sql`
    SELECT DISTINCT ON (b.category, b.city, b.country)
      b.category AS category,
      b.city AS city,
      b.country AS country,
      b.lat AS "centroidLat",
      b.lng AS "centroidLng"
    FROM "Business" b
    WHERE b."isActive" = TRUE
      AND b.lat IS NOT NULL
      AND b.lng IS NOT NULL
      AND b.category IS NOT NULL AND b.category <> ''
      AND b.city IS NOT NULL AND b.city <> ''
    ORDER BY b.category, b.city, b.country, b."lastRefreshedAt" ASC NULLS FIRST
    LIMIT ${marketLimit}
  `)) as MarketAnchor[];

  const lookbackCutoff = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  let totalEntrants = 0;
  let totalExits = 0;

  const outcome = await runBatch(anchors, async (anchor: MarketAnchor) => {
    const coord = `${anchor.centroidLat.toFixed(6)},${anchor.centroidLng.toFixed(6)},${SEARCH_RADIUS_KM}`;
    const result = await mapsSearch({
      categories: [anchor.category],
      location_coordinate: coord,
      language_code: "en",
      limit: SEARCH_LIMIT,
    });

    const currentCids = new Set<string>();
    for (const row of result.items) {
      const cid =
        typeof row.cid === "string" && row.cid.length > 0 ? row.cid : null;
      if (cid) currentCids.add(cid);
    }

    // Look up which of these CIDs were ALREADY in our index a week ago.
    const prior = await prisma.business.findMany({
      where: {
        category: anchor.category,
        city: anchor.city,
        country: anchor.country,
        isActive: true,
        firstSeenOnGoogle: { lt: lookbackCutoff },
        googleCid: { in: Array.from(currentCids) },
      },
      select: { googleCid: true },
    });
    const priorCids = new Set(
      prior
        .map((b) => b.googleCid)
        .filter((c): c is string => typeof c === "string"),
    );

    // Entrants: in current scan but not in prior set (lookbackCutoff-aged).
    let entrants = 0;
    for (const cid of currentCids) {
      if (!priorCids.has(cid)) entrants += 1;
    }

    // Exits: businesses we track in this market but that aren't in the
    // current Maps scan (within radius). Bounded to limit DB scan.
    const tracked = await prisma.business.findMany({
      where: {
        category: anchor.category,
        city: anchor.city,
        country: anchor.country,
        isActive: true,
        googleCid: { not: null },
      },
      select: { id: true, googleCid: true },
      take: 200,
    });
    let exits = 0;
    for (const t of tracked) {
      if (t.googleCid && !currentCids.has(t.googleCid)) exits += 1;
    }

    totalEntrants += entrants;
    totalExits += exits;

    revalidateTag(`competitor-diff-${anchor.category}-${anchor.city}`, "weeks");
  });

  return {
    itemsProcessed: outcome.succeeded,
    status: statusFromOutcome(outcome),
    meta: {
      runId,
      marketLimit,
      attempted: outcome.attempted,
      succeeded: outcome.succeeded,
      failed: outcome.failures.length,
      totalEntrants,
      totalExits,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        market: `${(f.item as MarketAnchor).category}/${(f.item as MarketAnchor).city}`,
        error: f.error,
      })),
    },
  };
});

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_MARKET_LIMIT,
  MAX_MARKET_LIMIT,
  SEARCH_RADIUS_KM,
  SEARCH_LIMIT,
  LOOKBACK_DAYS,
  clampLimitFromEnv,
};
