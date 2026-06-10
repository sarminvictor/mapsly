/**
 * Cold-sequence processor · runs every 15 min via Vercel cron.
 *
 * Claims due ColdSend rows for ACTIVE campaigns, enforces the send window,
 * suppression, and per-mailbox caps, sends via the self-hosted cold-mailer
 * (mapsly.xyz), then advances the recipient to the next touch. Hard bounces
 * suppress; provider blocks cool the mailbox down and stop the tick.
 *
 * Real-time reply/click → WARM handoff happens elsewhere (deferred to week 2);
 * this loop is the steady-state sender. CRON_SECRET enforced by cronHandler.
 */
import { randomInt } from "node:crypto";

import { cronHandler } from "@/lib/middleware/no-live-api";
import prisma from "@/lib/prisma";

import { buildTokens } from "@/modules/cold/personalization";
import { addDelay, withinSendWindow } from "@/modules/cold/scheduling";
import { isGloballyPaused } from "@/modules/cold/settings";
import { isSuppressed, suppress } from "@/modules/cold/suppression";
import {
  buildTextFooter,
  renderTemplate,
  toHtmlBody,
} from "@/modules/cold/template";
import { unsubscribeUrlFor } from "@/modules/cold/token";
import { acquireMailbox, sendViaMailbox } from "@/services/cold-mailer";
import { getColdSenderConfig } from "@/services/cold-mailer/config";

const JOB = "cold:process-sequences";
const BATCH = 8; // small batches per 15-min tick → less bursty (Zoho-friendly)
const MAX_ATTEMPTS = 3;

