/**
 * One-pager PDF data layer · F.6.
 *
 * Server-only data shaping for the agency one-pager PDF (the "closing
 * weapon" — a single-page printable artifact a salesperson hands a
 * prospect during a pitch). Consumed by `modules/reports/one-pager.tsx`
 * (the React-PDF document) and by `app/api/reports/one-pager/
 * [businessId]/route.ts` (the streaming endpoint).
 *
 * Source-of-truth tables (all latest-record reads):
 *
 *   - `Business`        · core profile + meta
 *   - `BusinessSnapshot` · Mapsly Score · MSI · communication score
 *   - `LighthouseAudit` · perf / SEO / LCP / schema / NAP
 *   - `Lead` + `AgencyMember` · cross-agency access gate (mirrors
 *     `modules/agency-portal/prospect-detail/queries.ts`)
 *
 * Per `.claude/rules/cache-components.md` Pattern 1:
 *
 *   - `'use cache'` + `cacheLife('hours')` · the one-pager is a
 *     printable artifact; hour-fresh is plenty.
 *   - `cacheTag('business-${slug}')` + `cacheTag('business-${slug}-lighthouse')`
 *     so weekly snapshot / lighthouse-audit crons revalidate this.
 *   - `cacheTag('agency-${agencyId}')` for cross-agency cascades.
 *   - Build-phase short-circuit: `NEXT_PHASE === 'phase-production-build'`
 *     returns `EMPTY_ONE_PAGER_DATA` so Vercel's Neon-less build worker
 *     prerenders cleanly (INC-27).
 *
 * Per `.claude/rules/security.md`:
 *
 *   - Cross-agency leak guard · the signed-in user must be an
 *     `AgencyMember` of an agency that has a `Lead` row for this
 *     business. We never distinguish "doesn't exist" from "not yours"
 *     — returning `null` for both prevents existence-probing.
 *
 * The data shape is intentionally flat (`OnePagerData`) so the
 * React-PDF renderer is a pure component over plain values — easy to
 * unit test by feeding synthetic data, with NO Prisma in the test
 * (per `.claude/rules/testing.md` § snapshot tests for compute).
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

/* ----------------------------------------------------------- types */

/** One pitch wedge · 3 are emitted per one-pager. */
export interface OnePagerPitchWedge {
  /** "1" / "2" / "3" · numbered ordering as printed. */
  index: 1 | 2 | 3;
  /** Headline · "Site loads in 4.2s — slowest in the local 3-pack". */
  headline: string;
  /** Evidence footer · concrete data point. */
  evidence: string;
}

/** One "what we'd fix in 30 days" bullet. */
export interface OnePagerFix {
  /** "Web perf" · "Profile completeness" · "Review management". */
  area: string;
  /** "Cut LCP by 60% — code-split + Image optimization". */
  action: string;
}

/** Flat, framework-free shape consumed by the React-PDF document. */
export interface OnePagerData {
  /** Business name · headline of the page. */
  businessName: string;
  /** "Brickell · Miami, FL" · single-line locale context. */
  cityLine: string;
  /** "Medical Spa" · category (or "—" placeholder). */
  category: string;
  /** Mapsly Score 0..10 formatted to 1 decimal ("6.2") or "—". */
  mapslyScore: string;
  /** "4.4 · 342 reviews" or "— · 0 reviews". */
  ratingLine: string;
  /** "Reply rate 0%" (derived from communicationScore). */
  replyRateLine: string;
  /** "Lighthouse 38" or "Lighthouse —". */
  performanceLine: string;
  /** "MSI #18 of 40" or "MSI —". */
  msiLine: string;
  /** Exactly 3 wedges. */
  pitchWedges: OnePagerPitchWedge[];
  /** Exactly 3 fixes. */
  fixes: OnePagerFix[];
  /** "Prepared by Anchor Local". */
  preparedBy: string;
  /** "May 21, 2026" · pre-formatted to caller locale. */
  preparedDate: string;
  /** Filename-safe slug · "solea-brickell-spa". */
  slug: string;
}

/**
 * Canonical empty shape · used for the Vercel build-phase guard,
 * not-found / cross-agency, and Prisma failures. EVERY field present
 * so TypeScript catches partial-shape regressions (INC-25).
 */
export const EMPTY_ONE_PAGER_DATA: OnePagerData = {
  businessName: "",
  cityLine: "",
  category: "",
  mapslyScore: "—",
  ratingLine: "— · 0 reviews",
  replyRateLine: "Reply rate —",
  performanceLine: "Lighthouse —",
  msiLine: "MSI —",
  pitchWedges: [],
  fixes: [],
  preparedBy: "",
  preparedDate: "",
  slug: "",
};

