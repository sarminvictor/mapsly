// Weekly · lighthouse-audit
//
// For each active business with a `website`, run `lighthouseFullAudit`
// (`services/lighthouse` — wraps the DataForSEO Lighthouse call + our
// custom DOM checks for schema, NAP, booking CTA, phone-above-fold). The
// result lands in `LighthouseAudit`. Latest row per business is the
// dashboard's source for performance KPIs.
//
// Source: `services/lighthouse/audit` (DataForSEO Live tier + DOM fetch,
// cached 24h per URL+mobile flag).
//
// Cadence: weekly Monday 12:30 UTC per `vercel.json`. Bounded to 20
// businesses per run by default — Lighthouse is expensive ($0.05+ per
// call after DOM fetch). MAX_LIMIT 60 protects against backfill bursts.

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { collectWebsiteForBatch } from "@/modules/website-intel/collect-website-intel";
import { filterEligibleBusinesses } from "@/lib/reviews/should-collect";

const JOB = "weekly:lighthouse-audit";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;
/** Skip businesses audited within this window. The Lighthouse call is
 *  the most expensive single API in our stack; re-running the same URL
 *  inside 6 days adds cost without insight. */
const AUDIT_FRESH_MS = 6 * 24 * 60 * 60 * 1000;

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);
  const cutoff = new Date(Date.now() - AUDIT_FRESH_MS);

  // Eligibility: active + has website + no Lighthouse row within the
  // freshness window. The `lighthouseAudits` relation is ordered desc by
  // auditedAt; we take 1 and compare in the filter below via NOT some.
  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      website: { not: null },
      NOT: { lighthouseAudits: { some: { auditedAt: { gte: cutoff } } } },
    },
    select: { id: true },
    take: limit,
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
  });

  // Paid-cell gate · only audit cells with a paid business (same gate as
  // reviews + search). No-op while MAPSLY_COLLECT_REVIEWS_ALLOW_ALL=1.
  const eligibleIds = await filterEligibleBusinesses(
    candidates.map((c) => c.id),
  );

  // Identical work to the admin "Run Website" trigger — one shared collector.
  const result = await collectWebsiteForBatch(eligibleIds);

  return {
    itemsProcessed: result.audited,
    status: result.errors.length === 0 ? "OK" : "PARTIAL",
    meta: {
      runId,
      limit,
      attempted: result.businesses,
      succeeded: result.audited,
      failed: result.errors.length,
      auditsInserted: result.audited,
      skippedNoWebsite: result.skippedNoWebsite,
      failureSample: result.errors.slice(0, 5),
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
  DEFAULT_LIMIT,
  MAX_LIMIT,
  AUDIT_FRESH_MS,
  clampLimitFromEnv,
};
