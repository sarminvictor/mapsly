/**
 * Agency prospect-detail page · server queries + pitch derivation.
 *
 * Surface: `getAgencyProspectDetailData(businessId, userId)` — returns
 * the page payload for `/(agency)/prospect/[businessId]`. Tom drills
 * into one business to see the full pitch (the "closing weapon").
 *
 * Returns `EMPTY_PROSPECT_DETAIL` (`prospect === null`) for the
 * not-found / not-yours / build-phase / Prisma-error cases — the page
 * checks `data.prospect === null` and calls `notFound()`.
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')` · the page renders from
 *     the latest snapshot, which cron writes weekly. Minutes is
 *     plenty fresh; tags below let us revalidate granularly.
 *   - `cacheTag('business-${businessId}')` · per-business scope; the
 *     weekly snapshot cron hits this tag.
 *   - `cacheTag('business-${businessId}-lighthouse')` · so a website
 *     audit re-run invalidates the page.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 we short-circuit
 * to `EMPTY_PROSPECT_DETAIL` for `NEXT_PHASE === 'phase-production-build'`
 * and for any Prisma failure. The EMPTY shape is the full
 * `AgencyProspectDetailData` so TS catches partial shapes at literal
 * comparison time (INC-25).
 *
 * Per `.claude/rules/security.md`: ownership check is mandatory before
 * we return any prospect data. We resolve the signed-in user's agency
 * memberships first, then assert the business has at least one `Lead`
 * row in one of those agencies. Anything else returns the EMPTY shape
 * — never leak existence across agencies (INC-style same posture as
 * list-detail).
 *
 * Per `.claude/rules/performance.md`:
 *
 *   - Explicit `select` on every Prisma query · no unbounded shapes.
 *   - Snapshot + lighthouse joined via `take: 1, orderBy: desc` to
 *     avoid N+1.
 *   - Prev/next nav scoped to the user's accessible leads, ordered
 *     by Lead.matchScore DESC then Business.id ASC — one extra
 *     round-trip total, capped at 1 row per direction.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_PROSPECT_DETAIL,
  type AgencyProspectDetailData,
  type ProspectAppearsInList,
  type ProspectDataSource,
  type ProspectLighthouseSummary,
  type ProspectPitchWedge,
  type ProspectRecord,
  type ProspectSeverity,
  type ProspectSignalBlock,
  type ProspectSnapshotSummary,
} from "./types";

/* ------------------------------------------------------------ helpers */

