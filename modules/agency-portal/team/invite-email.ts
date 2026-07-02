// modules/agency-portal/team/invite-email.ts · the WP5-8 seat-invite email.
//
// Sent via Resend's REST API on the mapsly.ai transactional path (same
// pattern as modules/marketing-lead/email.ts — NEVER the cold mailboxes).
// Best-effort by contract: a failed email must not undo the created invite
// (the caller surfaces the link too, so the owner can paste it into Slack).
// Env is read at call time (vercel.md INC-07).
//
// Agency voice (the recipient is a teammate joining a tool): terse, direct,
// no fluff — per .claude/rules/copy-voice.md § Agency.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function resendKey(): string | undefined {
  return process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? "login@mapsly.ai";
}

export interface SendInviteEmailOptions {
  to: string;
  agencyName: string;
  inviterEmail: string;
  role: string;
  /** Absolute accept URL (/signin?invite=<token>&email=…). */
  acceptUrl: string;
}

/** Send the invite. Returns true when the request was accepted by Resend. */
export async function sendInviteEmail(
  opts: SendInviteEmailOptions,
): Promise<boolean> {
  try {
    const apiKey = resendKey();
    if (!apiKey) return false; // no key in this env — caller shows the link
    const text = [
      `${opts.inviterEmail} invited you to ${opts.agencyName} on Mapsly (role: ${opts.role.toLowerCase()}).`,
      "",
      "Mapsly is the team's prospecting workspace — shared researches, leads, and outreach drafts, one pooled credit wallet.",
      "",
      `Accept the invite (sign in with this email address):`,
      opts.acceptUrl,
      "",
      "The link expires in 7 days. If you weren't expecting this, ignore it.",
    ].join("\n");

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: opts.to,
        subject: `${opts.agencyName} · you're invited to Mapsly`,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "team.invite-email.failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return false;
  }
}
