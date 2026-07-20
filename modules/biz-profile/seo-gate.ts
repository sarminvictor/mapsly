/**
 * Public `/biz` SEO gate · single source of truth for "is this business
 * page worth showing Google?"
 *
 * Two coordinated consumers — they MUST stay in lockstep or the sitemap
 * would list pages that declare `noindex` (a Search Console error class):
 *
 *   1. `listBizSitemapEntries` (modules/biz-profile/queries.ts) — DB-side
 *      candidate filter (`SITEMAP_CANDIDATE_WHERE`) + `passesBizIndexGate`
 *      applied to each row's LATEST snapshot.
 *   2. `generateMetadata` on `app/[locale]/(marketing)/biz/[slug]/page.tsx`
 *      — decides `robots: index` vs `noindex, follow` from the SAME
 *      predicate. Gate-failing pages stay rendered and followable (they
 *      serve the claim funnel and cold-outreach links) — never 404.
 *
 * Why gate at all: only ~588 of 6,630 active businesses have a
 * BusinessSnapshot, and pages without one render ~78 words of template —
 * the post-March-2024 "scaled content abuse" deindex profile. Tier 1
 * (2026-07-20) = 327 businesses: website + ≥5 reviews + a scored latest
 * snapshot. The proprietary score/rank line is what separates a rich page
 * (9 concrete data points) from a thin one (see
 * docs/gtm-first-users-2026-07-20.html, pSEO research).
 *
 * Tiering discipline: GROW the indexed set by enriching more businesses
 * until they PASS this gate (run snapshot/scoring crons over more cells) —
 * never by loosening the gate. Advance only at ≥80% submitted-indexed in
 * GSC, sustained ~2 weeks (INC-2026-07-20-66).
 */

import type { Prisma } from "@/lib/prisma";

/** Minimum Google review count for an indexable `/biz` page. */
export const BIZ_INDEX_MIN_REVIEWS = 5;

/**
 * Fields the predicate reads. Structurally satisfied by `BizProfileData`
 * (page side — latest snapshot denormalised) and by the sitemap query's row
 * shape (query side).
 */
export interface BizIndexGateInput {
  website: string | null;
  reviewCount: number | null;
  /** Latest snapshot's scores · both null when no snapshot exists. */
  mapslyScore: number | null;
  pillarScore: number | null;
  /** Visibility flags — a suppressed (do-not-sell opt-out), hidden, or
   *  permanently-closed business must NEVER be indexed, regardless of how
   *  rich its data is. */
  isHidden: boolean;
  permanentlyClosed: boolean;
  suppressedAt: Date | null;
}

/** True when the page has enough proprietary signal to face Google. */
export function passesBizIndexGate(d: BizIndexGateInput): boolean {
  return (
    !d.isHidden &&
    !d.permanentlyClosed &&
    d.suppressedAt == null &&
    d.website != null &&
    d.website.trim() !== "" &&
    (d.reviewCount ?? 0) >= BIZ_INDEX_MIN_REVIEWS &&
    (d.mapslyScore != null || d.pillarScore != null)
  );
}

/**
 * DB-side CANDIDATE filter for the sitemap query — a deliberate SUPERSET of
 * the predicate (`snapshots: { some }` checks ANY snapshot because Prisma
 * cannot express "latest snapshot has a score" in a where-clause, and the
 * empty-string website case is predicate-only), so `listBizSitemapEntries`
 * post-filters every row through `passesBizIndexGate`. The predicate, not
 * this where-clause, is the authority. Verified against live data
 * 2026-07-20: candidates 327 → post-filter 327 (drop 0 — scores don't
 * regress to null on newer snapshots today, but the post-filter keeps the
 * two consumers exactly aligned if that ever changes).
 *
 * SCALE NOTE (perf audit 2026-07-20): no supporting index — Postgres
 * seq-scans Business, fine at 6,630 rows behind two cache layers. When
 * Business > 50k rows OR the cold sitemap query p95 > 500ms, add a partial
 * index via a hand-written migration (Prisma @@index can't express WHERE):
 *
 *   CREATE INDEX "Business_sitemap_candidate_idx" ON "Business" (slug)
 *   WHERE "isActive" = true AND "permanentlyClosed" = false
 *     AND "isHidden" = false AND "suppressedAt" IS NULL
 *     AND "website" IS NOT NULL AND "reviewCount" >= 5;
 */
export const SITEMAP_CANDIDATE_WHERE = {
  isActive: true,
  permanentlyClosed: false,
  isHidden: false,
  suppressedAt: null,
  website: { not: null },
  reviewCount: { gte: BIZ_INDEX_MIN_REVIEWS },
  snapshots: {
    some: {
      OR: [{ mapslyScore: { not: null } }, { pillarScore: { not: null } }],
    },
  },
} satisfies Prisma.BusinessWhereInput;
