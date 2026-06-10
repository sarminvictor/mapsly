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

    const grouped = await prisma.coldRecipient.groupBy({
      by: ["status"],
      where: { campaignId: id },
      _count: true,
    });
    const statusCounts: Record<string, number> = {};
    for (const g of grouped) statusCounts[g.status] = g._count;

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