/* -------------------------------------------------------- formatters */

/** "Solea Brickell Spa" → "solea-brickell-spa" (for the filename). */
export function toFilenameSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** "Brickell · Miami, FL" from city + province. Either may be null. */
export function formatCityLine(input: {
  city: string | null;
  province: string | null;
}): string {
  const parts: string[] = [];
  if (input.city) parts.push(input.city);
  if (input.province) parts.push(input.province);
  return parts.join(", ");
}

/** Mapsly Score 0..10 → "6.2" or "—". */
export function formatMapslyScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "—";
  const clamped = Math.max(0, Math.min(10, score));
  return clamped.toFixed(1);
}

/** "4.4 · 342 reviews" · "— · 0 reviews" if no rating. */
export function formatRatingLine(input: {
  rating: number | null | undefined;
  reviewCount: number | null | undefined;
}): string {
  const r =
    input.rating != null && Number.isFinite(input.rating)
      ? input.rating.toFixed(1)
      : "—";
  const n = input.reviewCount ?? 0;
  return `${r} · ${n} reviews`;
}

/** communicationScore 0..1 → "Reply rate 87%" · null → "Reply rate —". */
export function formatReplyRateLine(
  communicationScore: number | null | undefined,
): string {
  if (communicationScore == null || !Number.isFinite(communicationScore)) {
    return "Reply rate —";
  }
  const pct = Math.round(Math.max(0, Math.min(1, communicationScore)) * 100);
  return `Reply rate ${pct}%`;
}

/** Lighthouse mobile Performance 0..100 → "Lighthouse 38" · null → "—". */
export function formatPerformanceLine(
  performance: number | null | undefined,
): string {
  if (performance == null || !Number.isFinite(performance)) {
    return "Lighthouse —";
  }
  return `Lighthouse ${Math.round(performance)}`;
}

/** MSI #rank of total · "MSI #18 of 40". */
export function formatMsiLine(input: {
  msiRank: number | null | undefined;
  msiTotal: number | null | undefined;
}): string {
  if (input.msiRank == null || input.msiTotal == null) return "MSI —";
  return `MSI #${input.msiRank} of ${input.msiTotal}`;
}

/* --------------------------------------------------- pure derivation */

/** Inputs accepted by `derivePitchWedges`. */
export interface DerivePitchWedgesInputs {
  rating: number | null;
  reviewCount: number;
  communicationScore: number | null;
  profileCompleteness: number | null;
  performance: number | null;
  lcpMs: number | null;
  hasLocalBusinessSchema: boolean | null;
  napConsistent: boolean | null;
  msiRank: number | null;
  msiTotal: number | null;
  category: string | null;
  city: string | null;
}

/**
 * Derive exactly 3 pitch wedges in priority order: web-perf →
 * reputation/reply → profile/local-SEO. Deterministic given inputs
 * so two reads return the same wedges.
 *
 * Each wedge surfaces the strongest evidence we have. If the relevant
 * field is null we fall back to a category/market-shape statement so
 * the artifact never prints "—" in the body.
 */
