/**
 * Marketing-lead emails · best-effort transactional sends via Resend's REST
 * API (the mapsly.ai path, same as lib/cold-alerts — NEVER the cold Zoho
 * mailboxes). Both helpers swallow errors: a failed email must never undo a
 * captured lead. Env is read at call time (vercel.md INC-07).
 */

import prisma from "@/lib/prisma";
import { renderEmailShell, escapeEmailHtml } from "@/lib/email/shell";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function resendKey(): string | undefined {
  return process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? "login@mapsly.ai";
}

/**
 * Confirm to the visitor that their free report is being prepared. Warm,
 * plain-English, no jargon (SMB voice · `.claude/rules/copy-voice.md`). The
 * report itself is produced + sent afterward — this is the acknowledgement.
 */
export async function sendReportConfirmation(opts: {
  to: string;
  businessName: string;
}): Promise<void> {
  try {
    const apiKey = resendKey();
    if (!apiKey) return; // no key in this env — skip silently
    const text = [
      "Hi,",
      "",
      `Thanks for requesting your free report for ${opts.businessName}.`,
      "",
      "We're pulling your data now — your reviews, your ratings, and the customers going to nearby businesses. We'll email your report within one business day.",
      "",
      "Keep an eye on your inbox.",
      "",
      "— The Mapsly team",
    ].join("\n");

    await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: opts.to,
        subject: "Your free Mapsly report is on the way",
        text,
        html: renderEmailShell({
          heading: "Your free report is on the way",
          bodyHtml:
            `Thanks for requesting your free report for <b>${escapeEmailHtml(opts.businessName)}</b>.<br/><br/>` +
            "We're pulling your data now — your reviews, your ratings, and the customers going to nearby businesses. We'll email your report within one business day.<br/><br/>Keep an eye on your inbox.",
          reason:
            "You're receiving this because you requested a free report on mapsly.ai.",
        }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "marketing_lead.confirmation_email.failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Notify ops of a new inbound lead — two channels: a `Notification` row
 * (category "marketing-lead", surfaced on dev.mapsly.ai) + an email to
 * OPS_ALERT_EMAIL. Never throws. The Notification title is per-business so
 * distinct leads each surface (sendOpsAlert's 6h title-dedupe would collapse
 * a constant title — see lib/cold-alerts).
 */
export async function notifyOpsNewLead(opts: {
  businessName: string;
  email: string;
  city?: string | null;
}): Promise<void> {
  const detail = `${opts.email}${opts.city ? ` · ${opts.city}` : ""}`;

  try {
    await prisma.notification.create({
      data: {
        level: "INFO",
        category: "marketing-lead",
        title: `Free-report lead · ${opts.businessName}`,
        body: detail,
      },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "marketing_lead.ops_notification.failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  try {
    const apiKey = resendKey();
    if (!apiKey) return;
    const to = process.env.OPS_ALERT_EMAIL ?? "sarminvictor@gmail.com";
    await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to,
        subject: `[mapsly] New free-report lead · ${opts.businessName}`,
        text: `${opts.businessName}\n${detail}\n\nThey aren't in the index yet — generate + send their report.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "marketing_lead.ops_email.failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
