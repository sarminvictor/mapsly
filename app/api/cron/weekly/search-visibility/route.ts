// Weekly · search-visibility
//
// Replaces the legacy weekly:serp-rank-scan cron (which scanned the
// global Keyword table · 0 keywords in prod for the entire history).
// This one is per-business via BusinessKeyword, paid-cell gated, and
// fan-outs through the Boxly Worker so the cron tick stays cheap.
//
// Pipeline (S.1 plan v2):
//   1. Pick businesses where searchScanLastAt < now-7d OR null
//      (oldest-first so the freshest data wins on quota-bounded runs)
//   2. Hand off to dispatchSearchScan({ mode: "cron" }):
//      a. paid-cell gate · skip cells without a paid account
//      b. enqueue 1 biz-discovery Worker job per eligible business
//      c. enqueue 1 cell-aggregate Worker job per UNIQUE cell
//         (the optimization Viktor asked for · never duplicate per
//         business in the cell)
//   3. Return immediately · Worker callbacks land within 1–3 min
//
// Cost: scales with paid cells, not total catalog. Calgary (1 cell ·
// 25 paid businesses) ≈ $0.385/week. At 10 paid cells ≈ $14/mo. The
// 75-keyword cap on the legacy cron is irrelevant here because
// ranked_keywords returns a domain's full keyword portfolio in one
// call.

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { dispatchSearchScan } from "@/modules/search-visibility/dispatch-bulk-scan";

const JOB = "weekly:search-visibility";
const DEFAULT_LIMIT = 500; // matches Boxly Worker batch max
const MAX_LIMIT = 500;
const STALE_DAYS = 7;

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  // 1. Candidate selection · cheap WHERE on indexed columns.
  //    isActive + website (ranked_keywords needs a domain) + stale scan.
  //    Order oldest-first so businesses that NEVER ran (null) come first.
  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      website: { not: null },
      OR: [
        { searchScanLastAt: null },
        { searchScanLastAt: { lt: staleCutoff } },
      ],
    },
    select: { id: true },
    take: limit,
    orderBy: { searchScanLastAt: { sort: "asc", nulls: "first" } },
  });

  if (candidates.length === 0) {
    return {
      itemsProcessed: 0,
      meta: { runId, candidates: 0, message: "no_eligible_businesses" },
    };
  }

  // 2. Hand off · the dispatcher applies the paid-cell gate, groups by
  //    (city, country), and enqueues N biz + M cell jobs.
  const dispatch = await dispatchSearchScan({
    businessIds: candidates.map((c) => c.id),
    mode: "cron",
  });

  return {
    itemsProcessed: dispatch.queuedOrTriggered,
    meta: {
      runId,
      candidatesFound: candidates.length,
      eligibleAfterGate: dispatch.eligibleBusinesses,
      filteredOutByGate: candidates.length - dispatch.eligibleBusinesses,
      strategy: dispatch.strategy,
      queuedOrTriggered: dispatch.queuedOrTriggered,
      failedOrSkipped: dispatch.failedOrSkipped,
      cellsAggregated: dispatch.cellsAggregated,
      ...(dispatch.taskIdSample ? { taskIdSample: dispatch.taskIdSample } : {}),
    },
  };
});

// Allow manual trigger via POST (admin tool) without changing the schedule.
export const POST = GET;

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_SEARCH_LIMIT;
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
