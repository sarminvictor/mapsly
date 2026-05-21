/**
 * Agency list-detail page · server queries.
 *
 * Surface: `getAgencyListDetailData(listId, userId, activeStatus)` —
 * returns the page payload for `/(agency)/lists/[id]`. The page picks
 * the active status from the URL search param (`?status=NEW` by
 * default) and feeds it here so the query can filter the leads server
 * side — we never ship 200 leads down the wire just to hide most of
 * them on the client.
 *
 * Returns `EMPTY_LIST_DETAIL` (with `list === null`) for the
 * not-found / not-yours / build-phase / Prisma-error cases — the page
 * checks `data.list === null` and calls `notFound()`.
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')` · same tradeoff as the
 *     lists overview · the daily list-refresh cron `revalidateTag`s
 *     after each refresh write so the page never drifts more than a
 *     few minutes from the latest cron run.
 *   - `cacheTag('list-${listId}')` · per-list scope; the daily cron
 *     hits this tag specifically.
 *   - `cacheTag('list-${listId}-${activeStatus}')` · finer scope so
 *     status-tab navigation doesn't bust everything else.
 *   - `cacheTag('agency-${agencyId}')` · co-tag so an agency-wide
 *     refresh (e.g. settings change) invalidates the page.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 we short-circuit
 * to `EMPTY_LIST_DETAIL` for `NEXT_PHASE === 'phase-production-build'`
 * and for any Prisma failure. The EMPTY shape is the full
 * `AgencyListDetailData` so TS catches partial shapes at literal
 * comparison time.
 *
 * Per `.claude/rules/performance.md`:
 *
 *   - `select` is explicit on every Prisma query.
 *   - Status counts use a single `groupBy` (one round-trip).
 *   - Lead row materialisation eagerly `include`s the latest
 *     BusinessSnapshot + LighthouseAudit so the table renders without
 *     N+1.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_LIST_DETAIL,
  type AgencyListDetailData,
  type LeadDetailRow,
  type LeadDetailSignal,
  type LeadStatusCounts,
  type LeadStatusValue,
  type ListCadenceValue,
  type ListServiceTypeValue,
} from "./types";
import { parseFilterTags } from "./filter-tags";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------ helpers */