export function derivePitchWedges(
  input: DerivePitchWedgesInputs,
): OnePagerPitchWedge[] {
  const wedges: OnePagerPitchWedge[] = [];

  /* 1 · website performance — Tom's #1 sell wedge. */
  if (input.lcpMs != null && input.lcpMs > 2500) {
    const s = (input.lcpMs / 1000).toFixed(1);
    wedges.push({
      index: 1,
      headline: `Site loads in ${s}s — failing Core Web Vitals`,
      evidence: `LCP ${s}s · target ≤ 2.5s · Google ranks slow sites lower in local results`,
    });
  } else if (input.performance != null && input.performance < 50) {
    wedges.push({
      index: 1,
      headline: `Lighthouse mobile Performance ${Math.round(input.performance)} — poor`,
      evidence: `Mobile Performance ${Math.round(input.performance)}/100 · sub-50 is the bottom decile of local businesses`,
    });
  } else if (input.hasLocalBusinessSchema === false) {
    wedges.push({
      index: 1,
      headline: "No LocalBusiness schema markup",
      evidence:
        "Missing JSON-LD · prevents rich results in Google search · 30-min fix",
    });
  } else {
    const where = input.city ? `${input.city} ` : "";
    wedges.push({
      index: 1,
      headline: `Website edge over local ${where}competitors is unclaimed`,
      evidence:
        "Most local businesses ship slow, schema-less sites · we measured 60+ signals",
    });
  }

  /* 2 · reputation / reply rate — second strongest. */
  if (
    input.communicationScore != null &&
    input.communicationScore < 0.25 &&
    input.reviewCount > 0
  ) {
    const pct = Math.round(input.communicationScore * 100);
    wedges.push({
      index: 2,
      headline: `Reply rate ${pct}% across recent reviews`,
      evidence: `Benchmark ~89% · low replies signal disengaged operator · easy win`,
    });
  } else if (
    input.rating != null &&
    input.rating < 4.0 &&
    input.reviewCount > 5
  ) {
    wedges.push({
      index: 2,
      headline: `Rating ${input.rating.toFixed(1)} with ${input.reviewCount} reviews`,
      evidence: `Below 4.0 hurts local 3-pack ranking · review-management workflow needed`,
    });
  } else if (input.reviewCount < 20) {
    wedges.push({
      index: 2,
      headline: `Only ${input.reviewCount} Google reviews — low volume`,
      evidence:
        "Volume signals quality to Google · scripted ask-flow gets 10–15× returns",
    });
  } else {
    wedges.push({
      index: 2,
      headline: "Reputation surface has gaps we can close",
      evidence:
        "AI reply drafts + scripted review asks + sentiment tracking · monthly retainer",
    });
  }

  /* 3 · profile / local SEO / market position. */
  if (
    input.msiRank != null &&
    input.msiTotal != null &&
    input.msiTotal > 0 &&
    input.msiRank > input.msiTotal / 2
  ) {
    wedges.push({
      index: 3,
      headline: `MSI rank #${input.msiRank} of ${input.msiTotal} — bottom half`,
      evidence: `Market Share Index ranks visibility · top 3 captures ~70% of clicks`,
    });
  } else if (
    input.profileCompleteness != null &&
    input.profileCompleteness < 0.7
  ) {
    const pct = Math.round(input.profileCompleteness * 100);
    wedges.push({
      index: 3,
      headline: `Profile completeness ${pct}% — missing fields`,
      evidence: `Photos · hours · services · attributes · each field is a ranking signal`,
    });
  } else if (input.napConsistent === false) {
    wedges.push({
      index: 3,
      headline: "NAP inconsistencies detected across the web",
      evidence:
        "Name/Address/Phone mismatches across citations · hurts local pack trust",
    });
  } else {
    wedges.push({
      index: 3,
      headline: "Local SEO foundation has room to grow",
      evidence:
        "Citations · photos · attributes · review velocity · we'd tune each lever",
    });
  }

  return wedges;
}

/** Inputs to `deriveFixes`. */
export interface DeriveFixesInputs {
  performance: number | null;
  lcpMs: number | null;
  hasLocalBusinessSchema: boolean | null;
  profileCompleteness: number | null;
  communicationScore: number | null;
  reviewCount: number;
}

/**
 * Derive exactly 3 "what we'd fix in 30 days" bullets · ordered by
 * impact in the typical agency engagement: web perf → profile → reviews.
 */
export function deriveFixes(input: DeriveFixesInputs): OnePagerFix[] {
  const fixes: OnePagerFix[] = [];

  /* 1 · website. */
  if (input.lcpMs != null && input.lcpMs > 2500) {
    fixes.push({
      area: "Web performance",
      action: `Cut LCP from ${(input.lcpMs / 1000).toFixed(1)}s to under 2.0s · image opt + critical CSS`,
    });
  } else if (input.performance != null && input.performance < 80) {
    fixes.push({
      area: "Web performance",
      action: `Lift Lighthouse mobile Performance from ${Math.round(input.performance)} to 90+`,
    });
  } else if (input.hasLocalBusinessSchema === false) {
    fixes.push({
      area: "Schema & SEO",
      action:
        "Add LocalBusiness JSON-LD · enable rich results in Google search",
    });
  } else {
    fixes.push({
      area: "Web performance",
      action: "Ship Core Web Vitals improvements · LCP, CLS, INP under target",
    });
  }

  /* 2 · profile. */
  if (input.profileCompleteness != null && input.profileCompleteness < 0.85) {
    const pct = Math.round(input.profileCompleteness * 100);
    fixes.push({
      area: "Profile completeness",
      action: `Bring profile from ${pct}% to 100% · photos, hours, services, attributes`,
    });
  } else {
    fixes.push({
      area: "Profile completeness",
      action:
        "Refresh photos quarterly · tune services + attributes for keyword match",
    });
  }

  /* 3 · reviews. */
  if (input.communicationScore != null && input.communicationScore < 0.5) {
    const pct = Math.round(input.communicationScore * 100);
    fixes.push({
      area: "Review management",
      action: `Lift reply rate from ${pct}% to 90% · AI drafts + scheduled review-ask flow`,
    });
  } else if (input.reviewCount < 50) {
    fixes.push({
      area: "Review management",
      action: `Scale review volume from ${input.reviewCount} to 150+ in 30 days · scripted ask flow`,
    });
  } else {
    fixes.push({
      area: "Review management",
      action: "Owner replies on every review · sentiment-driven response tone",
    });
  }

  return fixes;
}