/** Stable 1..7 avatar tone derived from a business id (hash → mod). */
function avatarToneFromId(id: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  const tone = (Math.abs(h) % 7) + 1;
  return tone as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** "Solea Brickell Spa" → "SO"; single-word → first two letters uppercase. */
export function deriveAvatar(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

/** Format "701 S Miami Ave · Brickell · Miami, FL" from address parts. */
export function formatAddress(input: {
  address: string | null;
  city: string | null;
  province: string | null;
}): string {
  const parts: string[] = [];
  if (input.address) parts.push(input.address);
  if (input.city) parts.push(input.city);
  if (input.province) parts.push(input.province);
  return parts.join(" · ");
}

/** Inputs accepted by `derivePitchWedges`. */
export interface PitchInputs {
  rating: number | null;
  reviewCount: number;
  category: string | null;
  city: string | null;
  /** Communication-score proxy for reply rate · 0..1. */
  communicationScore: number | null;
  /** Profile completeness 0..1 · BusinessSnapshot.profileCompletenessScore. */
  profileCompleteness: number | null;
  /** Mapsly Score 0..10. */
  mapslyScore: number | null;
  msiRank: number | null;
  msiTotal: number | null;
  /** Lighthouse mobile Performance 0..100. */
  performance: number | null;
  /** LCP in milliseconds (after conversion from `LighthouseAudit.lcp` sec). */
  lcpMs: number | null;
  /** Has LocalBusiness JSON-LD schema. */
  hasLocalBusinessSchema: boolean | null;
  napConsistent: boolean | null;
}

/**
 * Derive exactly 4 pitch wedges from the input facts.
 *
 * Order: critical first, then warn, then ok. Pads with deterministic
 * "ok" wedges (rating / location / category facts) so the page always
 * renders 4 numbered bullets — this is the closing weapon, never
 * empty.
 *
 * Pure function · no Prisma, no Date.now() · testable in isolation
 * per `.claude/rules/testing.md`.
 */
export function derivePitchWedges(input: PitchInputs): ProspectPitchWedge[] {
  const wedges: ProspectPitchWedge[] = [];

  // ---- critical (red): they're bleeding ---------------------------
  if (
    input.communicationScore != null &&
    input.communicationScore < 0.3 &&
    input.reviewCount >= 50
  ) {
    const replyPct = Math.round(input.communicationScore * 100);
    const unanswered = Math.round(input.reviewCount * (1 - input.communicationScore));
    wedges.push({
      headline: `Reply rate ${replyPct}% · ${unanswered} reviews unanswered`,
      evidence: `${input.reviewCount} reviews on file · benchmark 89%`,
      severity: "critical",
    });
  }

  if (input.napConsistent === false) {
    wedges.push({
      headline: "NAP inconsistent across listings",
      evidence: "Name/Address/Phone mismatch · Google reads as multiple records",
      severity: "critical",
    });
  }

  // ---- warn (amber): they're underperforming ----------------------
  if (input.performance != null && input.performance < 60) {
    const perfRounded = Math.round(input.performance);
    const lcpStr =
      input.lcpMs != null ? ` · LCP ${(input.lcpMs / 1000).toFixed(1)}s` : "";
    wedges.push({
      headline: `Website grade ${perfRounded}/100${lcpStr}`,
      evidence: "Lighthouse mobile · target ≥ 90 · LCP target < 2.5s",
      severity: "warn",
    });
  }

  if (input.profileCompleteness != null && input.profileCompleteness < 0.6) {
    const pct = Math.round(input.profileCompleteness * 100);
    wedges.push({
      headline: `Profile ${pct}% complete`,
      evidence: "Google profile fields missing · cuts indexing surface",
      severity: "warn",
    });
  }

  if (input.hasLocalBusinessSchema === false) {
    wedges.push({
      headline: "No LocalBusiness schema on site",
      evidence: "Missing JSON-LD · hurts rich-result eligibility",
      severity: "warn",
    });
  }

  if (
    input.msiRank != null &&
    input.msiTotal != null &&
    input.msiTotal > 0 &&
    input.msiRank / input.msiTotal > 0.6
  ) {
    wedges.push({
      headline: `MSI rank #${input.msiRank} of ${input.msiTotal}`,
      evidence: "Bottom 40% of their metro · room to climb",
      severity: "warn",
    });
  }

  // ---- ok (success / bragging right) ------------------------------
  if (input.rating != null && input.rating >= 4.5 && input.reviewCount >= 200) {
    wedges.push({
      headline: `Strong reputation · ${input.rating.toFixed(1)}★ across ${input.reviewCount} reviews`,
      evidence: "Above the 4.5★ industry threshold · solid foundation",
      severity: "ok",
    });
  }

  if (input.mapslyScore != null && input.mapslyScore >= 7) {
    wedges.push({
      headline: `Mapsly Score ${input.mapslyScore.toFixed(1)}/10`,
      evidence: "Top-tier composite · multi-dimensional strength",
      severity: "ok",
    });
  }

  // ---- pad to exactly 4 with deterministic "ok" facts -------------
  // Order matters: critical/warn already appended in priority order.
  const ordered: ProspectPitchWedge[] = [
    ...wedges.filter((w) => w.severity === "critical"),
    ...wedges.filter((w) => w.severity === "warn"),
    ...wedges.filter((w) => w.severity === "ok"),
  ];

  while (ordered.length < 4) {
    // Each pad picks the next available factual fallback that hasn't
    // already been emitted (compared by headline).
    const padCandidates: ProspectPitchWedge[] = [];

    if (input.rating != null) {
      padCandidates.push({
        headline: `Rating ${input.rating.toFixed(1)}★ · ${input.reviewCount} reviews`,
        evidence: "Baseline reputation snapshot",
        severity: "ok",
      });
    }
    if (input.category) {
      padCandidates.push({
        headline: `Category · ${input.category}`,
        evidence: input.city ? `Operating in ${input.city}` : "Active local business",
        severity: "ok",
      });
    }
    if (input.city) {
      padCandidates.push({
        headline: `Located in ${input.city}`,
        evidence: "Geo anchor for local-SEO pitch",
        severity: "ok",
      });
    }
    padCandidates.push({
      headline: "Active Google profile",
      evidence: "Indexed business · accessible signal surface",
      severity: "ok",
    });

    const next = padCandidates.find(
      (c) => !ordered.some((o) => o.headline === c.headline),
    );
    if (!next) break;
    ordered.push(next);
  }

  return ordered.slice(0, 4);
}

/** Inputs to `deriveSignalBlocks`. */
export interface SignalBlocksInputs {
  rating: number | null;
  reviewCount: number;
  communicationScore: number | null;
  msiRank: number | null;
  msiTotal: number | null;
  performance: number | null;
  seo: number | null;
  lcpMs: number | null;
  clsScore: number | null;
  hasLocalBusinessSchema: boolean | null;
  napConsistent: boolean | null;
  /** i18n-resolved titles supplied by the page. */
  titles: Record<"reviews" | "competitors" | "search" | "ads" | "website", string>;
  emptyPlaceholder: string;
}

/**
 * Build the 5 signal blocks rendered on the detail page. Each block
 * gets 3..6 dense bullets pulled from facts we already have in DB.
 * If a block has no data we still emit it with the empty placeholder
 * so the page layout is stable.
 */
export function deriveSignalBlocks(
  input: SignalBlocksInputs,
): ProspectSignalBlock[] {
  const blocks: ProspectSignalBlock[] = [];

  /* ---------------- Reviews ---------------- */
  {
    const bullets: string[] = [];
    let severity: ProspectSeverity = "ok";
    if (input.rating != null) {
      bullets.push(`Rating ${input.rating.toFixed(1)}★ · ${input.reviewCount} reviews`);
    } else if (input.reviewCount > 0) {
      bullets.push(`${input.reviewCount} reviews on file`);
    }
    if (input.communicationScore != null) {
      const replyPct = Math.round(input.communicationScore * 100);
      bullets.push(`Owner reply rate ${replyPct}% · benchmark 89%`);
      if (input.communicationScore < 0.3) severity = "critical";
      else if (input.communicationScore < 0.6) severity = "warn";
    }
    if (input.rating != null && input.rating < 4.0) {
      bullets.push(`Rating below 4.0★ threshold · opportunity to manage`);
      if (severity !== "critical") severity = "warn";
    }
    if (bullets.length === 0) bullets.push(input.emptyPlaceholder);
    blocks.push({
      key: "reviews",
      title: input.titles.reviews,
      summaryLine: `${bullets.length} signal${bullets.length === 1 ? "" : "s"} · reputation surface`,
      bullets,
      severity,
    });
  }

  /* ---------------- Competitors ---------------- */
  {
    const bullets: string[] = [];
    let severity: ProspectSeverity = "ok";
    if (input.msiRank != null && input.msiTotal != null && input.msiTotal > 0) {
      const pctBucket = input.msiRank / input.msiTotal;
      bullets.push(`MSI rank #${input.msiRank} of ${input.msiTotal} in metro`);
      if (pctBucket > 0.6) severity = "warn";
    }
    if (input.rating != null && input.rating < 4.5) {
      const gap = (4.5 - input.rating).toFixed(1);
      bullets.push(`−${gap} rating gap vs typical 4.5★ leader`);
    }
    if (bullets.length === 0) bullets.push(input.emptyPlaceholder);
    blocks.push({
      key: "competitors",
      title: input.titles.competitors,
      summaryLine: "competitive pressure · metro context",
      bullets,
      severity,
    });
  }

  /* ---------------- Search ---------------- */
  {
    const bullets: string[] = [];
    let severity: ProspectSeverity = "ok";
    if (input.seo != null) {
      bullets.push(`Lighthouse SEO ${Math.round(input.seo)}/100`);
      if (input.seo < 80) severity = "warn";
    }
    if (input.hasLocalBusinessSchema === false) {
      bullets.push("Missing LocalBusiness JSON-LD · rich-result blocker");
      severity = "warn";
    }
    if (input.napConsistent === false) {
      bullets.push("NAP inconsistent · Google reads as multiple records");
      severity = "critical";
    }
    if (bullets.length === 0) bullets.push(input.emptyPlaceholder);
    blocks.push({
      key: "search",
      title: input.titles.search,
      summaryLine: "local-SEO surface · indexing health",
      bullets,
      severity,
    });
  }

  /* ---------------- Ads ---------------- */
  {
    // We don't have ad-library data wired through this query yet
    // (C.5 ships the adapter; F.4 doesn't refetch). The block stays
    // present with an empty placeholder so the layout matches the
    // reference design.
    blocks.push({
      key: "ads",
      title: input.titles.ads,
      summaryLine: "paid surface · refresh due next daily run",
      bullets: [input.emptyPlaceholder],
      severity: "ok",
    });
  }

  /* ---------------- Website ---------------- */
  {
    const bullets: string[] = [];
    let severity: ProspectSeverity = "ok";
    if (input.performance != null) {
      bullets.push(`Lighthouse Performance ${Math.round(input.performance)}/100`);
      if (input.performance < 50) severity = "critical";
      else if (input.performance < 70) severity = "warn";
    }
    if (input.lcpMs != null) {
      const lcpStr = (input.lcpMs / 1000).toFixed(1);
      bullets.push(`LCP ${lcpStr}s · target < 2.5s`);
      if (input.lcpMs > 4000 && severity !== "critical") severity = "warn";
    }
    if (input.clsScore != null) {
      bullets.push(`CLS ${input.clsScore.toFixed(2)} · target < 0.1`);
    }
    if (bullets.length === 0) bullets.push(input.emptyPlaceholder);
    blocks.push({
      key: "website",
      title: input.titles.website,
      summaryLine: "site health · Lighthouse mobile",
      bullets,
      severity,
    });
  }

  return blocks;
}

/* ----------------------------------------------------------- main fn */

/**
 * Fetch the prospect-detail payload for `/(agency)/prospect/[businessId]`.
 *
 * @param businessId  Prisma `Business.id` (cuid).
 * @param userId      The signed-in user's id (NOT the agency id).
 *
 * Returns `EMPTY_PROSPECT_DETAIL` (prospect===null) for not-found,
 * cross-agency, Vercel build phase, or Prisma error. The caller
 * redirects with `notFound()` so the not-found.tsx shell renders.
 */
export async function getAgencyProspectDetailData(
  businessId: string,
  userId: string,
): Promise<AgencyProspectDetailData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`business-${businessId}`);
  cacheTag(`business-${businessId}-lighthouse`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_PROSPECT_DETAIL;
  }

  if (!businessId || !userId || typeof businessId !== "string") {
    return EMPTY_PROSPECT_DETAIL;
  }

  try {
    // 1. Resolve the signed-in user's agency memberships first.
    //    Empty set → user can't see any prospect, short-circuit.
    const memberships = await prisma.agencyMember.findMany({
      where: { userId },
      select: { agencyId: true },
    });
    if (memberships.length === 0) {
      return EMPTY_PROSPECT_DETAIL;
    }
    const agencyIds = memberships.map((m) => m.agencyId);

    // 2. The business must have at least one Lead row in one of the
    //    user's agencies — otherwise we treat it as "doesn't exist"
    //    from this user's perspective.
    const accessibleLead = await prisma.lead.findFirst({
      where: { businessId, agencyId: { in: agencyIds } },
      select: { id: true, agencyId: true, matchScore: true },
      orderBy: [
        { matchScore: { sort: "desc", nulls: "last" } },
        { id: "asc" },
      ],
    });
    if (!accessibleLead) {
      return EMPTY_PROSPECT_DETAIL;
    }

    // Co-tag the cache · an agency-wide refresh (e.g. settings change)
    // invalidates this page too. The `agency-${id}` tag is also used
    // by list-detail queries — granular invalidation propagates.
    cacheTag(`agency-${accessibleLead.agencyId}`);

    // 3. Business row + latest snapshot + latest lighthouse audit in
    //    a single round-trip via Prisma `include` + take:1.
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        province: true,
        category: true,
        rating: true,
        reviewCount: true,
        website: true,
        phone: true,
        updatedAt: true,
        snapshots: {
          orderBy: { snapshotDate: "desc" },
          take: 1,
          select: {
            snapshotDate: true,
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
            auditedAt: true,
            performance: true,
            seo: true,
            lcp: true,
            cls: true,
            hasLocalBusinessSchema: true,
            napConsistent: true,
          },
        },
      },
    });
    if (!business) {
      return EMPTY_PROSPECT_DETAIL;
    }

    const snap = business.snapshots[0];
    const lh = business.lighthouseAudits[0];

    // Source-of-truth rating / reviewCount · prefer the latest
    // snapshot if present (it's the cron-written truth), else the
    // Business row itself.
    const rating = snap?.rating ?? business.rating ?? null;
    const reviewCount = snap?.reviewCount ?? business.reviewCount ?? 0;

    const snapshot: ProspectSnapshotSummary | null = snap
      ? {
          mapslyScore: snap.mapslyScore ?? null,
          msiRank: snap.msiRank ?? null,
          msiTotal: snap.msiTotal ?? null,
          communicationScore: snap.communicationScore ?? null,
          profileCompleteness: snap.profileCompletenessScore ?? null,
        }
      : null;

    const lcpMs = lh?.lcp != null ? Math.round(lh.lcp * 1000) : null;
    const lighthouse: ProspectLighthouseSummary | null = lh
      ? {
          performance: lh.performance ?? null,
          seo: lh.seo ?? null,
          lcpMs,
          clsScore: lh.cls ?? null,
        }
      : null;

    // 4. Lists the business appears in · only those visible to the
    //    user's agencies.
    const appearsInLeadRows = await prisma.lead.findMany({
      where: { businessId, agencyId: { in: agencyIds } },
      select: {
        list: {
          select: {
            id: true,
            name: true,
            serviceType: true,
          },
        },
      },
      take: 12,
    });
    const appearsInLists: ProspectAppearsInList[] = appearsInLeadRows
      .map((row) => row.list)
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map((l) => ({
        id: l.id,
        name: l.name,
        serviceType: l.serviceType ?? null,
      }));

    // 5. Prev / next nav across the user's accessible leads, ordered
    //    by matchScore DESC then id ASC. We anchor by `accessibleLead`
    //    above; one extra round-trip per direction, capped at 1 row.
    //    Note: `findFirst` with a cursor isn't quite right here
    //    because Prisma's cursor pagination is brittle across nullable
    //    sort columns — we resolve neighbors by scanning the ordered
    //    set of (matchScore, id) tuples and picking the immediate
    //    predecessor / successor of accessibleLead.id.
    const orderedLeads = await prisma.lead.findMany({
      where: { agencyId: { in: agencyIds } },
      select: { id: true, businessId: true, matchScore: true },
      orderBy: [
        { matchScore: { sort: "desc", nulls: "last" } },
        { id: "asc" },
      ],
      take: 500,
    });
    let prevProspectId: string | null = null;
    let nextProspectId: string | null = null;
    const anchorIdx = orderedLeads.findIndex((l) => l.id === accessibleLead.id);
    if (anchorIdx >= 0) {
      // Skip same-business neighbors (a business may be on multiple
      // lists) so the user actually moves to a different prospect.
      for (let i = anchorIdx - 1; i >= 0; i--) {
        if (orderedLeads[i]!.businessId !== businessId) {
          prevProspectId = orderedLeads[i]!.businessId;
          break;
        }
      }
      for (let i = anchorIdx + 1; i < orderedLeads.length; i++) {
        if (orderedLeads[i]!.businessId !== businessId) {
          nextProspectId = orderedLeads[i]!.businessId;
          break;
        }
      }
    }

    // 6. Compute pitch wedges + signal blocks deterministically.
    const pitchWedges = derivePitchWedges({
      rating,
      reviewCount,
      category: business.category ?? null,
      city: business.city ?? null,
      communicationScore: snap?.communicationScore ?? null,
      profileCompleteness: snap?.profileCompletenessScore ?? null,
      mapslyScore: snap?.mapslyScore ?? null,
      msiRank: snap?.msiRank ?? null,
      msiTotal: snap?.msiTotal ?? null,
      performance: lh?.performance ?? null,
      lcpMs,
      hasLocalBusinessSchema: lh?.hasLocalBusinessSchema ?? null,
      napConsistent: lh?.napConsistent ?? null,
    });

    // Titles are filled in by the page from i18n; here we use stable
    // English fallbacks so the queries layer stays UI-framework-free.
    const signalBlocks = deriveSignalBlocks({
      rating,
      reviewCount,
      communicationScore: snap?.communicationScore ?? null,
      msiRank: snap?.msiRank ?? null,
      msiTotal: snap?.msiTotal ?? null,
      performance: lh?.performance ?? null,
      seo: lh?.seo ?? null,
      lcpMs,
      clsScore: lh?.cls ?? null,
      hasLocalBusinessSchema: lh?.hasLocalBusinessSchema ?? null,
      napConsistent: lh?.napConsistent ?? null,
      titles: {
        reviews: "Reviews & reputation",
        competitors: "Competitive pressure",
        search: "Search & SEO",
        ads: "Active ads",
        website: "Website health",
      },
      emptyPlaceholder: "No data yet · refresh due next cron",
    });

    const refreshedAtSource =
      snap?.snapshotDate ?? lh?.auditedAt ?? business.updatedAt;
    const refreshedAt = refreshedAtSource.toISOString();

    const dataSources: ProspectDataSource[] = [];
    if (snap) {
      dataSources.push({
        label: "Snapshot",
        refreshedAt: snap.snapshotDate.toISOString(),
      });
    }
    if (lh) {
      dataSources.push({
        label: "Lighthouse audit",
        refreshedAt: lh.auditedAt.toISOString(),
      });
    }
    dataSources.push({
      label: "Business profile",
      refreshedAt: business.updatedAt.toISOString(),
    });

    const prospect: ProspectRecord = {
      id: business.id,
      name: business.name,
      avatarInitials: deriveAvatar(business.name),
      avatarTone: avatarToneFromId(business.id),
      address: formatAddress({
        address: business.address ?? null,
        city: business.city ?? null,
        province: business.province ?? null,
      }),
      city: business.city ?? null,
      province: business.province ?? null,
      category: business.category ?? null,
      rating,
      reviewCount,
      websiteUrl: business.website ?? null,
      phone: business.phone ?? null,
      refreshedAt,
      snapshot,
      lighthouse,
      pitchWedges,
      signalBlocks,
      appearsInLists,
      dataSources,
    };

    return {
      prospect,
      prevProspectId,
      nextProspectId,
    };
  } catch {
    return EMPTY_PROSPECT_DETAIL;
  }
}
