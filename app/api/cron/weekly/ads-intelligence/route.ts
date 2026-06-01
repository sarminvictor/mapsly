// Weekly · ads-intelligence (DataForSEO pass)
//
// Collects the "what ads cost" + "who's advertising on Google" layers for the
// SMB /ads page:
//   1. keyword costs (CPC / competition / bids) for each owned business's
//      service terms → Keyword (market-level · deduped per keyword+location)
//   2. Google Ads Transparency creatives for each owned business AND its
//      same-market competitors → AdLibraryEntry(platform=GOOGLE)
//
// DataForSEO Live calls are fast; bounded to a small target batch so the run
// stays well inside the function budget. Advances Business.adsScanLastAt (the
// freshness cursor the Meta cron follows). Meta runs in `weekly/ads-meta`.
//
// Cost scales with OWNED (paying-customer) businesses + their competitors, not
// the 2.1M catalog. ~$0.07–0.34/run at 5 targets.

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { collectAdsForBatch } from "@/modules/ads-intel/collect-ads-intel";
import { filterEligibleBusinesses } from "@/lib/reviews/should-collect";

export const maxDuration = 300;

const JOB = "weekly:ads-intelligence";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const STALE_DAYS = 7;

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  // Owned (SMB customer) businesses are the /ads page audience. Oldest-scanned
  // first so never-scanned businesses (null) lead.
  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      ownerUserId: { not: null },
      OR: [{ adsScanLastAt: null }, { adsScanLastAt: { lt: staleCutoff } }],
    },
    select: { id: true },
    take: limit,
    orderBy: { adsScanLastAt: { sort: "asc", nulls: "first" } },
  });

  if (candidates.length === 0) {
    return {
      itemsProcessed: 0,
      meta: { runId, candidates: 0, message: "no_eligible_businesses" },
    };
  }

  // Paid-cell gate · only collect for cells with a paid business (same gate as
  // reviews + search). No-op while MAPSLY_COLLECT_REVIEWS_ALLOW_ALL=1.
  const eligibleIds = await filterEligibleBusinesses(
    candidates.map((c) => c.id),
  );
  if (eligibleIds.length === 0) {
    return {
      itemsProcessed: 0,
      meta: {
        runId,
        candidates: candidates.length,
        message: "no_paid_cell_businesses",
      },
    };
  }

  const out = await collectAdsForBatch(eligibleIds, {
    dfs: true,
    meta: false,
  });

  return {
    itemsProcessed: out.businesses,
    status: out.errors.length > 0 ? ("PARTIAL" as const) : ("OK" as const),
    meta: {
      runId,
      candidates: candidates.length,
      keywordsUpserted: out.keywordsUpserted,
      errorSample: out.errors.slice(0, 5),
    },
  };
});

// Manual admin trigger (same schedule).
export const POST = GET;

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_ADS_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  STALE_DAYS,
  clampLimitFromEnv,
};
