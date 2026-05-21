/**
 * Share-link data layer · F.8.
 *
 * Public, view-only share artifacts. An agency user generates a
 * shareable URL (`/share/{publicShareId}`) and sends it to a prospect
 * over email / SMS / chat. The recipient sees a branded HTML view of
 * the prospect summary (same shape as the one-pager) without signing
 * in. Each share has a 30-day expiry; after expiry the page renders
 * a friendly "this link has expired" state.
 *
 * Source-of-truth row: `Report` (type=SHARE_LINK · publicShareId
 * unique · shareExpiresAt set 30 days out · viewCount incremented per
 * visit).
 *
 * Per `.claude/rules/security.md`:
 *
 *   - `publicShareId` is generated via `crypto.randomUUID()` with
 *     hyphens stripped (32 hex chars · ~128 bits of entropy ·
 *     unguessable by brute force).
 *   - The Report is the authorization token. Anyone with the URL
 *     sees the content. Pre-share rate-limits + the 30-day expiry
 *     bound exposure.
 *   - Cross-agency leak guard at create time · the calling user must
 *     be an `AgencyMember` of an agency that has a `Lead` row for
 *     this business. Mirrors
 *     `modules/agency-portal/prospect-detail/queries.ts`.
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - `'use cache'` short-circuits via the `NEXT_PHASE` guard so the
 *     Vercel build worker (which can't open Neon WebSockets) returns
 *     `null` instead of crashing prerender (Pattern 1 · INC-27).
 *   - `cacheTag` is set per-share so future revocation can invalidate
 *     a specific link.
 *
 * View-count increments live OUTSIDE the cache · they are intentional
 * writes that should fire on every real visit, not be served from
 * the cached read.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import {
  type OnePagerData,
  derivePitchWedges,
  deriveFixes,
  formatCityLine,
  formatMapslyScore,
  formatMsiLine,
  formatPerformanceLine,
  formatRatingLine,
  formatReplyRateLine,
  toFilenameSlug,
} from "./one-pager-data";

/* ============================================================ types */

/** Result of a successful share-link create / get. */
export interface ShareLinkRecord {
  /** 32-hex-char URL-safe id · used in `/share/{id}`. */
  publicShareId: string;
  /** Underlying `Report.id` · for view-count writes. */
  reportId: string;
  /** Expiry timestamp. */
  expiresAt: Date;
  /** True iff this row was just created (vs. reused). */
  isNew: boolean;
}

/** Result of looking up a share for the public-facing page. */
export interface ShareableReport {
  /** Underlying `Report.id` · used for view-count increments. */
  reportId: string;
  /** The prospect data, same shape as F.6 one-pager. */
  data: OnePagerData;
  /** Expiry timestamp. */
  expiresAt: Date;
  /** Current view count (pre-increment for this request). */
  viewCount: number;
  /** Pre-formatted "29 days remaining" / "2 hours remaining". */
  remainingLabel: string;
}

/** Discriminated state for the public page. */
export type ShareLookupResult =
  | { status: "ok"; report: ShareableReport }
  | { status: "not_found" }
  | { status: "expired"; expiresAt: Date };

/** Inputs for `getOrCreateShareLink`. */
export interface GetOrCreateShareLinkOptions {
  businessId: string;
  userId: string;
  /** Days until expiry · default 30. */
  ttlDays?: number;
  /** Override "now" · test-only. */
  now?: Date;
}

/* ====================================================== formatters */

/** 30-day default. */
export const DEFAULT_SHARE_TTL_DAYS = 30;

/**
 * `crypto.randomUUID()` → 32 hex chars · URL-safe, ~128 bits entropy,
 * indistinguishable-from-random per RFC 4122 v4. We strip hyphens for
 * tighter URLs (`/share/a1b2c3d4...` vs `/share/a1b2c3d4-...`).
 */
export function generatePublicShareId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

/** Validate a share-id shape · 32 lowercase hex chars · no I/O. */
export function isValidPublicShareId(input: unknown): input is string {
  return typeof input === "string" && /^[a-f0-9]{32}$/.test(input);
}

