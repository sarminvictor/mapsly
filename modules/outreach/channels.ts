// modules/outreach/channels.ts · render a grounded first-touch for a specific
// outreach channel (email · phone script · social DM).
//
// All three channels reuse the SAME grounding as buildFirstTouch — they cite
// only real signals, drop absent ones, and never emit an unfilled token. What
// differs is length + format:
//
//   email        → the full skeleton (opener + pains + close + CAN-SPAM footer)
//   phone_script → a short spoken call script (no footer, line-prefixed for the
//                  caller, ends on a question; CAN-SPAM footer is email-only)
//   social_dm    → a 1–2 line DM, no footer, no signature, conversational
//
// Pure + deterministic. The gpt-5.4-nano fluency pass (nano-fill.ts) can run on
// the email channel's body afterward; phone/social are intentionally terse and
// don't need it.
//
// See:
//   - modules/outreach/first-touch.ts — buildFirstTouch / FirstTouch / TouchSignals

import {
  buildFirstTouch,
  type FirstTouch,
  type PredictedTier,
  type TouchSignals,
} from "./first-touch";

/** The channels this renderer supports. */
export type OutreachChannel = "email" | "phone_script" | "social_dm";

export interface ChannelTouchOptions {
  channel: OutreachChannel;
  /** What the agency is selling (appears in the opener / pitch). */
  sellingWhat: string;
  /** Required for the email channel per CAN-SPAM (physical address). */
  mailingAddress?: string | null;
  unsubscribeUrl?: string | null;
}

export interface ChannelTouch {
  channel: OutreachChannel;
  /** Subject — present only for email. */
  subject?: string;
  body: string;
  why: string[];
  predictedTier: PredictedTier;
  usedSignals: string[];
  droppedTokens: string[];
}

/**
 * Build a channel-appropriate first touch from grounded signals.
 *
 * Email delegates to buildFirstTouch (full skeleton + CAN-SPAM footer; throws
 * without a mailing address). Phone + social reuse the same grounded skeleton
 * (built with channel "dm" so no footer is appended) and re-render the pieces
 * at the right length/format.
 */
export function buildChannelTouch(
  signals: TouchSignals,
  opts: ChannelTouchOptions,
): ChannelTouch {
  if (opts.channel === "email") {
    const touch = buildFirstTouch(signals, {
      sellingWhat: opts.sellingWhat,
      channel: "email",
      mailingAddress: opts.mailingAddress ?? null,
      unsubscribeUrl: opts.unsubscribeUrl ?? null,
    });
    return toChannelTouch("email", touch);
  }

  // Phone + social: grounding identical, render different. We build the
  // skeleton on the footer-free "dm" channel to reuse the same pain selection,
  // then re-render the chosen lines.
  const grounded = buildFirstTouch(signals, {
    sellingWhat: opts.sellingWhat,
    channel: "dm",
  });

  const body =
    opts.channel === "phone_script"
      ? renderPhoneScript(signals, grounded, opts.sellingWhat)
      : renderSocialDm(signals, grounded);

  return {
    channel: opts.channel,
    // Phone + social have no subject line.
    subject: undefined,
    body,
    why: grounded.why,
    predictedTier: grounded.predictedTier,
    usedSignals: grounded.usedSignals,
    droppedTokens: grounded.droppedTokens,
  };
}

/** Re-shape a FirstTouch into the ChannelTouch envelope (email path). */
function toChannelTouch(channel: OutreachChannel, t: FirstTouch): ChannelTouch {
  return {
    channel,
    subject: t.subject,
    body: t.body,
    why: t.why,
    predictedTier: t.predictedTier,
    usedSignals: t.usedSignals,
    droppedTokens: t.droppedTokens,
  };
}

/**
 * The body lines the email skeleton put together are joined with "\n\n"; for
 * phone + social we want the individual paragraphs back. Split on the blank
 * line so we can re-render at the right cadence.
 */
function paragraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * A short spoken call script. The caller reads it aloud, so it's prefixed by
 * cue labels and kept conversational. No footer (CAN-SPAM is email-only),
 * ends on a question to open the conversation.
 */
function renderPhoneScript(
  signals: TouchSignals,
  grounded: FirstTouch,
  sellingWhat: string,
): string {
  const paras = paragraphs(grounded.body);
  // paras[0] = opener, middle = pain(s), last = close question.
  const opener = `Hi, is this ${signals.businessName}? I work with ${sellingWhat} businesses${signals.city ? ` around ${signals.city}` : ""}.`;
  const painParas = paras.slice(1, Math.max(1, paras.length - 1));
  const close =
    paras.length > 1
      ? paras[paras.length - 1]
      : `Mind if I send over a quick look at ${signals.businessName}?`;

  const lines: string[] = [];
  lines.push(`[Open] ${opener}`);
  if (painParas.length > 0) {
    lines.push(`[Reason for call] ${painParas.join(" ")}`);
  }
  lines.push(`[Ask] ${close}`);
  lines.push(`[If yes] Great — what's the best email to send it to?`);
  lines.push(`[If no] No problem at all — thanks for your time.`);
  return lines.join("\n");
}

/**
 * A 1–2 line social DM. No footer, no signature — just the sharpest grounded
 * hook and a soft ask. Kept short because DMs that read like emails get
 * ignored.
 */
function renderSocialDm(signals: TouchSignals, grounded: FirstTouch): string {
  const paras = paragraphs(grounded.body);
  // Sharpest pain is the first body paragraph after the opener (if any).
  const pain = paras.length > 1 ? paras[1] : "";
  const hook = pain
    ? `Hi ${signals.businessName} — ${lowerFirst(pain)}`
    : `Hi ${signals.businessName} — had a look at your online presence and spotted a couple of quick wins.`;
  const ask = `Want me to send over what I found?`;
  // 1–2 lines, no footer.
  return `${hook}\n${ask}`;
}

/** Lowercase the first character of a sentence so it flows after an em-dash. */
function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}
