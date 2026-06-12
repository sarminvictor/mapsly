/**
 * SMB website health · server query.
 *
 * Surface: `getSmbWebsiteData(userId)` — pulls the latest
 * LighthouseAudit for Maria's owned business and renders it through
 * the plain-English derivation helpers in `./types.ts`. The whole
 * page is the output of these helpers; the page-level rendering
 * just lays them out.
 *
 * Per `.claude/rules/caching.md` · `'use cache'` + cacheLife hours
 * (Lighthouse runs weekly via the C.7 cron).
 * Per `.claude/rules/cache-components.md` Pattern 1 · NEXT_PHASE
 * guard + EMPTY shape return.
 * Per `.claude/rules/ui-ux-smb.md` · every user-visible label flows
 * through types.ts's derive functions — none of the banned jargon
 * (LCP, INP, CLS, schema, NAP) reaches the page.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_SMB_WEBSITE,
  deriveWebsiteFixes,
  verdictForCls,
  verdictForInp,
  verdictForLcp,
  verdictForPerf,
  toneForSeo,
  type SmbWebsiteData,
  type WebsiteCheck,
  type WebsiteCompetitor,
  type WebsiteSpeedSignal,
} from "./types";

export async function getSmbWebsiteData(
  userId: string,
): Promise<SmbWebsiteData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`smb-website-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_WEBSITE;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_WEBSITE;
  }

  try {
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        website: true,
        category: true,
        city: true,
        country: true,
        lighthouseAudits: {
          take: 1,
          orderBy: { auditedAt: "desc" },
          select: {
            performance: true,
            seo: true,
            lcp: true,
            inp: true,
            cls: true,
            desktopPerformance: true,
            desktopLcp: true,
            desktopInp: true,
            desktopCls: true,
            hasLocalBusinessSchema: true,
            hasFaqSchema: true,
            hasBookingCtaAboveFold: true,
            hasPhoneAboveFold: true,
            napConsistent: true,
            contentWithoutJs: true,
            techStack: true,
            auditedAt: true,
          },
        },
      },
    });

    if (!own) return EMPTY_SMB_WEBSITE;

    const audit = own.lighthouseAudits[0] ?? null;

    if (!audit) {
      return {
        ...EMPTY_SMB_WEBSITE,
        ownedBusinessId: own.id,
        businessName: own.name,
        websiteUrl: own.website ?? null,
      };
    }

    // Overall verdict from Performance score.
    const overall = verdictForPerf(audit.performance);

    // Speed signals — 4 tiles.
    const lcpV = verdictForLcp(audit.lcp);
    const inpV = verdictForInp(audit.inp);
    const clsV = verdictForCls(audit.cls);
    // Desktop counterparts (null columns until the business is re-audited).
    const dLcpV = verdictForLcp(audit.desktopLcp);
    const dInpV = verdictForInp(audit.desktopInp);
    const dClsV = verdictForCls(audit.desktopCls);
    const speedSignals: WebsiteSpeedSignal[] = [
      {
        key: "page_show",
        value: lcpV.value,
        tone: lcpV.tone,
        desktopValue: audit.desktopLcp != null ? dLcpV.value : null,
        desktopTone: dLcpV.tone,
        target: "Goal: under 2.5s",
        meaning: "How fast the first thing people see appears.",
      },
      {
        key: "buttons",
        value: inpV.value,
        tone: inpV.tone,
        desktopValue: audit.desktopInp != null ? dInpV.value : null,
        desktopTone: dInpV.tone,
        target: "Goal: under 200ms",
        meaning: "How quickly your buttons and forms respond when tapped.",
      },
      {
        key: "steady",
        value: clsV.value,
        tone: clsV.tone,
        desktopValue: audit.desktopCls != null ? dClsV.value : null,
        desktopTone: dClsV.tone,
        target: "Goal: under 0.1",
        meaning: "Whether the page jumps around as it loads. Lower is calmer.",
      },
      // "overall_speed" tile removed — it duplicated the verdict-hero score.
    ];

    // Checks — 5 binary signals.
    function toState(v: boolean | null): WebsiteCheck["state"] {
      if (v === true) return "pass";
      if (v === false) return "fail";
      return "unknown";
    }
    const checks: WebsiteCheck[] = [
      {
        key: "google_reads",
        state: toState(audit.contentWithoutJs),
        meaning:
          "Whether your text shows up for Google without running JavaScript. If it doesn't, Google may not list your pages.",
      },
      {
        key: "google_tags",
        state: toState(audit.hasLocalBusinessSchema),
        meaning:
          "Tiny invisible labels Google reads to show your hours, rating, and phone in search.",
      },
      {
        key: "faq_tags",
        state: toState(audit.hasFaqSchema),
        meaning:
          "A short FAQ section Google can show right inside search results — free visibility.",
      },
      {
        key: "booking_top",
        state: toState(audit.hasBookingCtaAboveFold),
        meaning:
          "Booking button at the top of your homepage. Most people decide in the first 5 seconds.",
      },
      {
        key: "phone_top",
        state: toState(audit.hasPhoneAboveFold),
        meaning:
          "Your phone shown at the top, as a tap-to-call link on mobile.",
      },
      {
        key: "info_matches",
        state: toState(audit.napConsistent),
        meaning:
          "Your name, address, and phone match exactly across your site and Google.",
      },
    ];

    const topFixes = deriveWebsiteFixes({
      performance: audit.performance,
      lcpSeconds: audit.lcp,
      hasLocalBusinessSchema: audit.hasLocalBusinessSchema,
      hasFaqSchema: audit.hasFaqSchema,
      hasBookingCtaAboveFold: audit.hasBookingCtaAboveFold,
      hasPhoneAboveFold: audit.hasPhoneAboveFold,
      napConsistent: audit.napConsistent,
    });

    // Same-cell ranking by the Website PILLAR (the same number the page header
    // badge shows) so the table and the badge can never disagree. Speed is a
    // diagnostic column. Fills in as businesses are scored.
    const ownSnap = await prisma.businessSnapshot.findFirst({
      where: { businessId: own.id },
      orderBy: { snapshotDate: "desc" },
      select: { cellKey: true },
    });
    const ranking = await buildCompetitorRanking({
      id: own.id,
      cellKey: ownSnap?.cellKey ?? null,
    });

    return {
      ownedBusinessId: own.id,
      businessName: own.name,
      websiteUrl: own.website ?? null,
      overallScore: audit.performance,
      overallVerdict: overall.verdict,
      overallTone: overall.tone,
      seoScore: audit.seo,
      seoTone: toneForSeo(audit.seo),
      speedSignals,
      // Hide "unsure" checks entirely — only show a definite pass/fail. A
      // check is unknown when the column predates this business's latest audit
      // (fills in on next refresh) or the DOM leg failed; either way we don't
      // surface an uncertain verdict.
      checks: checks.filter((c) => c.state !== "unknown"),
      topFixes,
      techStack: audit.techStack ?? [],
      competitors: ranking.competitors,
      yourRank: ranking.yourRank,
      rankedTotal: ranking.rankedTotal,
      auditedAt: audit.auditedAt,
    };
  } catch (err) {
    console.error("[smb-website] query failed:", err);
    return EMPTY_SMB_WEBSITE;
  }
}

/**
 * Rank every business in the owner's (category, city, country) cell by its
 * latest website speed score. Returns the top 10 (+ the owner's row if they're
 * outside it), the owner's place, and the total scored count. Reads existing
 * LighthouseAudit rows only — no API calls; the table fills in as competitors
 * are audited. Hidden (empty) until at least one competitor has a score.
 */
