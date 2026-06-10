"use server";

/**
 * Cold-email admin · server actions. Every action: assertAdmin() → Zod-validate
 * → mutate → revalidateTag("cold-email"). Drives the /admin/email control surface.
 */
import { revalidateTag } from "next/cache";
import { z } from "zod";

import { assertAdmin } from "@/lib/portal-guard";
import prisma from "@/lib/prisma";
import {
  DEFAULT_CAMPAIGN,
  DEFAULT_COLD_STEPS,
} from "@/modules/cold/default-campaign";
import {
  enrollCohort,
  previewCohort,
  type EnrollResult,
} from "@/modules/cold/enroll";
import { setColdSetting } from "@/modules/cold/settings";
import { suppress, unsuppress } from "@/modules/cold/suppression";
import {
  buildTextFooter,
  renderTemplate,
  toHtmlBody,
} from "@/modules/cold/template";
import { unsubscribeUrlFor } from "@/modules/cold/token";
import { sendViaMailbox, syncMailboxesFromEnv } from "@/services/cold-mailer";
import {
  deriveDisplayName,
  getColdSenderConfig,
  getMailboxCreds,
} from "@/services/cold-mailer/config";

function touch(): void {
  revalidateTag("cold-email", "seconds");
}

const CAMPAIGN_STATUS = z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);
const MAILBOX_STATUS = z.enum(["WARMING", "ACTIVE", "PAUSED", "BLOCKED"]);

export async function setGlobalPause(paused: boolean): Promise<void> {
  await assertAdmin();
  await setColdSetting("globalPause", paused ? "1" : "0");
  touch();
}

export async function createDefaultCampaign(): Promise<{ id: string }> {
  await assertAdmin();
  const campaign = await prisma.coldCampaign.create({
    data: {
      ...DEFAULT_CAMPAIGN,
      steps: {
        create: DEFAULT_COLD_STEPS.map((s) => ({
          stepOrder: s.stepOrder,
          subjectTemplate: s.subjectTemplate,
          bodyTemplate: s.bodyTemplate,
          delayDays: s.delayDays,
          delayHours: s.delayHours,
        })),
      },
    },
    select: { id: true },
  });
  touch();
  return { id: campaign.id };
}

export async function setCampaignStatus(
  id: string,
  status: string,
): Promise<void> {
  await assertAdmin();
  const parsed = CAMPAIGN_STATUS.parse(status);
  await prisma.coldCampaign.update({ where: { id }, data: { status: parsed } });
  touch();
}

const CAMPAIGN_SETTINGS = z.object({
  name: z.string().min(1).max(120),
  fromName: z.string().max(80).nullable(),
  country: z.string().min(2).max(2),
  sendWindowStartHour: z.number().int().min(0).max(23),
  sendWindowEndHour: z.number().int().min(1).max(24),
  sendTimezone: z.string().min(1).max(64),
  weekdaysOnly: z.boolean(),
  dailyEnrollCap: z.number().int().min(1).max(100_000),
});

export async function updateCampaign(
  id: string,
  data: z.input<typeof CAMPAIGN_SETTINGS>,
): Promise<void> {
  await assertAdmin();
  const parsed = CAMPAIGN_SETTINGS.parse(data);
  await prisma.coldCampaign.update({ where: { id }, data: parsed });
  touch();
}

const STEP_INPUT = z.object({
  id: z.string().nullable(),
  campaignId: z.string(),
  stepOrder: z.number().int().min(0).max(20),
  subjectTemplate: z.string().min(1).max(300),
  bodyTemplate: z.string().min(1).max(8000),
  delayDays: z.number().int().min(0).max(60),
  delayHours: z.number().int().min(0).max(23),
});

export async function upsertStep(
  input: z.input<typeof STEP_INPUT>,
): Promise<void> {
  await assertAdmin();
  const s = STEP_INPUT.parse(input);
  if (s.id) {
    await prisma.coldStep.update({
      where: { id: s.id },
      data: {
        subjectTemplate: s.subjectTemplate,
        bodyTemplate: s.bodyTemplate,
        delayDays: s.delayDays,
        delayHours: s.delayHours,
      },
    });
  } else {
    await prisma.coldStep.create({
      data: {
        campaignId: s.campaignId,
        stepOrder: s.stepOrder,
        subjectTemplate: s.subjectTemplate,
        bodyTemplate: s.bodyTemplate,
        delayDays: s.delayDays,
        delayHours: s.delayHours,
      },
    });
  }
  touch();
}

export async function deleteStep(id: string): Promise<void> {
  await assertAdmin();
  await prisma.coldStep.delete({ where: { id } });
  touch();
}

const ENROLL_FILTER = z.object({
  campaignId: z.string(),
  country: z.string().min(2).max(2).optional(),
  category: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(5000),
});

