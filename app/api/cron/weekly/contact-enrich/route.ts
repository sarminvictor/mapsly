// Weekly · contact-enrich
//
// For each active business with a `website`, fetch its homepage through the
// Cloudflare-busting DOM-fetcher actor (services/dom-fetcher) and parse contacts
// + tech off the single rendered DOM (modules/discovery/enrich-contacts). The
// result lands in Contact rows + BusinessTech rows, and the Business row's
// reachability / contactScanStatus / techScanLastAt are recomputed.
//
// Source: services/dom-fetcher (Apify residential-proxy browser, cost billed
// per run to CronRun.costUsd) → services/contact-scraper (pure parser).
//
// Cadence: weekly. Bounded to a small batch per run (DOM fetch is paid — a
// browser through a residential proxy). CRON_WEEKLY_CONTACT_LIMIT overrides the
// default; MAX_LIMIT protects against backfill bursts. The 90-day freshness
// dedup in the orchestrator means re-running inside the window is mostly a no-op.
//
// Mirrors app/api/cron/weekly/lighthouse-audit/route.ts.

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { enrichContactsForBusinesses } from "@/modules/discovery/enrich-contacts";

const JOB = "weekly:contact-enrich";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
/** Skip businesses whose contacts were extracted within this window. Mirrors
 *  the orchestrator's 90-day freshness; used here to pick the stalest rows. */
const CONTACTS_FRESH_MS = 90 * 24 * 60 * 60 * 1000;

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);
  const cutoff = new Date(Date.now() - CONTACTS_FRESH_MS);

  // Eligibility: active + has website + not hidden + contacts stale or never
  // extracted. The orchestrator re-checks freshness (the source of truth), so a
  // candidate that became fresh between select and run is counted skippedFresh.
  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      isHidden: false,
      website: { not: null },
      OR: [
        { contactsExtractedAt: null },
        { contactsExtractedAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
    take: limit,
    orderBy: { contactsExtractedAt: { sort: "asc", nulls: "first" } },
  });

  const summary = await enrichContactsForBusinesses(
    candidates.map((c) => c.id),
  );

  return {
    itemsProcessed: summary.succeeded,
    status: summary.failed > 0 || summary.blocked > 0 ? "PARTIAL" : "OK",
    meta: {
      runId,
      limit,
      attempted: summary.processed,
      succeeded: summary.succeeded,
      blocked: summary.blocked,
      failed: summary.failed,
      skippedFresh: summary.skippedFresh,
      contactsUpserted: summary.contactsUpserted,
      techUpserted: summary.techUpserted,
      // Free-fetch-first routing: how many DOMs came free vs the paid actor.
      freeFetched: summary.freeFetched,
      actorFetched: summary.actorFetched,
      usageTotalUsd: summary.usageTotalUsd,
    },
  };
});

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_CONTACT_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  CONTACTS_FRESH_MS,
  clampLimitFromEnv,
};
