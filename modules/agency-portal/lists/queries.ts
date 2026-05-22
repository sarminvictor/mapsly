/**
 * Agency lists page · server queries.
 *
 * Surface: `getAgencyListsData(userId)` — returns the user's first
 * `AgencyMember` row's agency + that agency's `List[]` (active + paused)
 * with cheap per-list lead aggregates, denormalised into a flat
 * `AgencyListsData` for the page to render.
 *
 * Returns `EMPTY_AGENCY_LISTS` (agencyId === "") when:
 *
 *   - the user has no `AgencyMember` row (SMB user landed here)
 *   - we're in Vercel's build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks empty" rather than 500 crash)
 *
 * The page handler reads `data.agencyId === ""` and redirects to
 * `/dashboard` so a stray SMB user gets bounced to their SMB surface.
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')` — Tom refreshes Lists many
 *     times a day; minutes-fresh is the right tradeoff with the daily
 *     `list-refresh-daily` cron (3.5). Once the cron lands it will
 *     `revalidateTag` after each refresh write so the "today's new
 *     matches" number stays honest.
 *   - `cacheTag('agency-lists-${userId}')` — per-user-membership scoped;
 *     a single user's view changes only when they (a) get added/removed
 *     from the agency or (b) the daily list-refresh cron writes new
 *     leads. The cron revalidates the broader `agency-${agencyId}` tag,
 *     so we also add that as a co-tag.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the EMPTY shape is
 * the full shape of the declared return type — TypeScript catches
 * partial shapes at literal-comparison time. Build-phase short-circuit
 * + catch block both return EMPTY so the page prerenders cleanly.
 *
 * Per `.claude/rules/performance.md`, `select`s are explicit. The
 * per-list lead aggregates are computed via a single `groupBy` query
 * (one round-trip total) rather than per-list `count` calls (N+1).
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import { parseFilterTags } from "@/modules/agency-portal/list-detail/filter-tags";

import {
  EMPTY_AGENCY_LISTS,
  type AgencyListSummary,
  type AgencyListsData,
  type ListCadenceValue,
  type ListServiceTypeValue,
} from "./types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ENGAGED_STATUSES = ["CONTACTED", "REPLIED", "WON"] as const;

/**
 * Fetch the agency Lists payload for the signed-in user.
 *
 * Returns `EMPTY_AGENCY_LISTS` (agencyId === "") for the no-membership /
 * build / failure cases. Callers check `data.agencyId === ""` and
 * redirect to `/dashboard` (SMB surface).
 *
 * The function does NOT enforce auth — the page handler MUST verify the
 * session and dispatch `unauthorized()` if missing. This helper just
 * looks up `AgencyMember.userId == userId` against whatever userId it's
 * given.
 */
