// modules/agency-portal/notify/email.ts · transactional agency notifications
// (WP6-2 weekly digest + WP6-3 run-finished). Sent via Resend's REST API on the
// mapsly.ai transactional path — the SAME pattern as
// modules/agency-portal/team/invite-email.ts (NEVER the mapsly.xyz cold
// mailboxes in services/cold-mailer, which are a separate outbound rail).
//
// Best-effort by contract: every sender NEVER throws and returns a boolean —
// analytics/notification email must never break the run close or the cron tick
// that emitted it. Env is read at call time (vercel.md INC-07). English-only.
//
// Agency voice (the recipient is Tom running a tool): terse, numbers over
// adjectives, one deep-link CTA, no fluff — per .claude/rules/copy-voice.md
// § Agency. Mobile-friendly HTML (WP7-11 re-checks at 380px): a single-column
// max-560px table, inline styles only (email clients strip <style>), one button.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function resendKey(): string | undefined {
  return process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? "login@mapsly.ai";
}

/** Low-level send. Returns true when Resend accepted the request. Never throws. */
async function sendAgencyEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  try {
    const apiKey = resendKey();
    if (!apiKey) return false; // no key in this env — caller degrades gracefully
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "agency.notify-email.failed",
        subject: opts.subject,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return false;
  }
}

// ── Shared mobile-friendly HTML shell ────────────────────────────────────────

/** Escape user/data-derived text before it lands in the HTML body. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A single-column, 560px-max email body: preheader, headline, body rows, one
 * CTA button, footer. Inline styles only (email-client safe). Renders fine at
 * 380px because the outer table is width:100% capped at 560 with no fixed
 * inner columns (WP7-11).
 */
function emailShell(opts: {
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}): string {
  return [
    `<div style="background:#f6f7fb;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e8f0;border-radius:12px;">`,
    `<tr><td style="padding:24px 24px 8px;">`,
    `<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5b3df5;font-weight:600;">Mapsly</div>`,
    `<h1 style="font-size:20px;line-height:1.3;margin:8px 0 0;color:#1a1a2e;">${opts.heading}</h1>`,
    `</td></tr>`,
    `<tr><td style="padding:8px 24px 4px;font-size:14px;line-height:1.55;color:#3a3a52;">${opts.bodyHtml}</td></tr>`,
    `<tr><td style="padding:16px 24px 24px;">`,
    `<a href="${opts.ctaUrl}" style="display:inline-block;background:#5b3df5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${esc(opts.ctaLabel)} →</a>`,
    `</td></tr>`,
    `<tr><td style="padding:0 24px 24px;font-size:12px;line-height:1.5;color:#8a8aa0;border-top:1px solid #eef0f6;padding-top:16px;">${opts.footer}</td></tr>`,
    `</table></div>`,
  ].join("");
}

// ── WP6-3 · run-finished ─────────────────────────────────────────────────────

export interface RunFinishedEmailOptions {
  to: string;
  agencyName: string;
  /** Absolute workbench deep-link (the research the run belongs to). */
  workbenchUrl: string;
  /** OK · PARTIAL · FAILED (run terminal state). */
  outcome: "OK" | "PARTIAL" | "FAILED";
  /** Leads enriched cleanly. */
  enriched: number;
  /** Leads that couldn't complete. */
  failed: number;
  /** Credits refunded (fresh-cache + unused hold + failed-lead refund). */
  refunded: number;
}

/**
 * WP6-3 · the "your leads are ready" pull-back email. Sent when an EnrichmentRun
 * reaches a terminal state, so a user who closed the tab is drawn back to the
 * leads they paid for. Best-effort — never throws.
 */
export async function sendRunFinished(
  opts: RunFinishedEmailOptions,
): Promise<boolean> {
  const failLine =
    opts.failed > 0
      ? ` · ${opts.failed.toLocaleString()} couldn't complete`
      : "";
  const refundLine =
    opts.refunded > 0
      ? ` · ${opts.refunded.toLocaleString()} credits refunded`
      : "";

  const heading =
    opts.outcome === "FAILED"
      ? "Your enrichment run couldn't complete"
      : `${opts.enriched.toLocaleString()} leads enriched`;

  const summary =
    opts.outcome === "FAILED"
      ? "The run failed before your leads could be enriched — no credits were charged. Retry it from the workbench."
      : `Enriched ${opts.enriched.toLocaleString()} lead${opts.enriched === 1 ? "" : "s"}${failLine}${refundLine}. You only paid for the leads that landed.`;

  const html = emailShell({
    heading: esc(heading),
    bodyHtml: `<p style="margin:0 0 4px;">${esc(summary)}</p>`,
    ctaLabel:
      opts.outcome === "FAILED" ? "Retry in the workbench" : "See your leads",
    ctaUrl: opts.workbenchUrl,
    footer: `${esc(opts.agencyName)} · Mapsly. You get this because you started an enrichment run.`,
  });

  const text = [
    heading,
    "",
    summary,
    "",
    opts.outcome === "FAILED" ? "Retry in the workbench:" : "See your leads:",
    opts.workbenchUrl,
  ].join("\n");

  return sendAgencyEmail({
    to: opts.to,
    subject:
      opts.outcome === "FAILED"
        ? `${opts.agencyName} · enrichment run couldn't complete`
        : `${opts.agencyName} · ${opts.enriched.toLocaleString()} leads ready`,
    html,
    text,
  });
}

// ── WP6-2 · weekly "your market moved" digest ────────────────────────────────

/** One deep-linked line in the digest ("4 new matches", "2 new 1★", …). */
export interface DigestChange {
  /** Human label, e.g. "3 new medical spas match your reviews research". */
  label: string;
  /** Absolute deep-link into the workbench for this research. */
  url: string;
}

export interface AgencyDigestEmailOptions {
  to: string;
  agencyName: string;
  /** The week's changes across the agency's active researches (non-empty — the
   *  caller suppresses the send when there's nothing to report). */
  changes: DigestChange[];
  /** Absolute "My research" deep-link for the freshness / re-enrich nudge. */
  researchUrl: string;
}

/**
 * WP6-2 · the weekly market-moved digest. One email per agency with ≥1 change
 * this week (the caller suppresses empties). Best-effort — never throws.
 */
export async function sendAgencyDigest(
  opts: AgencyDigestEmailOptions,
): Promise<boolean> {
  const rows = opts.changes
    .slice(0, 12)
    .map(
      (c) =>
        `<p style="margin:0 0 8px;"><a href="${c.url}" style="color:#5b3df5;text-decoration:none;font-weight:600;">${esc(c.label)}</a></p>`,
    )
    .join("");

  const html = emailShell({
    heading: "Your market moved this week",
    bodyHtml: `${rows}<p style="margin:12px 0 0;color:#8a8aa0;font-size:13px;">Re-enrich to pull the latest signals into your workbench.</p>`,
    ctaLabel: "Open my research",
    ctaUrl: opts.researchUrl,
    footer: `${esc(opts.agencyName)} · Mapsly weekly digest. Reflects the past week's refreshed data across your active researches.`,
  });

  const text = [
    "Your market moved this week",
    "",
    ...opts.changes.slice(0, 12).map((c) => `- ${c.label}\n  ${c.url}`),
    "",
    "Re-enrich to pull the latest signals in. Open my research:",
    opts.researchUrl,
  ].join("\n");

  return sendAgencyEmail({
    to: opts.to,
    subject: `${opts.agencyName} · your market moved this week`,
    html,
    text,
  });
}
