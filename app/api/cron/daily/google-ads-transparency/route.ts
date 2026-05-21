// Daily · google-ads-transparency
//
// Scan Google's Ads Transparency Center for tracked competitor domains and
// reconcile against `AdLibraryEntry` rows (`platform=GOOGLE`). Free per
// call but still cost-tracked.
//
// **Current state — placeholder handler.** No `services/google-ads-
// transparency` adapter exists yet (Phase C.4 only delivered the Meta
// adapter). This route lands so that:
//
//   1. The Vercel cron schedule entry in `vercel.json` resolves to an
//      existing route (a missing route logs an error every day at 11:30
//      UTC and pollutes Sentry).
//   2. The CronRun row + cost trail materializes for the dashboard so
//      coverage gaps are visible in the ops view.
//   3. The auth + cron-context invariant from
//      `.claude/rules/cost-discipline.md` is in place — when the adapter
//      ships, only the handler body grows.
//
// The body sweeps stale `AdLibraryEntry` rows on the GOOGLE platform that
// haven't been heart-beat'd in 30 days → marks them inactive. This makes
// the route useful even without a live adapter (cleanup keeps stale
// "Active ad" claims from misleading the prospect view).
//
// TODO(C.4b): once a Google Ads Transparency adapter lands, replace the
// stale-sweep with the same `seenExternalIds` reconciliation pattern as
// `ad-library-diff/route.ts`.

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";

const JOB = "daily:google-ads-transparency";
/** Mark GOOGLE-platform AdLibraryEntry rows inactive when last seen
 *  earlier than this. 30 days matches Google's Ads Transparency Center's
 *  rolling "active in last 30d" window — anything older is stale signal. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const GET = cronHandler(JOB, async ({ runId }) => {
  const staleCutoff = new Date(Date.now() - STALE_AFTER_MS);

  // Identify rows to mark stale BEFORE updating so we can revalidate
  // per-business tags. updateMany alone doesn't return the rows touched.
  const staleRows = await prisma.adLibraryEntry.findMany({
    where: {
      platform: "GOOGLE",
      isActive: true,
      lastSeenAt: { lt: staleCutoff },
    },
    select: { id: true, businessId: true },
    take: 1_000,
  });

  let staleMarked = 0;
  const revalidatedBusinessIds = new Set<string>();
  if (staleRows.length > 0) {
    const upd = await prisma.adLibraryEntry.updateMany({
      where: { id: { in: staleRows.map((r) => r.id) } },
      data: { isActive: false, endedAt: new Date() },
    });
    staleMarked = upd.count;
    for (const r of staleRows) {
      if (r.businessId) revalidatedBusinessIds.add(r.businessId);
    }
  }

  if (revalidatedBusinessIds.size > 0) {
    // Tag-revalidate per business id. The dashboard's prospect view caches
    // by `business-${id}` for the ads card.
    for (const id of revalidatedBusinessIds) {
      revalidateTag(`business-id-${id}`, "hours");
    }
  }

  return {
    itemsProcessed: staleMarked,
    status: "OK" as const,
    meta: {
      runId,
      staleMarked,
      mode: "stale-sweep-only",
      todo: "Replace with Google Ads Transparency Center adapter when C.4b lands.",
    },
  };
});

export const __test = {
  JOB,
  STALE_AFTER_MS,
};
