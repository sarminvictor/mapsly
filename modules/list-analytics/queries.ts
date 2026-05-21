/**
 * Agency list-analytics page · server queries (F.5).
 *
 * Surface: `getListAnalyticsForAgency(userId)` — returns the cross-list
 * funnel payload for `/(agency)/list-analytics`. Looks up the user's
 * first `AgencyMember` row, then aggregates `Lead` rows for every
 * `List` belonging to that agency in the last 90 days.
 *
 * Returns `EMPTY_LIST_ANALYTICS` (agencyId === "") for the
 * no-membership / build-phase / Prisma-error cases per Pattern 1 of
 * `.claude/rules/cache-components.md` (INC-25, INC-27). The page reads
 * `data.agencyId === ""` and redirects SMB-only users to `/dashboard`.
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('hours')` — analytics is a Tom-
 *     daily-glance surface; hour-fresh balances Neon load against
 *     "yesterday's numbers look fine". The daily list-refresh cron
 *     will `revalidateTag` the agency-wide tag below once it lands so
 *     numbers don't drift more than a few minutes from a cron run.
 *   - `cacheTag('agency-${agencyId}-list-analytics')` · per-agency
 *     scope so a `revalidateTag` on one agency doesn't bust another's
 *     cached payload.
 *   - `cacheTag('agency-${agencyId}')` · co-tag so any agency-wide
 *     refresh (settings change, member added, list-refresh cron)
 *     invalidates the page.
 *
 * Per `.claude/rules/scalability.md`:
 *
 *   - `select` is explicit on every Prisma query.
 *   - The agency-wide aggregate uses ONE `prisma.$queryRaw` rollup
 *     (per `.claude/rules/scalability.md` "batch where supported") +
 *     ONE Prisma `groupBy` for per-list breakdown · two round-trips
 *     total regardless of list count.
 *   - We never `findMany` leads without a bound — only counts come
 *     down the wire.
 *
 * Per `.claude/rules/security.md` — auth is enforced upstream in the
 * page handler (`unauthorized()` if no session); this helper only
 * looks up `AgencyMember.userId === userId` and never returns data
 * from a different agency. Cross-agency leak is structurally
 * impossible because `lists` and `leads` are filtered by `agencyId`.
 *
 * `signalCorrelations` is a STUB at F.5 — the heavy per-signal lift
 * compute lives in a follow-up D.x task. We return an empty array so
 * the component contract is stable.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_LIST_ANALYTICS,
  type ListAnalyticsData,
  type ListAnalyticsStats,
  type ListFunnelRow,
} from "./types";

/** 90-day analytics window · the canonical Tom-facing reporting period. */
const WINDOW_DAYS = 90;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Cap per-list rows we ship down · an agency with > 200 lists is an
 *  outlier; the table truncates and surfaces a follow-up affordance.
 *  Bound keeps the payload predictable. */
const MAX_LIST_ROWS = 200;

/** Lead statuses that count as "engaged" · denominator for replyRate /
 *  closedWon. CONTACTED + REPLIED + WON + LOST = "we touched them". */
const ENGAGED_STATUSES = ["CONTACTED", "REPLIED", "WON", "LOST"] as const;
/** Lead statuses that count as "replied" · numerator for replyRate.
 *  REPLIED + WON + LOST = "they talked back". */
const REPLIED_STATUSES = ["REPLIED", "WON", "LOST"] as const;

/** Safe rate · clamps the 0/0 case to 0 (never NaN, never Infinity). */
function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  const r = numerator / denominator;
  if (!Number.isFinite(r)) return 0;
  return Math.max(0, Math.min(1, r));
}

/**
 * Fetch the analytics payload for the signed-in user's agency.
 *
 * Returns `EMPTY_LIST_ANALYTICS` (agencyId === "") for the
 * no-membership / build / failure cases. Callers check
 * `data.agencyId === ""` and redirect SMB users to `/dashboard`.
 *
 * The function does NOT enforce auth — the page handler MUST verify
 * the session and dispatch `unauthorized()` if missing. This helper
 * looks up `AgencyMember.userId == userId` against whatever userId
 * it's given.
 */