export async function previewCohortAction(
  input: z.input<typeof ENROLL_FILTER>,
): Promise<number> {
  await assertAdmin();
  const f = ENROLL_FILTER.parse(input);
  return previewCohort({
    country: f.country,
    category: f.category,
    city: f.city,
    limit: f.limit,
  });
}

export async function enrollCohortAction(
  input: z.input<typeof ENROLL_FILTER>,
): Promise<EnrollResult> {
  await assertAdmin();
  const f = ENROLL_FILTER.parse(input);
  const result = await enrollCohort(f.campaignId, {
    country: f.country,
    category: f.category,
    city: f.city,
    limit: f.limit,
  });
  touch();
  return result;
}

export async function addSuppression(raw: string): Promise<{ added: number }> {
  await assertAdmin();
  const emails = raw
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  for (const email of emails) await suppress(email, "MANUAL", "admin add");
  touch();
  return { added: emails.length };
}

export async function removeSuppression(email: string): Promise<void> {
  await assertAdmin();
  await unsuppress(email);
  touch();
}

/**
 * Mark recipients as REPLIED — instantly stops their follow-ups (the sequence
 * cron's TERMINAL gate honors REPLIED). Manual stopgap; the poll-cold-inboxes
 * cron sets this automatically when it sees a human reply.
 */
export async function markReplied(raw: string): Promise<{ marked: number }> {
  await assertAdmin();
  const emails = z
    .string()
    .max(10_000)
    .parse(raw)
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  let marked = 0;
  for (const email of emails) {
    const r = await prisma.coldRecipient.updateMany({
      where: { email, status: { in: ["PENDING", "ACTIVE"] } },
      data: {
        status: "REPLIED",
        stopReason: "replied (manual)",
        nextRunAt: null,
      },
    });
    marked += r.count;
    await prisma.coldSend.updateMany({
      where: { recipient: { email }, status: "PENDING" },
      data: { status: "SKIPPED", errorMessage: "recipient replied" },
    });
  }
  touch();
  return { marked };
}

export async function syncMailboxes(): Promise<{ total: number }> {
  await assertAdmin();
  const r = await syncMailboxesFromEnv();
  touch();
  return { total: r.total };
}

export async function setMailboxStatus(
  address: string,
  status: string,
  startRamp: boolean,
): Promise<void> {
  await assertAdmin();
  const parsed = MAILBOX_STATUS.parse(status);
  const existing = await prisma.mailbox.findUnique({
    where: { address },
    select: { rampStartedAt: true },
  });
  await prisma.mailbox.update({
    where: { address },
    data: {
      status: parsed,
      blockedUntil: parsed === "ACTIVE" ? null : undefined,
      rampStartedAt:
        startRamp && !existing?.rampStartedAt ? new Date() : undefined,
    },
  });
  touch();
}

export async function updateMailboxCap(
  address: string,
  dailyCap: number,
): Promise<void> {
  await assertAdmin();
  const cap = z.number().int().min(1).max(500).parse(dailyCap);
  await prisma.mailbox.update({ where: { address }, data: { dailyCap: cap } });
  touch();
}

export async function sendSeedTest(
  toEmail: string,
): Promise<{ ok: boolean; message: string }> {
  await assertAdmin();
  const to = z.string().email().parse(toEmail).toLowerCase();
  const cred = getMailboxCreds()[0];
  if (!cred) return { ok: false, message: "No COLD_MAILBOX_* configured." };
  const step0 = DEFAULT_COLD_STEPS[0];
  if (!step0) return { ok: false, message: "No default steps." };

  const sender = getColdSenderConfig();
  const displayName = cred.displayName ?? deriveDisplayName(cred.address);
  const tokens: Record<string, string> = {
    businessName: "Acme Test Co",
    city: "Miami",
    rating: "4.2",
    reviewCount: "37",
    unansweredCount: "6",
    senderFirstName: displayName,
    reportUrl: `${sender.baseUrl}/l/seed-test`,
  };
  const subject = renderTemplate(step0.subjectTemplate, tokens, `seed:${to}`);
  const unsubUrl = unsubscribeUrlFor(to);
  const renderedBody = renderTemplate(step0.bodyTemplate, tokens, `seed:${to}`);
  const text = renderedBody + buildTextFooter(unsubUrl, sender.physicalAddress);
  const html = toHtmlBody(renderedBody, unsubUrl, sender.physicalAddress);

  const result = await sendViaMailbox(
    { address: cred.address, password: cred.password, displayName },
    { to, subject, text, html, unsubscribeUrl: unsubUrl },
    new Date(),
  );
  touch();
  if (result.kind === "sent")
    return { ok: true, message: `Sent from ${result.mailboxAddress}` };
  if (result.kind === "blocked")
    return { ok: false, message: "Provider blocked the mailbox (cooldown)." };
  if (result.kind === "failed") return { ok: false, message: result.error };
  return { ok: false, message: "No mailbox capacity." };
}