/** "29 days remaining" / "2 hours remaining" / "expires soon". */
export function formatRemainingLabel(input: {
  now: Date;
  expiresAt: Date;
}): string {
  const msLeft = input.expiresAt.getTime() - input.now.getTime();
  if (msLeft <= 0) return "Expired";
  const minutes = Math.floor(msLeft / 60_000);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} remaining`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

/**
 * Build the absolute share URL from a `publicShareId` and the request
 * origin. We resolve the origin in the action layer (from
 * `NEXT_PUBLIC_APP_URL` or the request's `Host` header) so this
 * helper stays pure.
 */
export function buildShareUrl(input: {
  origin: string;
  publicShareId: string;
}): string {
  const trimmed = input.origin.replace(/\/+$/, "");
  return `${trimmed}/share/${input.publicShareId}`;
}

/* =================================================== create / get */

/**
 * Idempotently get-or-create the active share link for a (agency,
 * business) pair. If a non-expired SHARE_LINK Report already exists
 * for the calling agency + business, we return it. Otherwise we
 * insert a fresh row.
 *
 * Returns `null` when the user is unauthorized for this business
 * (anonymous / no agency / cross-agency probe).
 */
export async function getOrCreateShareLink(
  options: GetOrCreateShareLinkOptions,
): Promise<ShareLinkRecord | null> {
  const ttlDays = options.ttlDays ?? DEFAULT_SHARE_TTL_DAYS;
  const now = options.now ?? new Date();

  if (process.env.NEXT_PHASE === "phase-production-build") return null;
  if (!options.businessId || typeof options.businessId !== "string") {
    return null;
  }
  if (!options.userId || typeof options.userId !== "string") return null;
  if (!Number.isFinite(ttlDays) || ttlDays <= 0 || ttlDays > 365) {
    return null;
  }

  try {
    // 1 · agency memberships + cross-agency access gate
    const memberships = await prisma.agencyMember.findMany({
      where: { userId: options.userId },
      select: { agencyId: true },
    });
    if (memberships.length === 0) return null;
    const agencyIds = memberships.map((m) => m.agencyId);

    const accessibleLead = await prisma.lead.findFirst({
      where: { businessId: options.businessId, agencyId: { in: agencyIds } },
      select: { agencyId: true },
    });
    if (!accessibleLead) return null;
    const owningAgencyId = accessibleLead.agencyId;

    // 2 · look for an existing non-expired share for this pair
    const existing = await prisma.report.findFirst({
      where: {
        agencyId: owningAgencyId,
        businessId: options.businessId,
        type: "SHARE_LINK",
        publicShareId: { not: null },
        shareExpiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        publicShareId: true,
        shareExpiresAt: true,
      },
    });

    if (
      existing &&
      existing.publicShareId &&
      existing.shareExpiresAt &&
      existing.shareExpiresAt.getTime() > now.getTime()
    ) {
      return {
        publicShareId: existing.publicShareId,
        reportId: existing.id,
        expiresAt: existing.shareExpiresAt,
        isNew: false,
      };
    }

    // 3 · create a fresh share
    const publicShareId = generatePublicShareId();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

    const created = await prisma.report.create({
      data: {
        agencyId: owningAgencyId,
        businessId: options.businessId,
        type: "SHARE_LINK",
        status: "SHARED",
        publicShareId,
        shareExpiresAt: expiresAt,
        meta: { ttlDays, createdViaUserId: options.userId },
      },
      select: { id: true, publicShareId: true, shareExpiresAt: true },
    });

    return {
      publicShareId: created.publicShareId ?? publicShareId,
      reportId: created.id,
      expiresAt: created.shareExpiresAt ?? expiresAt,
      isNew: true,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "reports.share_link.create_error",
        businessId: options.businessId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

/* ============================================== public-page lookup */

/**
 * Look up a share by its public ID and shape the data for the public
 * `/share/[publicShareId]` page. Cached via `'use cache'` so repeated
 * visits hit the data cache; the `cacheTag('share-${id}')` lets a
 * future "revoke share" action invalidate one record without flushing
 * adjacent cache entries.
 *
 * The actual view-count increment happens OUTSIDE the cache — see
 * `incrementShareViewCount`.
 */
export async function getShareableReport(
  publicShareId: string,
  locale: string,
  now?: Date,
): Promise<ShareLookupResult> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`share-${publicShareId}`);

  // Vercel build-phase guard · INC-27.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return { status: "not_found" };
  }

  if (!isValidPublicShareId(publicShareId)) return { status: "not_found" };

  const today = now ?? new Date();

  try {
    const report = await prisma.report.findUnique({
      where: { publicShareId },
      select: {
        id: true,
        agencyId: true,
        businessId: true,
        shareExpiresAt: true,
        viewCount: true,
        agency: { select: { name: true } },
      },
    });

    if (!report || !report.businessId) return { status: "not_found" };
    if (!report.shareExpiresAt) return { status: "not_found" };

    if (report.shareExpiresAt.getTime() <= today.getTime()) {
      return { status: "expired", expiresAt: report.shareExpiresAt };
    }

    const business = await prisma.business.findUnique({
      where: { id: report.businessId },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        city: true,
        province: true,
        rating: true,
        reviewCount: true,
        snapshots: {
          orderBy: { snapshotDate: "desc" },
          take: 1,
          select: {
            mapslyScore: true,
            msiRank: true,
            msiTotal: true,
            communicationScore: true,
            profileCompletenessScore: true,
            rating: true,
            reviewCount: true,
          },
        },
        lighthouseAudits: {
          orderBy: { auditedAt: "desc" },
          take: 1,
          select: {
            performance: true,
            lcp: true,
            hasLocalBusinessSchema: true,
            napConsistent: true,
          },
        },
      },
    });

    if (!business) {
      // Report references a business that no longer exists · treat as
      // not_found rather than expired so the recipient sees the same
      // gentle copy.
      return { status: "not_found" };
    }

    // Tag the underlying business so weekly snapshot crons revalidate.
    if (business.slug) {
      cacheTag(`business-${business.slug}`);
      cacheTag(`business-${business.slug}-lighthouse`);
    }
    cacheTag(`agency-${report.agencyId}`);

    const snap = business.snapshots[0] ?? null;
    const lh = business.lighthouseAudits[0] ?? null;

    const rating = snap?.rating ?? business.rating ?? null;
    const reviewCount = snap?.reviewCount ?? business.reviewCount ?? 0;
    const lcpMs = lh?.lcp != null ? Math.round(lh.lcp * 1000) : null;

    const dateFormatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const data: OnePagerData = {
      businessName: business.name,
      cityLine: formatCityLine({
        city: business.city ?? null,
        province: business.province ?? null,
      }),
      category: business.category ?? "—",
      mapslyScore: formatMapslyScore(snap?.mapslyScore ?? null),
      ratingLine: formatRatingLine({ rating, reviewCount }),
      replyRateLine: formatReplyRateLine(snap?.communicationScore ?? null),
      performanceLine: formatPerformanceLine(lh?.performance ?? null),
      msiLine: formatMsiLine({
        msiRank: snap?.msiRank ?? null,
        msiTotal: snap?.msiTotal ?? null,
      }),
      pitchWedges: derivePitchWedges({
        rating,
        reviewCount,
        communicationScore: snap?.communicationScore ?? null,
        profileCompleteness: snap?.profileCompletenessScore ?? null,
        performance: lh?.performance ?? null,
        lcpMs,
        hasLocalBusinessSchema: lh?.hasLocalBusinessSchema ?? null,
        napConsistent: lh?.napConsistent ?? null,
        msiRank: snap?.msiRank ?? null,
        msiTotal: snap?.msiTotal ?? null,
        category: business.category ?? null,
        city: business.city ?? null,
      }),
      fixes: deriveFixes({
        performance: lh?.performance ?? null,
        lcpMs,
        hasLocalBusinessSchema: lh?.hasLocalBusinessSchema ?? null,
        profileCompleteness: snap?.profileCompletenessScore ?? null,
        communicationScore: snap?.communicationScore ?? null,
        reviewCount,
      }),
      preparedBy: `Prepared by ${report.agency.name}`,
      preparedDate: dateFormatter.format(today),
      slug: toFilenameSlug(business.slug ?? business.name),
    };

    return {
      status: "ok",
      report: {
        reportId: report.id,
        data,
        expiresAt: report.shareExpiresAt,
        viewCount: report.viewCount,
        remainingLabel: formatRemainingLabel({
          now: today,
          expiresAt: report.shareExpiresAt,
        }),
      },
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "reports.share_link.lookup_error",
        publicShareId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Fall back to not_found so the recipient gets the gentle copy
    // instead of an HTTP 500. The structured log captures the cause.
    return { status: "not_found" };
  }
}

/**
 * Increment the share's `viewCount`. Called fire-and-forget from
 * `app/[locale]/share/[publicShareId]/page.tsx` so the response is
 * never blocked. We deliberately do NOT `revalidateTag` the share
 * here — visitors should see a near-instant page; the count is for
 * the agency's analytics, not for branching display logic.
 *
 * Returns `null` if the publicShareId doesn't exist (so callers can
 * no-op silently).
 */
export async function incrementShareViewCount(
  publicShareId: string,
): Promise<{ newCount: number } | null> {
  if (process.env.NEXT_PHASE === "phase-production-build") return null;
  if (!isValidPublicShareId(publicShareId)) return null;

  try {
    const updated = await prisma.report.update({
      where: { publicShareId },
      data: { viewCount: { increment: 1 } },
      select: { viewCount: true },
    });
    return { newCount: updated.viewCount };
  } catch (err) {
    // Most likely cause: publicShareId not found · log + swallow.
    console.error(
      JSON.stringify({
        level: "warning",
        event: "reports.share_link.view_count_increment_failed",
        publicShareId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

/* ===================================================== fallback data */

/**
 * Build-phase / not-found rendering uses the F.6 EMPTY_ONE_PAGER_DATA
 * so the React tree never crashes during prerender. Re-exported for
 * unit-test convenience.
 */
export { EMPTY_ONE_PAGER_DATA } from "./one-pager-data";