export async function getAgencyListsData(
  userId: string,
): Promise<AgencyListsData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`agency-lists-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_AGENCY_LISTS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_AGENCY_LISTS;
  }

  try {
    // Resolve the user's first agency membership. A user CAN belong to
    // multiple agencies (e.g. white-label resellers) — for v1 we pick
    // the earliest membership. The settings page will let them switch
    // later (F.9).
    const member = await prisma.agencyMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        agencyId: true,
        agency: { select: { id: true, name: true } },
      },
    });

    if (!member?.agency) {
      return EMPTY_AGENCY_LISTS;
    }

    cacheTag(`agency-${member.agency.id}`);

    // Fetch every list for the agency — typically O(10) per agency, no
    // pagination needed at this scale. `select` is explicit so the
    // payload size is bounded.
    const lists = await prisma.list.findMany({
      where: { agencyId: member.agency.id },
      orderBy: [
        { isActive: "desc" },
        { lastRefreshedAt: { sort: "desc", nulls: "first" } },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        name: true,
        serviceType: true,
        pitch: true,
        refreshCadence: true,
        isActive: true,
        pausedAt: true,
        lastRefreshedAt: true,
        category: true,
        metro: true,
        radiusMi: true,
        filterJson: true,
        createdAt: true,
      },
    });

    if (lists.length === 0) {
      return {
        agencyId: member.agency.id,
        agencyName: member.agency.name,
        active: [],
        paused: [],
        totalNewThisWeek: 0,
        totalVerifiedEmail: 0,
      };
    }

    // One round-trip aggregate · per-list lead counts grouped by
    // (listId, status). Avoids N+1 across `lists`. Result shape:
    // `[{ listId, status, _count: { _all: N } }, ...]`.
    const since = new Date(Date.now() - WEEK_MS);
    const listIds = lists.map((l) => l.id);

    const [statusGroup, newThisWeek, verifiedGroup] = await Promise.all([
      prisma.lead.groupBy({
        by: ["listId", "status"],
        where: { listId: { in: listIds } },
        _count: { _all: true },
      }),
      prisma.lead.groupBy({
        by: ["listId"],
        where: { listId: { in: listIds }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // Verified-email tally · one row per listId. Joins through to
      // Business via the `business: { emailVerifiedAt: { not: null } }`
      // relation filter — Prisma 7's relation-filter syntax. Cheap
      // because Lead.businessId is indexed and Business.emailVerifiedAt
      // is a sparse but indexed column (monthly cron writes it).
      prisma.lead.groupBy({
        by: ["listId"],
        where: {
          listId: { in: listIds },
          business: { emailVerifiedAt: { not: null } },
        },
        _count: { _all: true },
      }),
    ]);

    // Reshape into { [listId]: { qualified, engaged, newThisWeek, verifiedEmail } }.
    type Aggregate = {
      qualified: number;
      engaged: number;
      newThisWeek: number;
      verifiedEmail: number;
    };
    const agg = new Map<string, Aggregate>();
    for (const id of listIds) {
      agg.set(id, {
        qualified: 0,
        engaged: 0,
        newThisWeek: 0,
        verifiedEmail: 0,
      });
    }
    const engagedSet = new Set<string>(ENGAGED_STATUSES);
    for (const row of statusGroup) {
      const a = agg.get(row.listId);
      if (!a) continue;
      // "Qualified" = NEW (caller hasn't acted yet). Tom-facing meaning:
      // "these are still up for grabs."
      if (row.status === "NEW") {
        a.qualified += row._count._all;
      }
      if (engagedSet.has(row.status as string)) {
        a.engaged += row._count._all;
      }
    }
    for (const row of newThisWeek) {
      const a = agg.get(row.listId);
      if (!a) continue;
      a.newThisWeek = row._count._all;
    }
    for (const row of verifiedGroup) {
      const a = agg.get(row.listId);
      if (!a) continue;
      a.verifiedEmail = row._count._all;
    }

    const summaries: AgencyListSummary[] = lists.map((l) => {
      const a = agg.get(l.id) ?? {
        qualified: 0,
        engaged: 0,
        newThisWeek: 0,
        verifiedEmail: 0,
      };
      return {
        id: l.id,
        name: l.name,
        // Prisma's generated enums widen to `string` once destructured;
        // assert back to our local literal union (1-to-1 with schema).
        serviceType: l.serviceType as ListServiceTypeValue,
        pitch: l.pitch,
        refreshCadence: l.refreshCadence as ListCadenceValue,
        isActive: l.isActive,
        pausedAt: l.pausedAt,
        lastRefreshedAt: l.lastRefreshedAt,
        category: l.category,
        metro: l.metro,
        radiusMi: l.radiusMi,
        qualifiedCount: a.qualified,
        newThisWeekCount: a.newThisWeek,
        engagedCount: a.engaged,
        verifiedEmailCount: a.verifiedEmail,
        filterTags: parseFilterTags(l.filterJson),
        createdAt: l.createdAt,
      };
    });

    const active = summaries.filter((s) => s.isActive);
    const paused = summaries.filter((s) => !s.isActive);
    // Paused list ordering · `pausedAt DESC` (most-recently-paused first).
    paused.sort((a, b) => {
      const ax = a.pausedAt?.getTime() ?? 0;
      const bx = b.pausedAt?.getTime() ?? 0;
      return bx - ax;
    });

    const totalNewThisWeek = active.reduce(
      (sum, l) => sum + l.newThisWeekCount,
      0,
    );
    const totalVerifiedEmail = active.reduce(
      (sum, l) => sum + l.verifiedEmailCount,
      0,
    );

    return {
      agencyId: member.agency.id,
      agencyName: member.agency.name,
      active,
      paused,
      totalNewThisWeek,
      totalVerifiedEmail,
    };
  } catch {
    return EMPTY_AGENCY_LISTS;
  }
}