async function buildCompetitorRanking(own: {
  id: string;
  cellKey: string | null;
}): Promise<{
  competitors: WebsiteCompetitor[];
  yourRank: number | null;
  rankedTotal: number;
}> {
  const empty = { competitors: [], yourRank: null, rankedTotal: 0 };
  if (!own.cellKey) return empty;

  // Latest snapshot per business in the owner's MARKET cell, with the Website
  // pillar (rank basis) + speed (diagnostic, from the signal bag). Only
  // businesses that have ACTUALLY been website-scored (`websitePillar != null`)
  // are included — a business whose site was never audited would otherwise show
  // a fake 0.0 and inflate the "measured" denominator (the table read as broken
  // when most of the cell was unmeasured). "X measured so far" now means X.
  const snaps = await prisma.businessSnapshot.findMany({
    where: {
      cellKey: own.cellKey,
      websitePillar: { not: null },
      business: { qualificationStatus: "QUALIFIED" },
    },
    distinct: ["businessId"],
    orderBy: [{ businessId: "asc" }, { snapshotDate: "desc" }],
    select: {
      businessId: true,
      websitePillar: true,
      signalsJson: true,
      business: { select: { name: true } },
    },
  });

  const ranked = snaps
    .map((s) => ({
      id: s.businessId,
      name: s.business.name,
      score: Math.round((s.websitePillar ?? 0) * 10) / 10,
      speed: speedFromSignals(s.signalsJson),
    }))
    .sort((a, b) => b.score - a.score);

  const rankedTotal = ranked.length;
  // Need at least the owner + one competitor for a meaningful comparison.
  if (rankedTotal <= 1) return { ...empty, rankedTotal };

  // Standard competition ranking ("1 2 2 4") so the table matches the badge —
  // the field of no-website businesses (score 0) shares one bottom rank instead
  // of an arbitrary sequential order.
  const rankByIndex: number[] = [];
  let prevScore: number | null = null;
  let prevRank = 0;
  ranked.forEach((r, i) => {
    const rank = prevScore !== null && r.score === prevScore ? prevRank : i + 1;
    prevScore = r.score;
    prevRank = rank;
    rankByIndex[i] = rank;
  });

  const yourIndex = ranked.findIndex((r) => r.id === own.id);
  const yourRank = yourIndex >= 0 ? (rankByIndex[yourIndex] ?? null) : null;

  const top10: WebsiteCompetitor[] = ranked.slice(0, 10).map((r, i) => ({
    name: r.name,
    score: r.score,
    speed: r.speed,
    rank: rankByIndex[i]!,
    isYou: r.id === own.id,
  }));

  // Append the owner's own row when they rank outside the top 10.
  const competitors =
    yourRank != null && yourIndex >= 10
      ? [
          ...top10,
          {
            name: ranked[yourIndex]!.name,
            score: ranked[yourIndex]!.score,
            speed: ranked[yourIndex]!.speed,
            rank: yourRank,
            isYou: true,
          },
        ]
      : top10;

  return { competitors, yourRank, rankedTotal };
}

/** Lighthouse performance (0–100) from a snapshot's signal bag, or null. */
function speedFromSignals(v: unknown): number | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const n = (v as Record<string, unknown>).lighthousePerformance;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}
