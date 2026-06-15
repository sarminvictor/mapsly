/**
 * Automated circuit breakers for the cold-email send loop — converts the
 * runbook's "watch the overview, hit Pause" into code (audit 2026-06-09
 * finding 4). Called at the end of every sequence-cron tick. Never throws.
 *
 * Breakers:
 *   1. Mailbox blocked            → WARN  (deduped per state by cold-alerts)
 *   2. Whole fleet blocked + due  → CRITICAL
 *   3. 24h hard bounces ≥ 5 AND rate > 3%  → WARN only (auto-pause removed)
 */
import { sendOpsAlert } from "@/lib/cold-alerts";
import prisma from "@/lib/prisma";

import { isGloballyPaused } from "./settings";

/** WARN (no longer pause) when hard bounces exceed this share of 24h sends. */
export const BOUNCE_BREAKER_RATE = 0.03;
/** Don't emit the bounce WARN on tiny samples. */
export const BOUNCE_BREAKER_MIN_SENT = 25;
/**
 * Absolute floor of hard bounces before the bounce-rate WARN fires, paired
 * with the rate so a single ordinary bounce on a small sample doesn't alert.
 * NOTE: the bounce-rate AUTO-PAUSE was removed 2026-06-15 (Viktor) for the
 * Miami launch — a scraped cold list carries a normal address-miss tail and
 * the full list must send today. This is now a non-blocking WARN threshold
 * only; sending is NEVER auto-paused on bounce rate. The per-mailbox
 * provider-block breakers (1 + 2 above) are unaffected.
 */
export const BOUNCE_BREAKER_MIN_BOUNCES = 5;

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
      bounces24h >= BOUNCE_BREAKER_MIN_BOUNCES &&
      bounces24h / sent24h > BOUNCE_BREAKER_RATE &&
      !(await isGloballyPaused())
    ) {
      // Auto-pause removed for the Miami launch (Viktor, 2026-06-15): a scraped
      // list carries a normal address-miss tail (info@/role mailboxes that
      // don't exist on otherwise-valid domains) and the full list must send
      // today. Surface an elevated bounce rate as a deduped WARN; NEVER
      // auto-pause. Pause manually in /admin/email if deliverability degrades.
      await sendOpsAlert(
        "WARN",
        "Cold bounce rate elevated (auto-pause off)",
        `${bounces24h} hard bounce(s) over ${sent24h} send(s) in 24h (${((100 * bounces24h) / sent24h).toFixed(1)}% > ${BOUNCE_BREAKER_RATE * 100}%). Auto-pause is OFF by config — sending continues. Monitor mapsly.xyz deliverability; pause manually in /admin/email if it climbs.`,
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
