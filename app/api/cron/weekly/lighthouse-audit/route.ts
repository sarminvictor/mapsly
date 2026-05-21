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

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { lighthouseFullAudit, toPersistRow } from "@/services/lighthouse";
import { runBatch, statusFromOutcome } from "../../_lib/batch";

const JOB = "weekly:lighthouse-audit";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;
/** Skip businesses audited within this window. The Lighthouse call is
 *  the most expensive single API in our stack; re-running the same URL
 *  inside 6 days adds cost without insight. */
const AUDIT_FRESH_MS = 6 * 24 * 60 * 60 * 1000;

interface BusinessRow {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string;
}

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
    select: {
      id: true,
      slug: true,
      name: true,
      address: true,
      phone: true,
      website: true,
    },
    take: limit,
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
  });

  const rows: BusinessRow[] = candidates
    .filter(
      (
        c,
      ): c is {
        id: string;
        slug: string;
        name: string;
        address: string | null;
        phone: string | null;
        website: string;
      } => typeof c.website === "string" && c.website.length > 0,
    )
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      address: c.address,
      phone: c.phone,
      website: c.website,
    }));

  const revalidatedSlugs = new Set<string>();
  let auditsInserted = 0;
  let skippedNoWebsite = 0;

  const outcome = await runBatch(rows, async (biz: BusinessRow) => {
    if (!biz.website) {
      skippedNoWebsite += 1;
      return;
    }
    const audit = await lighthouseFullAudit({
      url: biz.website,
      nap: {
        name: biz.name,
        address: biz.address ?? "",
        phone: biz.phone ?? "",
      },
    });

    const persist = toPersistRow(audit, biz.id);
    await prisma.lighthouseAudit.create({
      data: {
        ...persist,
        // rawJson is already serializable from the audit composer.
      },
    });
    auditsInserted += 1;
    revalidatedSlugs.add(biz.slug);
  });

  for (const slug of revalidatedSlugs) {
    revalidateTag(`business-${slug}-lighthouse`, "weeks");
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
      auditsInserted,
      skippedNoWebsite,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        businessId: (f.item as BusinessRow).id,
        website: (f.item as BusinessRow).website,
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
  DEFAULT_LIMIT,
  MAX_LIMIT,
  AUDIT_FRESH_MS,
  clampLimitFromEnv,
};
