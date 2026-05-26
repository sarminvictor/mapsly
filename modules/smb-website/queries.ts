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
  type SmbWebsiteData,
  type WebsiteCheck,
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
        lighthouseAudits: {
          take: 1,
          orderBy: { auditedAt: "desc" },
          select: {
            performance: true,
            seo: true,
            lcp: true,
            inp: true,
            cls: true,
            hasLocalBusinessSchema: true,
            hasFaqSchema: true,
            hasBookingCtaAboveFold: true,
            hasPhoneAboveFold: true,
            napConsistent: true,
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
    const speedSignals: WebsiteSpeedSignal[] = [
      {
        key: "page_show",
        value: lcpV.value,
        tone: lcpV.tone,
        meaning:
          "How fast the first thing people see appears. Under 2.5 seconds is great.",
      },
      {
        key: "buttons",
        value: inpV.value,
        tone: inpV.tone,
        meaning:
          "How quickly your buttons and forms respond when tapped. Under 200ms feels instant.",
      },
      {
        key: "steady",
        value: clsV.value,
        tone: clsV.tone,
        meaning: "Whether the page jumps around as it loads. Lower is calmer.",
      },
      {
        key: "overall_speed",
        value:
          audit.performance != null ? `${Math.round(audit.performance)}` : "—",
        tone: overall.tone,
        meaning:
          "Google's overall speed score for your site — 0 (slow) to 100 (quick).",
      },
    ];

    // Checks — 5 binary signals.
    function toState(v: boolean | null): WebsiteCheck["state"] {
      if (v === true) return "pass";
      if (v === false) return "fail";
      return "unknown";
    }
    const checks: WebsiteCheck[] = [
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

    return {
      ownedBusinessId: own.id,
      businessName: own.name,
      websiteUrl: own.website ?? null,
      overallScore: audit.performance,
      overallVerdict: overall.verdict,
      overallTone: overall.tone,
      speedSignals,
      checks,
      topFixes,
      techStack: audit.techStack ?? [],
      auditedAt: audit.auditedAt,
    };
  } catch (err) {
    console.error("[smb-website] query failed:", err);
    return EMPTY_SMB_WEBSITE;
  }
}
