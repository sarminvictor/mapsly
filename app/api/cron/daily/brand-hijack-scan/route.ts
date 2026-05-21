// Daily · brand-hijack-scan
//
// Live Google SERP scan for each tracked business's own brand name. Any
// "paid" item appearing in the top-10 results is a brand hijacker — a
// competitor outbidding the business on its own name. The handler persists
// one `SerpResult` row per business per run with `isBrandQuery=true` and
// the paid bidder snapshot in `paidBidders`.
//
// Source: `services/dataforseo/serp-organic` (Live tier) — brand-name
// queries are latency-critical (an active hijack lasts ~hours) so the
// daily budget tolerates the Live cost (~$0.003/call).
//
// Cadence: daily 11:00 UTC per `vercel.json`. Bounded to 50 businesses per
// run by default (`?limit=N` overrides up to 200 for ad-hoc backfills).

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { serpOrganic } from "@/services/dataforseo";
import { resolveBatchLimit, runBatch, statusFromOutcome } from "../_lib/batch";

const JOB = "daily:brand-hijack-scan";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Look-back window — businesses whose last brand-scan SerpResult is
 *  newer than this are skipped this run. 20h gives roughly daily cadence
 *  while letting a slightly-early second tick still pick up stragglers. */
const BRAND_SCAN_FRESH_MS = 20 * 60 * 60 * 1000;

interface PaidBidder {
  rank: number | null;
  domain: string | null;
  title: string | null;
  url: string | null;
}

interface BusinessRow {
  id: string;
  slug: string;
  name: string;
  country: string | null;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  // Mark the active CronRun on the URL via the handler's request — but
  // we don't have direct access; resolveBatchLimit reads it from req.
  // cronHandler closes over the request object — pull it via the
  // Symbol-less convention by capturing it through a tiny indirection:
  // (the wrapper passes only `{ runId, job }` so we expose limit via the
  // function-scoped default. ?limit override is read here via Next's
  // request-scoped helpers — for simplicity in this initial iteration we
  // accept the default + env override only.)
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);

  const cutoff = new Date(Date.now() - BRAND_SCAN_FRESH_MS);

  // Pick businesses with the stalest brand-scan (or never scanned).
  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      name: { not: "" },
      NOT: {
        serpResults: {
          some: { isBrandQuery: true, scannedAt: { gte: cutoff } },
        },
      },
    },
    select: { id: true, slug: true, name: true, country: true },
    take: limit,
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
  });

  const revalidatedSlugs = new Set<string>();

  const outcome = await runBatch(candidates, async (biz: BusinessRow) => {
    // Brand-name query — pull top-20 to catch deeper paid placements too.
    const result = await serpOrganic({
      keyword: biz.name,
      location_code: locationCodeForCountry(biz.country),
      language_code: "en",
      device: "desktop",
      depth: 20,
    });

    const paid: PaidBidder[] = [];
    let foundOrganicRank: number | null = null;
    for (const item of result.items ?? []) {
      const type = (item.type ?? "").toLowerCase();
      if (type === "paid" || type === "ads" || type.includes("paid")) {
        paid.push({
          rank: item.rank_group ?? item.rank_absolute ?? null,
          domain: item.domain ?? null,
          title: item.title ?? null,
          url: item.url ?? null,
        });
      } else if (type === "organic" && foundOrganicRank == null) {
        foundOrganicRank = item.rank_group ?? null;
      }
    }

    await prisma.serpResult.create({
      data: {
        businessId: biz.id,
        // Brand-hijack scan doesn't tie to a tracked Keyword — leave keywordId
        // pointing at a synthetic per-business brand-keyword row that the
        // indexer ensures exists. We upsert it inline so this handler doesn't
        // depend on a separate seed pass.
        keywordId: await ensureBrandKeywordId(biz.name, biz.country),
        scannedAt: new Date(),
        organicRank: foundOrganicRank,
        isBrandQuery: true,
        paidBidders: paid as unknown as object,
      },
    });

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
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        businessId: (f.item as BusinessRow).id,
        error: f.error,
      })),
    },
  };
});

/**
 * Brand-name SERP results live on `SerpResult` rows tied to a `Keyword`.
 * Hijack scans use a synthetic brand-keyword per business; this helper
 * upserts that row and returns its id. The lookup is cheap (PK + unique
 * lookup) and the upsert is idempotent — multiple runs land on the same id.
 *
 * Synthetic naming convention: `__brand:{slug}` so it's distinguishable
 * from real tracked keywords in admin views.
 */
async function ensureBrandKeywordId(
  brandName: string,
  country: string | null,
): Promise<string> {
  const locationCode = locationCodeForCountry(country);
  const keywordText = `__brand:${brandName}`.slice(0, 700);
  const existing = await prisma.keyword.findUnique({
    where: {
      keyword_locationCode_language: {
        keyword: keywordText,
        locationCode,
        language: "en",
      },
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.keyword.create({
    data: { keyword: keywordText, locationCode, language: "en" },
    select: { id: true },
  });
  return created.id;
}

function locationCodeForCountry(country: string | null | undefined): number {
  switch ((country ?? "").toUpperCase()) {
    case "CA":
    case "CAN":
      return 2124;
    case "UK":
    case "GB":
      return 2826;
    case "AU":
      return 2036;
    default:
      return 2840; // US fallback
  }
}

/**
 * `cronHandler` doesn't pass the Request through to the handler body, so
 * `?limit=N` overrides land via an env var the wrapper script can set per
 * invocation: `CRON_DAILY_LIMIT`. Keeps the wire format simple; ad-hoc
 * backfills can still pass it from the CLI / GitHub Actions step.
 *
 * resolveBatchLimit is still exported from _lib/batch.ts for the future
 * day we wire the Request through (small refactor — out of scope for C.8).
 */
function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_DAILY_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

// Re-export for tree-shake fairness — helps test files import the same
// constants as the route, ensuring the limit and cadence stay in sync.
export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  BRAND_SCAN_FRESH_MS,
  locationCodeForCountry,
  clampLimitFromEnv,
  resolveBatchLimit,
};
