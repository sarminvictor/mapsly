// modules/opt-out/email.ts · the do-not-sell verification email (WP7-2).
//
// Best-effort transactional send via Resend's REST API (the mapsly.ai path,
// same helper shape as modules/marketing-lead/email.ts — NEVER the cold Zoho
// mailboxes). Swallows errors: a failed send must not 500 the public page (the
// page tells the visitor to check their inbox regardless; a missing key in dev
// is a silent skip). Env read at call time (vercel.md INC-07).
//
// The email carries the HMAC verification link (modules/opt-out/token.ts). We
// email the address rather than suppress on submit so a stranger can't opt out
// someone else's business by typing their email — control of the inbox is the
// proof, exactly like a magic link.

import { renderEmailShell } from "@/lib/email/shell";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function resendKey(): string | undefined {
  return process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? "login@mapsly.ai";
}

/**
 * Send the opt-out verification link. Returns true if a send was attempted
 * (key present), false if skipped (no key in this env). Never throws.
 */
export async function sendOptOutVerification(opts: {
  to: string;
  verifyUrl: string;
}): Promise<boolean> {
  try {
    const apiKey = resendKey();
    if (!apiKey) return false; // no key in this env — skip silently
    const text = [
      "Hi,",
      "",
      "You (or someone) asked to remove this business's information from Mapsly.",
      "",
      "To confirm, open this link:",
      opts.verifyUrl,
      "",
      "If you didn't request this, you can ignore this email — nothing changes unless you click the link.",
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
        subject: "Confirm your Mapsly opt-out request",
        text,
        html: renderEmailShell({
          heading: "Confirm your opt-out request",
          bodyHtml:
            "You (or someone) asked to remove this business's information from Mapsly.<br/><br/>" +
            "To confirm, click the button below. If you didn't request this, ignore this email — nothing changes unless you click.",
          cta: { label: "Confirm removal", url: opts.verifyUrl },
          reason:
            "You're receiving this because an opt-out was requested for a business associated with this address.",
        }),
      }),
    });
    return true;
  } catch {
    // Best-effort — a delivery failure must not break the public page.
    return false;
  }
}