/* ------------------------------------------------------ query */

/**
 * Caller inputs · `userId` enforces the cross-agency leak guard.
 * `locale` selects the date formatter; we accept the raw locale
 * string (e.g. "en-US" / "fr-CA") so the caller's `setRequestLocale`
 * is the source of truth.
 */
export interface GetOnePagerDataOptions {
  businessId: string;
  userId: string;
  locale: string;
  /** Override "today" · undefined → server `new Date()`. Test-only. */
  now?: Date;
}

/**
 * Fetch + shape the one-pager payload. Returns `null` for build /
 * not-found / not-yours / error — the route handler maps `null` to a
 * 404 response.
 *
 * NOTE: We deliberately do NOT wrap this in `'use cache'` because the
 * route handler is a streaming PDF endpoint, not a React tree. Caching
 * a 25 KB PDF buffer per (business, locale) on the CDN is the right
 * layer — to be added in a follow-up via `Cache-Control` headers on
 * the response (F.6 ships uncached; the API call is rare enough that
 * cold-path latency is acceptable v1).
 */
export async function getOnePagerData(
  options: GetOnePagerDataOptions,
): Promise<OnePagerData | null> {
  const { businessId, userId, locale, now } = options;

  // Vercel build-phase guard · the build worker can't open Neon
  // WebSockets · INC-27.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return null;
  }

  if (!businessId || typeof businessId !== "string") return null;
  if (!userId || typeof userId !== "string") return null;

  try {
    // 1 · agency memberships
    const memberships = await prisma.agencyMember.findMany({
      where: { userId },
      select: { agencyId: true, agency: { select: { name: true } } },
    });
    if (memberships.length === 0) return null;
    const agencyIds = memberships.map((m) => m.agencyId);

    // 2 · cross-agency access gate · must have a Lead in one of the
    //   user's agencies for this business.
    const accessibleLead = await prisma.lead.findFirst({
      where: { businessId, agencyId: { in: agencyIds } },
      select: { agencyId: true },
    });
    if (!accessibleLead) return null;

    // Pick the agency name that owns the Lead (closest to the prospect
    // for the "prepared by" footer line).
    const owningAgency =
      memberships.find((m) => m.agencyId === accessibleLead.agencyId)?.agency ??
      memberships[0]!.agency;

    // 3 · business + latest snapshot + latest lighthouse audit
    const business = await prisma.business.findUnique({
      where: { id: businessId },
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
    if (!business) return null;

    const snap = business.snapshots[0] ?? null;
    const lh = business.lighthouseAudits[0] ?? null;

    const rating = snap?.rating ?? business.rating ?? null;
    const reviewCount = snap?.reviewCount ?? business.reviewCount ?? 0;
    const lcpMs = lh?.lcp != null ? Math.round(lh.lcp * 1000) : null;

    const today = now ?? new Date();
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return {
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
      preparedBy: `Prepared by ${owningAgency.name}`,
      preparedDate: dateFormatter.format(today),
      slug: toFilenameSlug(business.slug ?? business.name),
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "reports.one_pager.query_error",
        businessId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

/**
 * Cache-tag emitter · the route handler calls this BEFORE streaming
 * so the response is invalidated when the underlying snapshot /
 * lighthouse cron rewrites the source data. Split out from
 * `getOnePagerData` so we can call it once we know the slug.
 *
 * NOTE: cache-tag does not apply to the streaming Response itself
 * (cache-tag is for Next's data cache); we keep this helper exported
 * for a follow-up that caches the PDF buffer in KV.
 */
export function applyOnePagerCacheTags(input: {
  slug: string;
  agencyId: string;
}): void {
  cacheLife("hours");
  cacheTag(`business-${input.slug}`);
  cacheTag(`business-${input.slug}-lighthouse`);
  cacheTag(`agency-${input.agencyId}`);
}
