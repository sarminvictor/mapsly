/**
 * Ops alerts for the cold-email pipeline — push, not pull (audit 2026-06-09
 * finding 4: blocks, bounce spikes and stalls were silent until someone
 * opened /admin/email).
 *
 * Two channels per alert:
 *   1. Notification row (category "cold-email") → dev-dashboard surfaces it.
 *   2. Email via Resend's REST API — the mapsly.ai transactional path,
 *      NEVER the cold Zoho mailboxes: when Zoho is the thing that broke,
 *      alerts must not depend on it.
 *
 * Deduped by exact title within a 6h window so a stuck state alerts once,
 * not every 15-min tick. Never throws — an alert failure must not take down
 * the send loop. Env is read at call time (vercel.md INC-07).
 */
import prisma from "@/lib/prisma";

const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;
const ALERT_CATEGORY = "cold-email";

export type OpsAlertLevel = "INFO" | "WARN" | "CRITICAL";

export async function sendOpsAlert(
  level: OpsAlertLevel,
  title: string,
  body: string,
): Promise<void> {
  try {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const recent = await prisma.notification.findFirst({
      where: { category: ALERT_CATEGORY, title, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) return; // already alerted for this state in the window

    await prisma.notification.create({
      data: { level, category: ALERT_CATEGORY, title, body },
    });

    const apiKey = process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY;
    if (!apiKey) return; // dashboard row still exists
    const to = process.env.OPS_ALERT_EMAIL ?? "sarminvictor@gmail.com";
    const from = process.env.RESEND_FROM_EMAIL ?? "login@mapsly.ai";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[mapsly cold-email · ${level}] ${title}`,
        text: `${body}\n\nAdmin: https://www.mapsly.ai/admin/email`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Log-and-swallow: alerting is best-effort by design.
    console.error(
      JSON.stringify({
        level: "error",
        event: "cold.alert.failed",
        title,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
