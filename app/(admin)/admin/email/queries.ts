/**
 * Cold-email admin · read queries. Each follows the dev-dashboard pattern:
 * 'use cache' + cacheLife + cacheTag("cold-email") + NEXT_PHASE build guard +
 * EMPTY_* fallback (so the Vercel build never opens a Neon socket). Server
 * actions revalidateTag("cold-email") after every mutation.
 */
import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import { getColdSetting } from "@/modules/cold/settings";
import { effectiveDailyCap, utcDateKey } from "@/services/cold-mailer/ramp";

export interface MailboxRow {
  address: string;
  domain: string;
  status: string;
  dailyCap: number;
  rampStartedAt: string | null;
  effectiveCap: number;
  todaySent: number;
  blocked: boolean;
}

export interface ColdOverview {
  globalPaused: boolean;
  sentToday: number;
  sent7d: number;
  failed7d: number;
  /**
   * Open tracking (plan #7/#17) — sends from the last 7d with a pixel fetch.
   * `opens7dRaw` counts EVERY first open (Apple MPP / Gmail proxies prefetch,
   * inflating ~50% — fuzzy upper bound). `opens7dHuman` is the cheap-path
   * human estimate: firstOpenedAt set AND suspectedPrefetch=false (the /o
   * route clears the flag when any open looks human — lib/bot-detect).
   */
  opens7dRaw: number;
  opens7dHuman: number;
  suppressedTotal: number;
  activeCampaigns: number;
  totalRecipients: number;
  /** Σ dailyCap over ACTIVE mailboxes × 5 weekdays — steady-state ceiling. */
  projectedWeekly: number;
  mailboxes: MailboxRow[];
}

export const EMPTY_OVERVIEW: ColdOverview = {
  globalPaused: false,
  sentToday: 0,
  sent7d: 0,
  failed7d: 0,
  opens7dRaw: 0,
  opens7dHuman: 0,
  suppressedTotal: 0,
  activeCampaigns: 0,
  totalRecipients: 0,
  projectedWeekly: 0,
  mailboxes: [],
};

export async function getColdOverview(): Promise<ColdOverview> {
  "use cache";
  cacheLife("seconds");
  cacheTag("cold-email");
  if (process.env.NEXT_PHASE === "phase-production-build")
    return EMPTY_OVERVIEW;

  try {
    const now = new Date();
    const today = utcDateKey(now);
    const since7d = new Date(now.getTime() - 7 * 86_400_000);

    const [
      sentTodayAgg,
      sent7d,
      failed7d,
      opens7dRaw,
      opens7dHuman,
      suppressedTotal,
      activeCampaigns,
      totalRecipients,
      mailboxes,
      todayStats,
      pause,
    ] = await Promise.all([
      prisma.mailboxStat.aggregate({
        where: { date: today },
        _sum: { sentCount: true },
      }),
      prisma.coldSend.count({
        where: { status: "SENT", sentAt: { gte: since7d } },
      }),
      prisma.coldSend.count({
        where: { status: "FAILED", updatedAt: { gte: since7d } },
      }),
      prisma.coldSend.count({
        where: { sentAt: { gte: since7d }, firstOpenedAt: { not: null } },
      }),
      prisma.coldSend.count({
        where: {
          sentAt: { gte: since7d },
          firstOpenedAt: { not: null },
          suspectedPrefetch: false,
        },
      }),
      prisma.coldSuppression.count(),
      prisma.coldCampaign.count({ where: { status: "ACTIVE" } }),
      prisma.coldRecipient.count(),
      prisma.mailbox.findMany({ orderBy: { address: "asc" } }),
      prisma.mailboxStat.findMany({
        where: { date: today },
        select: { mailboxAddress: true, sentCount: true },
      }),
      getColdSetting("globalPause"),
    ]);

    const sentByAddr = new Map(
      todayStats.map((s) => [s.mailboxAddress, s.sentCount]),
    );

    // Steady-state weekly ceiling (post-ramp): Σ dailyCap of ACTIVE boxes ×
    // 5 weekdays. Surfaced so a sub-1k/week config is visible, not silent.
    const projectedWeekly =
      mailboxes
        .filter((m) => m.status === "ACTIVE")
        .reduce((sum, m) => sum + m.dailyCap, 0) * 5;

    return {
      globalPaused: process.env.COLD_GLOBAL_PAUSE === "1" || pause === "1",
      sentToday: sentTodayAgg._sum.sentCount ?? 0,
      sent7d,
      failed7d,
      opens7dRaw,
      opens7dHuman,
      suppressedTotal,
      activeCampaigns,
      totalRecipients,
      projectedWeekly,
      mailboxes: mailboxes.map((m) => ({
        address: m.address,
        domain: m.domain,
        status: m.status,
        dailyCap: m.dailyCap,
        rampStartedAt: m.rampStartedAt ? m.rampStartedAt.toISOString() : null,
        effectiveCap: effectiveDailyCap(m.dailyCap, m.rampStartedAt, now),
        todaySent: sentByAddr.get(m.address) ?? 0,
        blocked: m.blockedUntil != null && m.blockedUntil > now,
      })),
    };
  } catch {
    return EMPTY_OVERVIEW;
  }
}

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  locale: string;
  country: string;
  steps: number;
  recipients: number;
  createdAt: string;
}

