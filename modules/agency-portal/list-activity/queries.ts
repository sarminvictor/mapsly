/**
 * Agency list-activity · server query.
 *
 * Surface: `getAgencyActivityFeed(userId)` — assembles the
 * "what happened across my lists" feed for `/(agency)/list-activity`.
 *
 * One feed item per (Lead, eventKind) tuple. We use the Lead row's
 * own status-transition timestamps (`createdAt`, `contactedAt`,
 * `repliedAt`, `wonAt`, `lostAt`) as the event source — no separate
 * "ActivityLog" table is needed at v1, and the shape stays honest
 * because the same row is the audit trail.
 *
 * Returns `EMPTY_AGENCY_ACTIVITY` (agencyId === "") for the
 * no-membership / build / failure cases per Pattern 1 of
 * `.claude/rules/cache-components.md` (INC-25, INC-27). The page
 * reads `data.agencyId === ""` and redirects SMB users to
 * `/dashboard`.
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')` — Tom may refresh
 *     several times per hour to scan team progress; minutes-fresh
 *     balances Neon load against "is this still real?"
 *   - `cacheTag('agency-${agencyId}-activity')` · per-agency scope
 *   - `cacheTag('agency-${agencyId}')` · co-tag so any agency-wide
 *     refresh (status change, cron) invalidates the feed
 *
 * Per `.claude/rules/scalability.md`:
 *
 *   - `select` is explicit on every Prisma query.
 *   - We fetch a bounded slice of recent Leads (last 14 days) plus
 *     the latest ListRefresh in two parallel round-trips.
 *   - Expansion into per-event rows happens in-memory — no N+1.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_AGENCY_ACTIVITY,
  type ActivityEventKind,
  type ActivityItem,
  type AgencyActivityData,
  type LeadStatusValue,
} from "./types";

/** Feed window · last 14 days. Tom-scannable; older events feed the
 *  analytics page (90d window) rather than the activity stream. */
const WINDOW_DAYS = 14;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Cap on rendered feed items · matches the "1-screen scan" Tom-voice
 *  target. The page footer surfaces the total when >cap. */
const MAX_FEED_ITEMS = 50;

/**
 * Fetch the activity feed for the signed-in user's agency.
 *
 * Returns `EMPTY_AGENCY_ACTIVITY` (agencyId === "") for the
 * no-membership / build / failure cases. Callers check
 * `data.agencyId === ""` and redirect SMB users to `/dashboard`.
 *
 * Auth is enforced upstream by the page handler — this helper only
 * filters by the user's first `AgencyMember.agencyId` and cannot
 * leak data across agencies (Lead/List rows are scoped by
 * `agencyId`).
 */
export async function getAgencyActivityFeed(
  userId: string,
): Promise<AgencyActivityData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`agency-activity-${userId}`);

  // INC-27 · Vercel's build worker cannot open a Neon WebSocket.
  // Returned shape MUST be the FULL AgencyActivityData shape (INC-25).
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_AGENCY_ACTIVITY;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_AGENCY_ACTIVITY;
  }

  try {
    // Resolve the user's first agency membership · matches the F.1 /
    // F.3 / F.5 policy (earliest membership wins).
    const member = await prisma.agencyMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        agencyId: true,
        agency: { select: { id: true, name: true } },
      },
    });

    if (!member?.agency) {
      return EMPTY_AGENCY_ACTIVITY;
    }

    const agencyId = member.agency.id;
    cacheTag(`agency-${agencyId}`);
    cacheTag(`agency-${agencyId}-activity`);

    const since = new Date(Date.now() - WINDOW_MS);

    // Two parallel round-trips:
    //   1. Recent Leads (any column-touched timestamp within window)
    //   2. Most-recent ListRefresh row (so the page shows freshness)
    const [recentLeads, lastRefresh] = await Promise.all([
      prisma.lead.findMany({
        where: {
          agencyId,
          status: { not: "HIDDEN" },
          OR: [
            { createdAt: { gte: since } },
            { contactedAt: { gte: since } },
            { repliedAt: { gte: since } },
            { wonAt: { gte: since } },
            { lostAt: { gte: since } },
          ],
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          contactedAt: true,
          repliedAt: true,
          wonAt: true,
          lostAt: true,
          listId: true,
          list: { select: { name: true } },
          businessId: true,
          business: {
            select: {
              name: true,
              city: true,
              province: true,
            },
          },
        },
        // Take up to 3x MAX_FEED_ITEMS so we have headroom after
        // expanding each lead into N events (typically 1-3).
        take: MAX_FEED_ITEMS * 3,
        orderBy: { statusChangedAt: "desc" },
      }),
      prisma.listRefresh.findFirst({
        where: { list: { agencyId } },
        orderBy: { refreshedAt: "desc" },
        select: { refreshedAt: true },
      }),
    ]);

    // Expand each Lead into 1..5 events, one per non-null timestamp
    // column that falls inside the window. The same lead can produce
    // multiple feed entries (e.g. created on day 1, contacted day 3,
    // replied day 5 — three feed rows total).
    const all: ActivityItem[] = [];
    for (const lead of recentLeads) {
      const businessLocale = composeLocale(
        lead.business.city ?? null,
        lead.business.province ?? null,
      );
      const baseItem = {
        currentStatus: lead.status as LeadStatusValue,
        businessId: lead.businessId,
        businessName: lead.business.name,
        businessLocale,
        listId: lead.listId,
        listName: lead.list.name,
      } as const;

      pushEventIfInWindow(
        all,
        lead.id,
        "lead_new",
        lead.createdAt,
        since,
        baseItem,
      );
      pushEventIfInWindow(
        all,
        lead.id,
        "lead_contacted",
        lead.contactedAt,
        since,
        baseItem,
      );
      pushEventIfInWindow(
        all,
        lead.id,
        "lead_replied",
        lead.repliedAt,
        since,
        baseItem,
      );
      pushEventIfInWindow(
        all,
        lead.id,
        "lead_won",
        lead.wonAt,
        since,
        baseItem,
      );
      pushEventIfInWindow(
        all,
        lead.id,
        "lead_lost",
        lead.lostAt,
        since,
        baseItem,
      );
    }

    // Sort all expanded events by `at DESC` and cap.
    all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const items = all.slice(0, MAX_FEED_ITEMS);

    return {
      agencyId,
      agencyName: member.agency.name,
      items,
      totalEvents: all.length,
      lastListRefresh: lastRefresh?.refreshedAt?.toISOString() ?? null,
    };
  } catch {
    // Degrade to "looks empty" rather than 500-crash · matches the
    // F.1 / F.3 / F.5 policy.
    return EMPTY_AGENCY_ACTIVITY;
  }
}

/**
 * Push an ActivityItem if the timestamp is non-null and falls within
 * the feed window. Pure helper — keeps the expansion loop above tidy.
 */
function pushEventIfInWindow(
  out: ActivityItem[],
  leadId: string,
  kind: ActivityEventKind,
  ts: Date | null,
  since: Date,
  base: {
    currentStatus: LeadStatusValue;
    businessId: string;
    businessName: string;
    businessLocale: string | null;
    listId: string;
    listName: string;
  },
): void {
  if (!ts || ts < since) return;
  out.push({
    id: `${leadId}-${kind}`,
    at: ts.toISOString(),
    kind,
    ...base,
  });
}

/**
 * Compose a single-line locale blurb from city / province. Returns
 * null when both are empty so the row keeps a tight 2-line shape.
 */
function composeLocale(
  city: string | null,
  province: string | null,
): string | null {
  if (city && province) return `${city}, ${province}`;
  if (city) return city;
  if (province) return province;
  return null;
}
