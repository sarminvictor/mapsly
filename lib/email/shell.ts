// lib/email/shell.ts · the ONE house template for transactional email.
//
// Extracted from modules/agency-portal/notify/email.ts (WP7-11) so every
// transactional sender — sign-in magic link, team invites, opt-out confirms,
// free-report confirmations, run-finished notifications — renders the same
// branded card: wordmark → heading → body → optional CTA button → standard
// footer. Email-safe by construction: single table, inline styles only, no
// external assets, no webfonts (system font stack), works in Gmail/Outlook.
//
// Keep it boring. Transactional email is not a design surface — it's a
// consistency surface.

/** Minimal HTML escape for user-supplied strings interpolated into the shell. */
export function escapeEmailHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface EmailShellOptions {
  /** Card heading (plain text — escaped here). */
  heading: string;
  /** Body HTML (caller escapes any user-supplied fragments). */
  bodyHtml: string;
  /** Optional CTA button. */
  cta?: { label: string; url: string };
  /**
   * One-line "why you got this" — the footer's first line, e.g. "You're
   * receiving this because you requested a sign-in link for this address."
   */
  reason: string;
}

/** Render the full branded HTML document for a transactional email. */
export function renderEmailShell(opts: EmailShellOptions): string {
  const cta = opts.cta
    ? `<tr><td style="padding:16px 24px 24px;">` +
      `<a href="${opts.cta.url}" style="display:inline-block;background:#5b3df5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${escapeEmailHtml(opts.cta.label)} &rarr;</a>` +
      `</td></tr>`
    : "";
  return [
    `<div style="background:#f6f7fb;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e8f0;border-radius:12px;">`,
    `<tr><td style="padding:24px 24px 8px;">`,
    `<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5b3df5;font-weight:600;">Mapsly</div>`,
    `<h1 style="font-size:20px;line-height:1.3;margin:8px 0 0;color:#1a1a2e;">${escapeEmailHtml(opts.heading)}</h1>`,
    `</td></tr>`,
    `<tr><td style="padding:8px 24px 4px;font-size:14px;line-height:1.55;color:#3a3a52;">${opts.bodyHtml}</td></tr>`,
    cta,
    `<tr><td style="padding:16px 24px 24px;">`,
    `<div style="border-top:1px solid #eef0f6;padding-top:14px;font-size:12px;line-height:1.6;color:#8a8aa0;">`,
    `${escapeEmailHtml(opts.reason)}<br/>`,
    `Mapsly &middot; local-business intelligence &middot; <a href="https://www.mapsly.ai" style="color:#8a8aa0;">mapsly.ai</a><br/>`,
    `530 3 St SE, Calgary, AB, Canada`,
    `</div>`,
    `</td></tr>`,
    `</table></div>`,
  ].join("");
}
