// modules/discovery/raw-list.ts · the "Raw List" read model (Phase 2).
//
// After a Discovery populates a cell, the user browses the raw businesses in
// it before spending credits on enrichment. This module builds the Prisma
// `where` (default exclusions + discovery-time filters), the cursor-paginated
// page, and the reachability summary counts.
//
// Default exclusions (per `.claude/rules` + open-status.ts):
//   - isHidden businesses are hidden (compliance / manual suppression).
//   - openStatus = CLOSED_FOREVER are excluded (still visible via includeClosed).
// Everything is scoped to the requested cellKeys.
//
// Discovery-time filters bias the raw list before enrichment so the user only
// pays to enrich businesses worth enriching (hasWebsite, minRating, …).

import prisma, { Prisma } from "@/lib/prisma";

/** Reachability tiers a discovery-time filter can require (maps to enum). */
export type ReachabilityFilter =
  | "UNREACHABLE"
  | "EMAIL_ONLY"
  | "PHONE_ONLY"
  | "MULTI"
  | "RICH"
  | "UNKNOWN";

export interface RawListFilters {
  /** Only businesses with a non-null website. */
  hasWebsite?: boolean;
  /** rating >= this (inclusive). */
  minRating?: number;
  /** reviewCount >= this (inclusive). */
  minReviewCount?: number;
  /** Require one of these reachability tiers. */
  reachability?: ReachabilityFilter[];
  /** Narrow to a single metro within the cell set. */
  metroSlug?: string;
}

export interface RawListWhereOpts {
  /** Cells the raw list spans. Empty → matches nothing (guarded). */
  cellKeys: string[];
  /** Include manually-hidden businesses. Default false. */
  includeHidden?: boolean;
  /** Include permanently-closed businesses. Default false. */
  includeClosed?: boolean;
  filters?: RawListFilters;
}

/**
 * Build the `Business` where-clause for a raw list query. Pure (no DB) so it's
 * unit-testable in isolation. An empty `cellKeys` array yields an
 * impossible-match clause so callers never accidentally scan the whole table.
 */
export function rawListWhere(
  opts: RawListWhereOpts,
): Prisma.BusinessWhereInput {
  const where: Prisma.BusinessWhereInput = {};

  // Scope to the cell set. Empty → match nothing (defensive — an unscoped raw
  // list would be a full-table scan over 2.1M rows).
  where.cellKey =
    opts.cellKeys.length > 0 ? { in: opts.cellKeys } : { in: ["__never__"] };

  // "Hidden" means SCANNED-and-unreachable (isHidden === true). Freshly
  // discovered businesses haven't been contact-scanned yet, so isHidden is NULL
  // — those are part of the raw market and MUST stay visible. `{ not: true }`
  // matches false AND null; `isHidden: false` would (wrongly) drop the entire
  // just-discovered market, since SQL/Prisma `= false` never matches NULL.
  if (!opts.includeHidden) where.isHidden = { not: true };
  if (!opts.includeClosed) {
    where.openStatus = { not: "CLOSED_FOREVER" };
  }

  const f = opts.filters;
  if (f) {
    if (f.hasWebsite === true) where.website = { not: null };
    if (typeof f.minRating === "number") {
      where.rating = { gte: f.minRating };
    }
    if (typeof f.minReviewCount === "number") {
      where.reviewCount = { gte: f.minReviewCount };
    }
    if (f.reachability && f.reachability.length > 0) {
      where.reachability = { in: f.reachability };
    }
    if (f.metroSlug) where.metroSlug = f.metroSlug;
  }

  return where;
}

/** Discovery-time fields surfaced in the raw list rows. */
const RAW_LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  category: true,
  city: true,
  province: true,
  country: true,
  metroSlug: true,
  cellKey: true,
  rating: true,
  reviewCount: true,
  website: true,
  domain: true,
  phone: true,
  openStatus: true,
  reachability: true,
  reachableChannelCount: true,
  anchorDistanceKm: true,
  isClaimed: true,
} as const;

export type RawListRow = Prisma.BusinessGetPayload<{
  select: typeof RAW_LIST_SELECT;
}>;

export interface RawListPage {
  rows: RawListRow[];
  /** Pass to the next call's `cursor` for the following page (null at end). */
  nextCursor: string | null;
}

export interface RawListPageOpts {
  /** Rows per page (1–200). Defaults to 50. */
  take?: number;
  /** Business id to resume after (cursor-based; stable under inserts). */
  cursor?: string;
}

/**
 * Cursor-paginated raw list. Ordered by review count desc then id for a stable
 * cursor. Returns `take + 1` internally to compute `nextCursor` without a count.
 */
export async function getRawList(
  opts: RawListWhereOpts,
  page: RawListPageOpts = {},
): Promise<RawListPage> {
  const take = clampTake(page.take ?? 50);
  const where = rawListWhere(opts);

  const rows = await prisma.business.findMany({
    where,
    // NULLS LAST is load-bearing: Postgres sorts NULLs FIRST on DESC by
    // default, so without this the ~15% of listings with no reviewCount
    // (solo practitioners, labs, suppliers — which also tend to lack a
    // website) float to the very top and bury the strongest leads. Sinking
    // them makes both the Preview sample AND the workbench show the
    // most-reviewed, most-complete businesses first.
    orderBy: [{ reviewCount: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    take: take + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: RAW_LIST_SELECT,
  });

  let nextCursor: string | null = null;
  if (rows.length > take) {
    const extra = rows.pop();
    nextCursor = extra?.id ?? null;
  }

  return { rows, nextCursor };
}

export interface RawListSummary {
  total: number;
  reachable: number;
  phoneOnly: number;
  hidden: number;
}

/**
 * Reachability + suppression headline counts for the cell set. Drives the
 * "X businesses · Y reachable · Z phone-only · N hidden" header bar. Computed
 * with deliberate `where` overrides so the summary reflects the WHOLE cell set,
 * not just the current filtered view.
 *
 *   - total     · default-excluded view (hidden + closed-forever removed)
 *   - reachable · reachableChannelCount > 0 within the default-excluded view
 *   - phoneOnly · reachability = PHONE_ONLY
 *   - hidden    · isHidden = true (the suppressed count, shown for transparency)
 */
export async function getRawListSummary(
  opts: RawListWhereOpts,
): Promise<RawListSummary> {
  const base = rawListWhere(opts);

  const [total, reachable, phoneOnly, hidden] = await prisma.$transaction([
    prisma.business.count({ where: base }),
    prisma.business.count({
      where: { ...base, reachableChannelCount: { gt: 0 } },
    }),
    prisma.business.count({
      where: { ...base, reachability: "PHONE_ONLY" },
    }),
    prisma.business.count({
      where: {
        cellKey:
          opts.cellKeys.length > 0
            ? { in: opts.cellKeys }
            : { in: ["__never__"] },
        isHidden: true,
      },
    }),
  ]);

  return { total, reachable, phoneOnly, hidden };
}

function clampTake(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(200, Math.max(1, Math.floor(n)));
}