const TERMINAL: ReadonlySet<string> = new Set([
  "REPLIED",
  "WARM",
  "UNSUBSCRIBED",
  "BOUNCED",
  "COMPLETED",
  "SKIPPED",
]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ColdRunMeta {
  due: number;
  sent: number;
  skipped: number;
  blocked: number;
  failed: number;
  noCapacity: number;
  paused?: boolean;
  [key: string]: number | boolean | undefined;
}

export const GET = cronHandler(JOB, async () => {
  const summary = await processColdSequences();
  return {
    itemsProcessed: summary.sent,
    status: summary.blocked > 0 || summary.noCapacity > 0 ? "PARTIAL" : "OK",
    meta: summary,
  };
});

async function markSkip(sendId: string, reason: string): Promise<void> {
  await prisma.coldSend.update({
    where: { id: sendId },
    data: { status: "SKIPPED", errorMessage: reason },
  });
}

/** Pure-ish core (testable): process one batch of due sends. */
export async function processColdSequences(
  now: Date = new Date(),
): Promise<ColdRunMeta> {
  const meta: ColdRunMeta = {
    due: 0,
    sent: 0,
    skipped: 0,
    blocked: 0,
    failed: 0,
    noCapacity: 0,
  };

  if (await isGloballyPaused()) {
    meta.paused = true;
    return meta;
  }

  const sender = getColdSenderConfig();

  const due = await prisma.coldSend.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      recipient: { campaign: { status: "ACTIVE" } },
    },
    orderBy: { scheduledFor: "asc" },
    take: BATCH,
    select: {
      id: true,
      stepOrder: true,
      attempts: true,
      recipient: {
        select: {
          id: true,
          email: true,
          businessId: true,
          reportToken: true,
          status: true,
          campaign: {
            select: {
              fromName: true,
              sendWindowStartHour: true,
              sendWindowEndHour: true,
              sendTimezone: true,
              weekdaysOnly: true,
              steps: {
                select: {
                  stepOrder: true,
                  subjectTemplate: true,
                  bodyTemplate: true,
                  delayDays: true,
                  delayHours: true,
                },
                orderBy: { stepOrder: "asc" },
              },
            },
          },
        },
      },
    },
  });
  meta.due = due.length;

  for (const send of due) {
    const r = send.recipient;
    const campaign = r.campaign;
    const step = campaign.steps.find((s) => s.stepOrder === send.stepOrder);

    if (TERMINAL.has(r.status)) {
      await markSkip(send.id, "recipient terminal");
      meta.skipped++;
      continue;
    }
    if (!step) {
      await markSkip(send.id, "step missing");
      meta.skipped++;
      continue;
    }
    if (!withinSendWindow(campaign, now)) {
      continue; // leave PENDING for the next in-window tick
    }
    if (await isSuppressed(r.email)) {
      await markSkip(send.id, "suppressed");
      await prisma.coldRecipient.update({
        where: { id: r.id },
        data: {
          status: "UNSUBSCRIBED",
          stopReason: "suppressed",
          nextRunAt: null,
        },
      });
      meta.skipped++;
      continue;
    }

    const mailbox = await acquireMailbox(now);
    if (!mailbox) {
      meta.noCapacity++;
      break; // out of capacity → stop this tick
    }

    const senderName = campaign.fromName ?? mailbox.displayName;
    const reportUrl = r.reportToken
      ? `${sender.baseUrl}/l/${r.reportToken}`
      : "";
    const tokens = await buildTokens(r.businessId, { reportUrl, senderName });
    // Spintax seed = recipient:step → retries render the identical copy.
    const spinSeed = `${r.id}:${send.stepOrder}`;
    const subject = renderTemplate(step.subjectTemplate, tokens, spinSeed);
    const unsubUrl = unsubscribeUrlFor(r.email);
    const renderedBody = renderTemplate(step.bodyTemplate, tokens, spinSeed);
    const text = renderedBody + buildTextFooter(unsubUrl, sender.physicalAddress);
    const html = toHtmlBody(renderedBody, unsubUrl, sender.physicalAddress);

    const result = await sendViaMailbox(
      mailbox,
      {
        to: r.email,
        subject,
        text,
        html,
        unsubscribeUrl: unsubUrl,
        fromName: senderName,
      },
      now,
    );

    if (result.kind === "sent") {
      meta.sent++;
      const nextStep = campaign.steps.find(
        (s) => s.stepOrder === send.stepOrder + 1,
      );
      await prisma.$transaction(async (tx) => {
        await tx.coldSend.update({
          where: { id: send.id },
          data: {
            status: "SENT",
            sentAt: now,
            mailboxAddress: result.mailboxAddress,
            subject,
            attempts: { increment: 1 },
          },
        });
        if (nextStep) {
          // Jitter the next touch by up to 4h so follow-ups aren't clockwork.
          const scheduledFor = new Date(
            addDelay(now, nextStep.delayDays, nextStep.delayHours).getTime() +
              randomInt(0, 4 * 60 * 60 * 1000),
          );
          await tx.coldRecipient.update({
            where: { id: r.id },
            data: {
              status: "ACTIVE",
              currentStep: nextStep.stepOrder,
              nextRunAt: scheduledFor,
            },
          });
          await tx.coldSend.create({
            data: {
              recipientId: r.id,
              stepOrder: nextStep.stepOrder,
              scheduledFor,
              idempotencyKey: `${r.id}:${nextStep.stepOrder}`,
            },
          });
        } else {
          await tx.coldRecipient.update({
            where: { id: r.id },
            data: {
              status: "COMPLETED",
              currentStep: send.stepOrder,
              nextRunAt: null,
            },
          });
        }
      });
    } else if (result.kind === "blocked") {
      meta.blocked++;
      await prisma.coldSend.update({
        where: { id: send.id },
        data: {
          attempts: { increment: 1 },
          errorMessage: "provider block; mailbox cooled down",
          mailboxAddress: result.mailboxAddress,
        },
      });
      break; // likely IP-wide; stop this tick
    } else if (result.kind === "no_capacity") {
      meta.noCapacity++;
      break;
    } else {
      meta.failed++;
      const attempts = send.attempts + 1;
      if (result.permanent) {
        await prisma.coldSend.update({
          where: { id: send.id },
          data: {
            status: "FAILED",
            attempts,
            bounceReason: result.error,
            errorMessage: result.error,
            mailboxAddress: result.mailboxAddress,
          },
        });
        await suppress(r.email, "BOUNCE_HARD", result.error);
        await prisma.coldRecipient.update({
          where: { id: r.id },
          data: {
            status: "BOUNCED",
            stopReason: "hard bounce",
            nextRunAt: null,
          },
        });
      } else {
        await prisma.coldSend.update({
          where: { id: send.id },
          data: {
            status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            attempts,
            errorMessage: result.error,
            mailboxAddress: result.mailboxAddress,
          },
        });
      }
    }

    // Random gap between sends — Zoho punishes machine-regular cadence/bursts.
    await sleep(randomInt(2000, 8000));
  }

  return meta;
}

export const __test = { JOB, BATCH, MAX_ATTEMPTS, processColdSequences };