export async function getCampaigns(): Promise<CampaignRow[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("cold-email");
  if (process.env.NEXT_PHASE === "phase-production-build") return [];

  try {
    const rows = await prisma.coldCampaign.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        locale: true,
        country: true,
        createdAt: true,
        _count: { select: { steps: true, recipients: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      locale: c.locale,
      country: c.country,
      steps: c._count.steps,
      recipients: c._count.recipients,
      createdAt: c.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

export interface StepRow {
  id: string;
  stepOrder: number;
  subjectTemplate: string;
  bodyTemplate: string;
  delayDays: number;
  delayHours: number;
}

/**
 * Per-step delivery + open stats (plan #7/#17). `openedRaw` = any pixel
 * fetch (incl. MPP/proxy prefetch — upper bound); `openedHuman` = cheap-path
 * human opens (firstOpenedAt set, suspectedPrefetch=false). Both re-derivable
 * from the raw ColdSend fields via lib/bot-detect if the heuristic moves.
 */
export interface StepOpenStats {
  stepOrder: number;
  sent: number;
  openedRaw: number;
  openedHuman: number;
}

/**
 * Click → conversion funnel (plan #7/#17 — "clicks + landing visits are the
 * truth"). Attributed via the recipient's report link: ColdRecipient.businessId
 * → LandingPage → LandingEvent. The /l report link is distributed ONLY in the
 * cold email (no-indexed, not in the sitemap), so a non-bot landing visit ≈ an
 * email click. Counts are DISTINCT recipients (campaign-level, not per-touch —
 * all 3 touches share the same /l link by design).
 */
export interface CampaignFunnel {
  /** Distinct recipients with ≥1 SENT send (the funnel denominator). */
  sentRecipients: number;
  /** …who then opened their report page (non-bot PAGE_OPENED) = clicked. */
  visited: number;
  /** …who clicked a CTA on the report. */
  ctaClicked: number;
  /** …who opened Stripe checkout. */
  checkoutOpened: number;
  /** …who converted (subscribed or took the free weekly signup). */
  converted: number;
}

export interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  locale: string;
  country: string;
  fromName: string | null;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  sendTimezone: string;
  weekdaysOnly: boolean;
  dailyEnrollCap: number;
  steps: StepRow[];
  statusCounts: Record<string, number>;
  openStats: StepOpenStats[];
  funnel: CampaignFunnel;
}

export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  "use cache";
  cacheLife("seconds");
  cacheTag("cold-email");
  if (process.env.NEXT_PHASE === "phase-production-build") return null;

  try {
    const c = await prisma.coldCampaign.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
    if (!c) return null;

    const [grouped, openRows, sentRecipRows, funnelRows] = await Promise.all([
      prisma.coldRecipient.groupBy({
        by: ["status"],
        where: { campaignId: id },
        _count: true,
      }),
      // Counts cast ::int per INC-08 (Neon adapter deserialization).
      prisma.$queryRaw<
        {
          step_order: number;
          sent: number;
          opened_raw: number;
          opened_human: number;
        }[]
      >`
        SELECT s."stepOrder" AS step_order,
               COUNT(*) FILTER (WHERE s.status = 'SENT')::int AS sent,
               COUNT(*) FILTER (WHERE s.status = 'SENT'
                 AND s."firstOpenedAt" IS NOT NULL)::int AS opened_raw,
               COUNT(*) FILTER (WHERE s.status = 'SENT'
                 AND s."firstOpenedAt" IS NOT NULL
                 AND s."suspectedPrefetch" = false)::int AS opened_human
        FROM "ColdSend" s
        JOIN "ColdRecipient" r ON r.id = s."recipientId"
        WHERE r."campaignId" = ${id}
        GROUP BY s."stepOrder"
        ORDER BY s."stepOrder"
      `,
      // Funnel denominator — distinct recipients with at least one SENT send.
      prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(DISTINCT s."recipientId")::int AS n
        FROM "ColdSend" s
        JOIN "ColdRecipient" r ON r.id = s."recipientId"
        WHERE r."campaignId" = ${id} AND s.status = 'SENT'
      `,
      // Click → conversion: distinct recipients whose report page saw each
      // event. Joined recipient.businessId → LandingPage → LandingEvent. The /l
      // link ships only in the email, so a non-bot PAGE_OPENED ≈ an email click.
      prisma.$queryRaw<
        {
          visited: number;
          cta_clicked: number;
          checkout_opened: number;
          converted: number;
        }[]
      >`
        SELECT
          COUNT(DISTINCT r.id) FILTER (WHERE e.type = 'PAGE_OPENED' AND e."isBot" = false)::int AS visited,
          COUNT(DISTINCT r.id) FILTER (WHERE e.type = 'CTA_CLICKED' AND e."isBot" = false)::int AS cta_clicked,
          COUNT(DISTINCT r.id) FILTER (WHERE e.type = 'CHECKOUT_OPENED')::int AS checkout_opened,
          COUNT(DISTINCT r.id) FILTER (WHERE e.type IN ('SUBSCRIPTION_BOUGHT', 'FREE_SIGNUP'))::int AS converted
        FROM "ColdRecipient" r
        JOIN "LandingPage" lp ON lp."businessId" = r."businessId"
        JOIN "LandingEvent" e ON e."landingPageId" = lp.id
        WHERE r."campaignId" = ${id}
      `,
    ]);
    const statusCounts: Record<string, number> = {};
    for (const g of grouped) statusCounts[g.status] = g._count;
    const f = funnelRows[0];
    const funnel: CampaignFunnel = {
      sentRecipients: sentRecipRows[0]?.n ?? 0,
      visited: f?.visited ?? 0,
      ctaClicked: f?.cta_clicked ?? 0,
      checkoutOpened: f?.checkout_opened ?? 0,
      converted: f?.converted ?? 0,
    };

    return {
      id: c.id,
      name: c.name,
      status: c.status,
      locale: c.locale,
      country: c.country,
      fromName: c.fromName,
      sendWindowStartHour: c.sendWindowStartHour,
      sendWindowEndHour: c.sendWindowEndHour,
      sendTimezone: c.sendTimezone,
      weekdaysOnly: c.weekdaysOnly,
      dailyEnrollCap: c.dailyEnrollCap,
      steps: c.steps.map((s) => ({
        id: s.id,
        stepOrder: s.stepOrder,
        subjectTemplate: s.subjectTemplate,
        bodyTemplate: s.bodyTemplate,
        delayDays: s.delayDays,
        delayHours: s.delayHours,
      })),
      statusCounts,
      openStats: openRows.map((r) => ({
        stepOrder: r.step_order,
        sent: r.sent,
        openedRaw: r.opened_raw,
        openedHuman: r.opened_human,
      })),
      funnel,
    };
  } catch {
    return null;
  }
}

export interface SuppressionRow {
  email: string;
  source: string;
  reason: string | null;
  createdAt: string;
}

export async function getSuppressions(limit = 50): Promise<SuppressionRow[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("cold-email");
  if (process.env.NEXT_PHASE === "phase-production-build") return [];

  try {
    const rows = await prisma.coldSuppression.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { email: true, source: true, reason: true, createdAt: true },
    });
    return rows.map((s) => ({
      email: s.email,
      source: s.source,
      reason: s.reason,
      createdAt: s.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}
