/**
 * Automated circuit breakers for the cold-email send loop — converts the
 * runbook's "watch the overview, hit Pause" into code (audit 2026-06-09
 * finding 4). Called at the end of every sequence-cron tick. Never throws.
 *
 * Breakers:
 *   1. Mailbox blocked            → WARN  (deduped per state by cold-alerts)
 *   2. Whole fleet blocked + due  → CRITICAL
 *   3. 24h hard-bounce rate > 3%  → auto-set globalPause + CRITICAL
 */
import { sendOpsAlert } from "@/lib/cold-alerts";
import prisma from "@/lib/prisma";

import { isGloballyPaused, setColdSetting } from "./settings";

/** Pause sending when hard bounces exceed this share of 24h sends. */
export const BOUNCE_BREAKER_RATE = 0.03;
/** Don't trip the bounce breaker on tiny samples. */
export const BOUNCE_BREAKER_MIN_SENT = 25;

export interface BreakerInput {
  due: number;
  sent: number;
  blocked: number;
  noCapacity: number;
}

export async function runColdCircuitBreakers(
  input: BreakerInput,
  now: Date,
): Promise<void> {
  try {
    // 1 + 2 · provider blocks
    if (input.blocked > 0 || input.noCapacity > 0) {
      const active = await prisma.mailbox.findMany({
        where: { status: "ACTIVE" },
        select: { address: true, blockedUntil: true },
      });
      const blockedNow = active.filter(
        (m) => m.blockedUntil != null && m.blockedUntil > now,
      );
      if (input.blocked > 0 && blockedNow.length > 0) {
        await sendOpsAlert(
          "WARN",
          `Cold mailbox blocked (${blockedNow.length}/${active.length})`,
          `Provider block during the send tick. Blocked: ${blockedNow
            .map((m) => m.address)
            .join(", ")}. 2h cooldown, auto-resumes.`,
        );
      }
      if (
        active.length > 0 &&
        blockedNow.length === active.length &&
        input.due > input.sent
      ) {
        await sendOpsAlert(
          "CRITICAL",
          "Cold sending stalled — all mailboxes blocked",
          `${input.due - input.sent} due send(s) waiting and every ACTIVE mailbox is in block cooldown. Check Zoho account health.`,
        );
      }
    }

    // 3 · bounce-rate breaker (trailing 24h). BOUNCE_HARD suppressions count
    // both synchronous SMTP rejects and NDRs from the inbox poller.
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const [bounces24h, sent24h] = await Promise.all([
      prisma.coldSuppression.count({
        where: { source: "BOUNCE_HARD", createdAt: { gte: since } },
      }),
      prisma.coldSend.count({
        where: { status: "SENT", sentAt: { gte: since } },
      }),
    ]);
    if (
      sent24h >= BOUNCE_BREAKER_MIN_SENT &&
      bounces24h / sent24h > BOUNCE_BREAKER_RATE &&
      !(await isGloballyPaused())
    ) {
      await setColdSetting("globalPause", "1");
      await sendOpsAlert(
        "CRITICAL",
        "Cold sending auto-paused — bounce-rate breaker",
        `${bounces24h} hard bounce(s) over ${sent24h} send(s) in 24h (${((100 * bounces24h) / sent24h).toFixed(1)}% > ${BOUNCE_BREAKER_RATE * 100}%). Sending paused — investigate list quality in /admin/email before resuming. Sustained bounce rate >2% suppresses the whole domain's inbox placement.`,
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "cold.breakers.failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
