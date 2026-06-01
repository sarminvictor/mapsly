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

    // Same-cell speed ranking · latest performance per business in the
    // (category, city, country) cell. Data fills in as competitors get
    // audited; the table is hidden until there's someone to compare to.
    const ranking = await buildCompetitorRanking({
      id: own.id,
      name: own.name,
      category: own.category,
      city: own.city,
      country: own.country,
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
  name: string;
  category: string | null;
  city: string | null;
  country: string | null;
}): Promise<{
  competitors: WebsiteCompetitor[];
  yourRank: number | null;
  rankedTotal: number;
}> {
  const empty = { competitors: [], yourRank: null, rankedTotal: 0 };
  if (!own.category || !own.city || !own.country) return empty;

  // Latest performance per same-cell business (DISTINCT ON newest audit).
  const rows = await prisma.$queryRaw<
    { id: string; name: string; performance: number }[]
  >`
    SELECT DISTINCT ON (b.id) b.id, b.name, la.performance
    FROM "Business" b
    JOIN "LighthouseAudit" la ON la."businessId" = b.id
    WHERE b.category = ${own.category}
      AND b.city = ${own.city}
      AND b.country = ${own.country}
      AND b."isActive" = true
      AND la.performance IS NOT NULL
    ORDER BY b.id, la."auditedAt" DESC
  `;

  const ranked = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      score: Math.round(Number(r.performance)),
    }))
    .sort((a, b) => b.score - a.score);

  const rankedTotal = ranked.length;
  // Need at least the owner + one competitor for a meaningful comparison.
  if (rankedTotal <= 1) return { ...empty, rankedTotal };

  const yourIndex = ranked.findIndex((r) => r.id === own.id);
  const yourRank = yourIndex >= 0 ? yourIndex + 1 : null;

  const top10: WebsiteCompetitor[] = ranked.slice(0, 10).map((r, i) => ({
    name: r.name,
    score: r.score,
    rank: i + 1,
    isYou: r.id === own.id,
  }));

  // Append the owner's own row when they rank outside the top 10.
  const competitors =
    yourRank != null && yourRank > 10
      ? [
          ...top10,
          {
            name: own.name,
            score: ranked[yourIndex].score,
            rank: yourRank,
            isYou: true,
          },
        ]
      : top10;

  return { competitors, yourRank, rankedTotal };
}
