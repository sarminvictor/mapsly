/**
 * /admin/landing-pages · server queries.
 *
 * The conversion funnel for the personalized landing pages. Funnel steps count
 * UNIQUE visitors (by `visitorId`, bots excluded) — raw SQL because Prisma
 * groupBy can't `COUNT(DISTINCT)`. The enum column is cast `::text` and counts
 * `::int` per the Neon-adapter deserialization caution (INC-08).
 *
 * No `'use cache'` — the page marks itself dynamic via `connection()` and reads
 * fresh on every load (admin surface, low traffic).
 */

import prisma from "@/lib/prisma";

export interface LandingFunnel {
  opened: number; // unique visitors who opened a landing
  engaged: number; // scrolled past the hero
  reachedPricing: number; // saw the $29 block
  clickedCta: number; // clicked a Start-tracking CTA
  checkoutOpened: number; // reached Stripe checkout
  subscribed: number; // completed a subscription (webhook-attributed)
  totalOpens: number; // raw open count (incl. repeat visits)
  botOpens: number; // filtered bot opens (informational)
}

interface TypeAgg {
  type: string;
  uniq: number;
  total: number;
}

export async function getLandingFunnel(): Promise<LandingFunnel> {
  const [byType, engagedRows, pricingRows, botRows] = await Promise.all([
    prisma.$queryRaw<TypeAgg[]>`
      SELECT type::text AS type,
             COUNT(DISTINCT "visitorId")::int AS uniq,
             COUNT(*)::int AS total
      FROM "LandingEvent"
      WHERE "isBot" = false
      GROUP BY type
    `,
    prisma.$queryRaw<{ uniq: number }[]>`
      SELECT COUNT(DISTINCT "visitorId")::int AS uniq
      FROM "LandingEvent"
      WHERE "isBot" = false AND type = 'SECTION_VIEWED' AND section <> 'hero'
    `,
    prisma.$queryRaw<{ uniq: number }[]>`
      SELECT COUNT(DISTINCT "visitorId")::int AS uniq
      FROM "LandingEvent"
      WHERE "isBot" = false AND type = 'SECTION_VIEWED' AND section = 'pricing'
    `,
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM "LandingEvent"
      WHERE "isBot" = true AND type = 'PAGE_OPENED'
    `,
  ]);

  const find = (t: string) => byType.find((r) => r.type === t);

  return {
    opened: find("PAGE_OPENED")?.uniq ?? 0,
    engaged: engagedRows[0]?.uniq ?? 0,
    reachedPricing: pricingRows[0]?.uniq ?? 0,
    clickedCta: find("CTA_CLICKED")?.uniq ?? 0,
    checkoutOpened: find("CHECKOUT_OPENED")?.uniq ?? 0,
    subscribed: find("SUBSCRIPTION_BOUGHT")?.total ?? 0,
    totalOpens: find("PAGE_OPENED")?.total ?? 0,
    botOpens: botRows[0]?.total ?? 0,
  };
}

export interface LandingRow {
  id: string;
  token: string;
  slug: string;
  isActive: boolean;
  viewCount: number;
  createdAt: Date;
  businessName: string;
  businessCity: string | null;
  conversions: number;
}

export async function getLandingPagesList(): Promise<LandingRow[]> {
  const [landings, subs] = await Promise.all([
    prisma.landingPage.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        token: true,
        slug: true,
        isActive: true,
        viewCount: true,
        createdAt: true,
        business: { select: { name: true, city: true } },
      },
    }),
    prisma.landingEvent.groupBy({
      by: ["landingPageId"],
      where: { type: "SUBSCRIPTION_BOUGHT" },
      _count: { _all: true },
    }),
  ]);

  const subMap = new Map(subs.map((s) => [s.landingPageId, s._count._all]));

  return landings.map((l) => ({
    id: l.id,
    token: l.token,
    slug: l.slug,
    isActive: l.isActive,
    viewCount: l.viewCount,
    createdAt: l.createdAt,
    businessName: l.business.name,
    businessCity: l.business.city,
    conversions: subMap.get(l.id) ?? 0,
  }));
}
