// Monthly · keyword-volume-refresh
//
// Refresh `Keyword.searchVolume / cpc / competition / competitionIndex /
// refreshedAt` for the agency Hunter signal registry. Google Ads' Search
// Volume endpoint reports the trailing 12-month average; running it more
// than monthly burns budget for no insight. The endpoint accepts up to
// 1000 keywords per call at a flat $0.05 — batching is essential.
//
// Source: `services/dataforseo/keyword-volume` (Live tier · cached 7d ·
// `withCostCounter` enforced).
//
// Cadence: monthly on day-1 07:00 UTC per `vercel.json`. A single run
// covers up to MAX_LIMIT stale rows split into batches per (locationCode,
// language). Larger backfills can pass `?limit=N` (capped at MAX_LIMIT);
// per-call price is flat $0.05 so cost scales with batches, not rows.

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { keywordVolume, type KeywordVolumeRow } from "@/services/dataforseo";
import { resolveBatchLimit, statusFromOutcome } from "../../_lib/batch";

const JOB = "monthly:keyword-volume-refresh";
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;
/** Skip rows refreshed within this window. Google Ads volume is a 12-month
 *  trailing average; re-running inside 30d adds no insight. */
const REFRESH_FRESH_MS = 30 * 24 * 60 * 60 * 1000;

interface KeywordRow {
  id: string;
  keyword: string;
  locationCode: number;
  language: string;
}

export const GET = cronHandler(JOB, async (ctx) => {
  return await processMonthlyKeywordRefresh(undefined, ctx);
});

/**
 * Implementation entrypoint. Extracted so unit tests can invoke it
 * directly (handing in a synthetic Request) without going through the
 * cron-secret + ALS plumbing in `cronHandler`.
 */
export async function processMonthlyKeywordRefresh(
  req: Request | undefined,
  ctx: { runId: string; job: string },
) {
  const limit = req
    ? resolveBatchLimit(req, DEFAULT_LIMIT, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const cutoff = new Date(Date.now() - REFRESH_FRESH_MS);

  // Eligibility: stale or never-refreshed rows.
  const candidates: KeywordRow[] = await prisma.keyword.findMany({
    where: {
      OR: [{ refreshedAt: null }, { refreshedAt: { lt: cutoff } }],
    },
    select: {
      id: true,
      keyword: true,
      locationCode: true,
      language: true,
    },
    take: limit,
    orderBy: [{ refreshedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
  });

  if (candidates.length === 0) {
    return {
      itemsProcessed: 0,
      meta: {
        runId: ctx.runId,
        limit,
        candidates: 0,
        batchesAttempted: 0,
        batchesFailed: 0,
        updatedCount: 0,
        missingCount: 0,
      },
    };
  }

  // Group by (locationCode, language). The adapter's per-call price is
  // flat per (location, language); one group = one DataForSEO call.
  const groups = new Map<
    string,
    { locationCode: number; language: string; rows: KeywordRow[] }
  >();
  for (const row of candidates) {
    const key = `${row.locationCode}|${row.language}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        locationCode: row.locationCode,
        language: row.language,
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  let updatedCount = 0;
  let missingCount = 0;
  let batchesAttempted = 0;
  let batchesFailed = 0;
  const failureSample: Array<{
    locationCode: number;
    language: string;
    rows: number;
    error: string;
  }> = [];

  for (const group of groups.values()) {
    batchesAttempted += 1;
    try {
      const result = await keywordVolume({
        keywords: group.rows.map((r) => r.keyword),
        location_code: group.locationCode,
        language_code: group.language,
      });

      // DataForSEO may normalize casing; match insensitively.
      const byKeyword = new Map<string, KeywordVolumeRow>();
      for (const r of result.rows) {
        byKeyword.set(r.keyword.trim().toLowerCase(), r);
      }

      const now = new Date();
      for (const row of group.rows) {
        const match = byKeyword.get(row.keyword.trim().toLowerCase());
        if (!match) {
          missingCount += 1;
          continue;
        }
        await prisma.keyword.update({
          where: { id: row.id },
          data: {
            searchVolume:
              typeof match.search_volume === "number"
                ? Math.round(match.search_volume)
                : null,
            cpc: typeof match.cpc === "number" ? match.cpc : null,
            competition: match.competition ?? null,
            competitionIndex:
              typeof match.competition_index === "number"
                ? Math.round(match.competition_index)
                : null,
            refreshedAt: now,
          },
        });
        updatedCount += 1;
      }
    } catch (err) {
      batchesFailed += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (failureSample.length < 5) {
        failureSample.push({
          locationCode: group.locationCode,
          language: group.language,
          rows: group.rows.length,
          error: message.slice(0, 300),
        });
      }
    }
  }

  // Revalidate aggregate keyword tag so Hunter list previews recompute.
  if (updatedCount > 0) revalidateTag("dfs:kw", "weeks");

  const status: "OK" | "PARTIAL" = statusFromOutcome({
    attempted: batchesAttempted,
    succeeded: batchesAttempted - batchesFailed,
    failures: failureSample.map((f) => ({
      item: f.locationCode + "|" + f.language,
      error: f.error,
    })),
  });

  return {
    itemsProcessed: updatedCount,
    status,
    meta: {
      runId: ctx.runId,
      limit,
      candidates: candidates.length,
      batchesAttempted,
      batchesFailed,
      updatedCount,
      missingCount,
      failureSample,
    },
  };
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  REFRESH_FRESH_MS,
  processMonthlyKeywordRefresh,
};