/** Stable 1..7 avatar tone derived from a business id (hash → mod). */
function avatarToneFromId(id: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  // Map to 1..7 (avoids 0 so it always matches the index union).
  const tone = (Math.abs(h) % 7) + 1;
  return tone as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** "Solea Brickell Spa" → "SO"; single-word → first two letters uppercase. */
export function deriveAvatar(name: string): string {
  // Strip punctuation that isn't part of a word — but KEEP hyphens so
  // names like "123-go" or "Anchor-Local" stay as one token. Whitespace
  // and commas/periods/etc. still split words.
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

/** "3 yrs ago" / "yesterday" / "5d ago" — rough relative time. */
function describeRelative(ts: Date | null, now: number): string | null {
  if (!ts) return null;
  const deltaMs = now - ts.getTime();
  const days = Math.floor(deltaMs / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 730) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Compute the meta line shown under the business name:
 * "5 yrs · 4.4★ · 342 reviews · added 3d ago"
 *
 * Inputs are tolerant of nulls — missing fragments are dropped silently.
 */
export function describeBusinessMeta(input: {
  yearsOnGoogle: number | null;
  rating: number | null;
  reviewCount: number | null;
  addedAt: Date;
  now: number;
}): string {
  const parts: string[] = [];
  if (input.yearsOnGoogle != null) {
    parts.push(`${input.yearsOnGoogle} yrs`);
  }
  if (input.rating != null) {
    parts.push(`${input.rating.toFixed(1)}★`);
  }
  if (input.reviewCount != null) {
    parts.push(`${input.reviewCount} reviews`);
  }
  const added = describeRelative(input.addedAt, input.now);
  if (added) parts.push(`added ${added}`);
  return parts.join(" · ");
}

/**
 * Derive up to 4 most-impactful signal chips from the per-lead's
 * latest BusinessSnapshot + LighthouseAudit. Order matters — alerts
 * float to the front (red), then warnings (amber), then teal.
 *
 * If the latest audit / snapshot is missing we surface a couple of
 * coarse fallback chips ("no audit yet", "no snapshot") so the cell
 * isn't blank.
 */
export function summarizeLeadSignals(input: {
  performance: number | null;
  /** LCP in seconds (LighthouseAudit.lcp is `Float` in seconds, not ms). */
  lcpSeconds: number | null;
  seo: number | null;
  hasLocalBusinessSchema: boolean | null;
  napConsistent: boolean | null;
  rating: number | null;
  reviewCount: number | null;
}): LeadDetailSignal[] {
  const chips: LeadDetailSignal[] = [];

  // Lighthouse Performance — split into alert(<50) / warn(<70)
  if (input.performance != null) {
    const v = Math.round(input.performance);
    if (v < 50) {
      chips.push({
        label: `Perf ${v}`,
        tone: "alert",
        title: "Lighthouse Performance < 50 — site is failing CWV",
      });
    } else if (v < 70) {
      chips.push({
        label: `Perf ${v}`,
        tone: "warn",
        title: "Lighthouse Performance < 70 — needs improvement",
      });
    }
  }

  // LCP — > 4s alert, > 2.5s warn (LighthouseAudit.lcp is in seconds)
  if (input.lcpSeconds != null) {
    const lcpStr = input.lcpSeconds.toFixed(1);
    if (input.lcpSeconds > 4) {
      chips.push({
        label: `LCP ${lcpStr}s`,
        tone: "alert",
        title: "Largest Contentful Paint > 4s — poor",
      });
    } else if (input.lcpSeconds > 2.5) {
      chips.push({
        label: `LCP ${lcpStr}s`,
        tone: "warn",
        title: "Largest Contentful Paint > 2.5s — needs improvement",
      });
    }
  }

  // SEO Lighthouse — < 80 warn
  if (input.seo != null && input.seo < 80) {
    chips.push({
      label: `SEO ${Math.round(input.seo)}`,
      tone: "warn",
      title: "Lighthouse SEO < 80",
    });
  }

  // Missing schema
  if (input.hasLocalBusinessSchema === false) {
    chips.push({
      label: "no schema",
      tone: "teal",
      title: "LocalBusiness JSON-LD missing — easy fix",
    });
  }

  // NAP consistency
  if (input.napConsistent === false) {
    chips.push({
      label: "NAP off",
      tone: "warn",
      title: "Name/Address/Phone inconsistent across listings",
    });
  }

  // Coarse fallbacks if nothing showed up
  if (chips.length === 0) {
    // Only emit "no reviews" when we KNOW the count is zero — null means
    // "unknown" (e.g. not yet ingested) and we shouldn't shame the prospect
    // for our gap. Tests in __tests__/queries-helpers.test.ts assert this.
    if (input.reviewCount === 0) {
      chips.push({
        label: "no reviews",
        tone: "warn",
        title: "No Google reviews yet",
      });
    }
    if (input.rating != null && input.rating < 4.0) {
      chips.push({
        label: `${input.rating.toFixed(1)}★`,
        tone: "warn",
        title: "Rating below 4.0",
      });
    }
  }

  // Cap at 4 to keep the cell scannable.
  return chips.slice(0, 4);
}

/** "3d", "2w", null — used as the StatusPill dwell suffix. */
export function describeDwell(
  statusChangedAt: Date | null,
  status: LeadStatusValue,
  now: number,
): string | null {
  if (!statusChangedAt || status === "NEW") return null;
  const days = Math.floor(
    (now - statusChangedAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days < 1) return "today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/* ----------------------------------------------------------- main fn */

/**
 * Fetch the list-detail payload for `/(agency)/lists/[id]`.
 *
 * @param listId        Prisma `List.id` (cuid).
 * @param userId        The signed-in user's id (NOT the agency id).
 * @param activeStatus  Which status tab the page should render the
 *                      table for. Defaults to NEW.
 *
 * Returns `EMPTY_LIST_DETAIL` (list===null) for not-found, wrong agency,
 * Vercel build phase, or Prisma error. The caller redirects with
 * `notFound()` so the not-found.tsx shell renders.
 */
export async function getAgencyListDetailData(
  listId: string,
  userId: string,
  activeStatus: LeadStatusValue = "NEW",
): Promise<AgencyListDetailData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`list-${listId}`);
  cacheTag(`list-${listId}-${activeStatus}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return { ...EMPTY_LIST_DETAIL, activeStatus };
  }

  if (!listId || !userId || typeof listId !== "string") {
    return { ...EMPTY_LIST_DETAIL, activeStatus };
  }

  try {
    // 1. List + owner + agency · single fetch, joined for the breadcrumb.
    const list = await prisma.list.findUnique({
      where: { id: listId },
      select: {
        id: true,
        name: true,
        pitch: true,
        serviceType: true,
        refreshCadence: true,
        isActive: true,
        category: true,
        metro: true,
        radiusMi: true,
        filterJson: true,
        createdAt: true,
        lastRefreshedAt: true,
        agencyId: true,
        agency: { select: { id: true, name: true } },
        owner: {
          select: {
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!list) {
      return { ...EMPTY_LIST_DETAIL, activeStatus };
    }

    cacheTag(`agency-${list.agencyId}`);

    // 2. Verify the signed-in user belongs to this list's agency.
    //    Cheap · single `findFirst` against the (userId, agencyId)
    //    composite — typical agency has < 10 members.
    const member = await prisma.agencyMember.findFirst({
      where: { userId, agencyId: list.agencyId },
      select: { id: true },
    });

    if (!member) {
      return { ...EMPTY_LIST_DETAIL, activeStatus };
    }

    const now = Date.now();
    const sinceWeek = new Date(now - WEEK_MS);
    const sincePriorWeek = new Date(now - 2 * WEEK_MS);

    // 3. Per-status counts in one round-trip + this/prior-week deltas in
    //    parallel · keeps the tab strip and trend hint cheap.
    const [statusGroup, newThisWeekCount, newPriorWeekCount] =
      await Promise.all([
        prisma.lead.groupBy({
          by: ["status"],
          where: { listId },
          _count: { _all: true },
        }),
        prisma.lead.count({
          where: { listId, createdAt: { gte: sinceWeek } },
        }),
        prisma.lead.count({
          where: {
            listId,
            createdAt: { gte: sincePriorWeek, lt: sinceWeek },
          },
        }),
      ]);

    const statusCounts: LeadStatusCounts = {
      NEW: 0,
      CONTACTED: 0,
      REPLIED: 0,
      WON: 0,
      LOST: 0,
      HIDDEN: 0,
    };
    for (const row of statusGroup) {
      const k = row.status as LeadStatusValue;
      statusCounts[k] = row._count._all;
    }
    const totalLeads =
      statusCounts.NEW +
      statusCounts.CONTACTED +
      statusCounts.REPLIED +
      statusCounts.WON +
      statusCounts.LOST +
      statusCounts.HIDDEN;

    // 4. Leads for the active status tab · capped at 200 (typical
    //    list size). We include the latest BusinessSnapshot and
    //    LighthouseAudit per business via Prisma `include` + `take: 1
    //    + orderBy` — one round-trip, no N+1.
    const leadRows = await prisma.lead.findMany({
      where: { listId, status: activeStatus },
      orderBy: [
        { matchScore: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        businessId: true,
        status: true,
        statusChangedAt: true,
        matchScore: true,
        createdAt: true,
        business: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            rating: true,
            reviewCount: true,
            yearsOnGoogle: true,
            snapshots: {
              orderBy: { snapshotDate: "desc" },
              take: 1,
              select: {
                rating: true,
                reviewCount: true,
              },
            },
            lighthouseAudits: {
              orderBy: { auditedAt: "desc" },
              take: 1,
              select: {
                performance: true,
                seo: true,
                lcp: true,
                hasLocalBusinessSchema: true,
                napConsistent: true,
              },
            },
          },
        },
      },
    });

    const leads: LeadDetailRow[] = leadRows.map((row) => {
      const b = row.business;
      const lh = b.lighthouseAudits[0];
      const snap = b.snapshots[0];
      const rating = snap?.rating ?? b.rating ?? null;
      const reviewCount = snap?.reviewCount ?? b.reviewCount ?? null;
      const signals = summarizeLeadSignals({
        performance: lh?.performance ?? null,
        lcpSeconds: lh?.lcp ?? null,
        seo: lh?.seo ?? null,
        hasLocalBusinessSchema: lh?.hasLocalBusinessSchema ?? null,
        napConsistent: lh?.napConsistent ?? null,
        rating,
        reviewCount,
      });
      return {
        id: row.id,
        businessId: b.id,
        businessName: b.name,
        avatar: deriveAvatar(b.name),
        avatarTone: avatarToneFromId(b.id),
        meta: describeBusinessMeta({
          yearsOnGoogle: b.yearsOnGoogle ?? null,
          rating,
          reviewCount,
          addedAt: row.createdAt,
          now,
        }),
        signals,
        status: row.status as LeadStatusValue,
        statusDwell: describeDwell(
          row.statusChangedAt,
          row.status as LeadStatusValue,
          now,
        ),
        contactEmail: b.email ?? null,
        contactPhone: b.phone ?? null,
        addedAt: row.createdAt,
        matchScore: row.matchScore ?? null,
      };
    });

    const ownerName =
      list.owner?.user?.name ??
      list.owner?.user?.email?.split("@")[0] ??
      "Unknown";

    return {
      list: {
        id: list.id,
        name: list.name,
        pitch: list.pitch,
        serviceType: list.serviceType as ListServiceTypeValue,
        refreshCadence: list.refreshCadence as ListCadenceValue,
        isActive: list.isActive,
        category: list.category,
        metro: list.metro,
        radiusMi: list.radiusMi,
        ownerName,
        createdAt: list.createdAt,
        lastRefreshedAt: list.lastRefreshedAt,
        agencyId: list.agency.id,
        agencyName: list.agency.name,
      },
      statusCounts,
      totalLeads,
      newThisWeekCount,
      newPriorWeekCount,
      filterTags: parseFilterTags(list.filterJson),
      activeStatus,
      leads,
    };
  } catch {
    return { ...EMPTY_LIST_DETAIL, activeStatus };
  }
}