export async function getListAnalyticsForAgency(
  userId: string,
): Promise<ListAnalyticsData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`list-analytics-${userId}`);

  // INC-27 · Vercel's build worker cannot open a Neon WebSocket; every
  // 'use cache' Prisma helper short-circuits during build phase. The
  // returned shape MUST be the FULL ListAnalyticsData shape (INC-25) —
  // EMPTY_LIST_ANALYTICS is the single source of truth for that.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_LIST_ANALYTICS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_LIST_ANALYTICS;
  }

  try {
    // Resolve the user's first agency membership · matches the F.3
    // policy (earliest membership wins; settings will let them switch).
    const member = await prisma.agencyMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        agencyId: true,
        agency: { select: { id: true, name: true } },
      },
    });

    if (!member?.agency) {
      return EMPTY_LIST_ANALYTICS;
    }

    const agencyId = member.agency.id;
    cacheTag(`agency-${agencyId}`);
    cacheTag(`agency-${agencyId}-list-analytics`);

    // Fetch the agency's lists · cap at MAX_LIST_ROWS so a runaway
    // agency doesn't blow up the page payload. `select` is explicit.
    const lists = await prisma.list.findMany({
      where: { agencyId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      take: MAX_LIST_ROWS,
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });

    if (lists.length === 0) {
      return {
        agencyId,
        agencyName: member.agency.name,
        stats: {
          surfaced90d: 0,
          contactRate: 0,
          replyRate: 0,
          closedWon: 0,
        },
        lists: [],
        signalCorrelations: [],
      };
    }

    const listIds = lists.map((l) => l.id);
    const since = new Date(Date.now() - WINDOW_MS);

    // ONE groupBy round-trip · per-list × per-status lead counts over
    // the 90-day window. Avoids N+1 across `lists`. HIDDEN is excluded
    // server-side so it doesn't pollute the funnel denominator.
    const statusGroup = await prisma.lead.groupBy({
      by: ["listId", "status"],
      where: {
        listId: { in: listIds },
        agencyId, // belt-and-braces · agency scope already implied
        createdAt: { gte: since },
        status: { not: "HIDDEN" },
      },
      _count: { _all: true },
    });

    // Reshape into `{ [listId]: { new, contacted, replied, won, lost } }`.
    type FunnelTotals = {
      new: number;
      contacted: number;
      replied: number;
      won: number;
      lost: number;
    };
    const empty: FunnelTotals = {
      new: 0,
      contacted: 0,
      replied: 0,
      won: 0,
      lost: 0,
    };
    const perList = new Map<string, FunnelTotals>();
    for (const id of listIds) perList.set(id, { ...empty });

    for (const row of statusGroup) {
      const t = perList.get(row.listId);
      if (!t) continue;
      const c = row._count._all;
      switch (row.status) {
        case "NEW":
          t.new += c;
          break;
        case "CONTACTED":
          t.contacted += c;
          break;
        case "REPLIED":
          t.replied += c;
          break;
        case "WON":
          t.won += c;
          break;
        case "LOST":
          t.lost += c;
          break;
        // HIDDEN filtered above — but keep the explicit default to
        // make the exhaustive intent obvious.
        default:
          break;
      }
    }

    // Build per-list funnel rows · sorted by totalLeads DESC so the
    // busiest lists rise to the top of Tom's scan.
    const funnelRows: ListFunnelRow[] = lists.map((l) => {
      const t = perList.get(l.id) ?? { ...empty };
      const totalLeads = t.new + t.contacted + t.replied + t.won + t.lost;
      return {
        listId: l.id,
        listName: l.name,
        isActive: l.isActive,
        totals: t,
        totalLeads,
      };
    });
    funnelRows.sort((a, b) => b.totalLeads - a.totalLeads);

    // 4-stat hero · rolled up across the 90-day window.
    let surfaced90d = 0;
    let engaged = 0;
    let replied = 0;
    let won = 0;
    const engagedSet = new Set<string>(ENGAGED_STATUSES);
    const repliedSet = new Set<string>(REPLIED_STATUSES);
    for (const row of statusGroup) {
      const c = row._count._all;
      surfaced90d += c;
      if (engagedSet.has(row.status as string)) engaged += c;
      if (repliedSet.has(row.status as string)) replied += c;
      if (row.status === "WON") won += c;
    }

    const stats: ListAnalyticsStats = {
      surfaced90d,
      contactRate: safeRate(engaged, surfaced90d),
      replyRate: safeRate(replied, engaged),
      closedWon: safeRate(won, engaged),
    };

    return {
      agencyId,
      agencyName: member.agency.name,
      stats,
      lists: funnelRows,
      // Stub awaiting D.x signal-engineering task. Component renders
      // an empty-state with "coming next phase" copy.
      signalCorrelations: [],
    };
  } catch {
    // Degrade to "looks empty" rather than 500-crash · matches the
    // F.3 / F.4 policy. The shell still renders; the analytics card
    // shows the empty state.
    return EMPTY_LIST_ANALYTICS;
  }
}
