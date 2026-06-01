// Weekly · ads-meta (Apify Meta Ad Library pass)
//
// Collects the "who's advertising on Facebook/Instagram" layer for the SMB
// /ads page via our OWN published Apify actor (mapsly-meta-ad-library). Runs
// as its own cron because one Apify run takes ~2–3 min (start + poll) — kept
// separate from the fast DataForSEO pass so neither exceeds the function
// budget.
//
// Follows the DataForSEO cursor: selects owned businesses that the
// `ads-intelligence` cron has already scanned (adsScanLastAt set), freshest
// first, and does NOT advance the cursor (so the DfS cron keeps refreshing on
// its own 7-day cadence). The collector groups the candidate(s) into (category,
// city, country) MARKET CELLS and runs ONE service+city Ad Library search per
// cell (collect-cell-meta) — shared across every business in the cell.

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { collectAdsForBatch } from "@/modules/ads-intel/collect-ads-intel";
import { filterEligibleBusinesses } from "@/lib/reviews/should-collect";

export const maxDuration = 300;

const JOB = "weekly:ads-meta";
// One owned business per run → its market CELL (collectAdsForBatch caps inline
// cells at MAX_CELLS_PER_RUN=1, ~2-3 min Apify). The weekly schedule cycles
// businesses (and thus cells) over time; cell-dedup means no cell runs twice.
const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 3;

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);

  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      ownerUserId: { not: null },
      adsScanLastAt: { not: null },
    },
    select: { id: true },
    take: limit,
    orderBy: { adsScanLastAt: "desc" },
  });

  if (candidates.length === 0) {
    return {
      itemsProcessed: 0,
      meta: { runId, candidates: 0, message: "no_dfs_scanned_businesses_yet" },
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
    dfs: false,
    meta: true,
  });

  return {
    itemsProcessed: out.businesses,
    status: out.errors.length > 0 ? ("PARTIAL" as const) : ("OK" as const),
    meta: {
      runId,
      candidates: candidates.length,
      metaAds: out.metaAds,
      metaRunUsd: out.metaRunUsd,
      errorSample: out.errors.slice(0, 5),
    },
  };
});

export const POST = GET;

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_ADS_META_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = { JOB, DEFAULT_LIMIT, MAX_LIMIT, clampLimitFromEnv };
