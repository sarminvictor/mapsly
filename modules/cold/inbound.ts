/**
 * Inbound message classification for the cold mailboxes — pure functions
 * (unit-tested), consumed by app/api/cron/poll-cold-inboxes.
 *
 * Four outcomes, in priority order:
 *   bounce      → NDR/DSN. Hard (5.x.x) → suppress + stop sequence.
 *   auto-reply  → out-of-office etc. Sequence CONTINUES (standard practice).
 *   unsubscribe → opt-out via reply/mailto. Suppress + stop sequence.
 *   reply       → a human wrote back. Stop sequence, alert the owner.
 */

export type InboundKind = "bounce" | "auto-reply" | "unsubscribe" | "reply";

export interface InboundMessage {
  /** Envelope From address, lowercased ("" when missing). */
  from: string;
  subject: string;
  /** Raw RFC 822 source (headers + body), best-effort decoded. */
  source: string;
}

export interface InboundClassification {
  kind: InboundKind;
  /** For bounces: the address the NDR reports as failed (null if unparsable). */
  bouncedEmail: string | null;
  /** For bounces: true when the DSN status is 5.x.x (or clearly final). */
  hardBounce: boolean;
}

const BOUNCE_FROM = /(^|<)(mailer-daemon|postmaster)@/i;
const BOUNCE_SUBJECT =
  /delivery status notification|undeliver|delivery (has )?failed|mail delivery failed|returned mail|failure notice|delivery failure/i;
const AUTO_SUBJECT =
  /out of (the )?office|automatic reply|auto-?reply|autoreply|vacation|away from (the )?office|on leave/i;
const UNSUB_INTENT =
  /unsubscribe|opt[ -]?out|remove me|stop (emailing|sending|contacting)/i;
// Auto-acknowledgements ("We have received your email — give us 24-48h, one of
// our specialists will respond"). Machines, not humans — the sequence must
// CONTINUE, same as OOO. These carry no standard Auto-Submitted header and a
// fresh (non-"Re:") subject, so the OOO patterns above miss them (INC: Grace
// Surgical Arts auto-ack was mis-tagged as a human reply, 2026-06-15).
const AUTO_ACK_SUBJECT =
  /\bwe('ve| have)? received your\b|\bthank(s| you)? for (contacting|emailing|reaching out)\b|\byour (email|message|request|inquiry) (has been|was) received\b|\bauto[- ]?(reply|ack|response|acknowledge?ment)\b|\bautomated response\b/i;
const AUTO_ACK_BODY =
  /\bwe('ve| have)? (just )?received your (email|message|inquiry|request)\b|\bone of our (specialists|team|representatives|staff|associates|agents) will\b|\b(please )?(give|allow) us \d+\s*[-–to ]+\s*\d*\s*(business )?(hours|days) to (respond|reply|get back)\b|\bthis is an automated\b/i;

/** First `Header:` value in the raw source (headers end at the blank line). */
function header(source: string, name: string): string | null {
  const head = source.slice(0, source.indexOf("\r\n\r\n") + 1 || 8192);
  const m = head.match(new RegExp(`^${name}:[ \\t]*(.+)$`, "im"));
  return m?.[1]?.trim() ?? null;
}

/** Extract the failed recipient from an NDR (RFC 3464 first, heuristics after). */
export function extractBouncedEmail(source: string): string | null {
  const final = source.match(
    /Final-Recipient:\s*rfc822;\s*<?([^\s<>;,]+@[^\s<>;,]+)/i,
  );
  if (final?.[1]) return final[1].toLowerCase();
  const original = source.match(
    /Original-Recipient:\s*rfc822;\s*<?([^\s<>;,]+@[^\s<>;,]+)/i,
  );
  if (original?.[1]) return original[1].toLowerCase();
  const xFailed = source.match(
    /X-Failed-Recipients:\s*<?([^\s<>;,]+@[^\s<>;,]+)/i,
  );
  if (xFailed?.[1]) return xFailed[1].toLowerCase();
  return null;
}

export function classifyInbound(msg: InboundMessage): InboundClassification {
  const contentType = header(msg.source, "Content-Type") ?? "";
  const isBounce =
    BOUNCE_FROM.test(msg.from) ||
    /multipart\/report/i.test(contentType) ||
    BOUNCE_SUBJECT.test(msg.subject);
  if (isBounce) {
    const status = msg.source.match(/^Status:\s*([45])\.\d+\.\d+/im);
    // No parsable DSN status → treat failure-subject NDRs as final (most
    // are), EXCEPT explicit delay notifications — those are transient.
    const hard = status ? status[1] === "5" : !/delay/i.test(msg.subject);
    return {
      kind: "bounce",
      bouncedEmail: extractBouncedEmail(msg.source),
      hardBounce: hard,
    };
  }

  // Cleaned first chunk of the body — quoted lines + our footer stripped, so
  // neither the auto-ack nor the unsubscribe check trips on quoted content.
  // Replies quote OUR footer ("Unsubscribe: https://…"); without this, every
  // "yes, send it" reply to touch 2-3 would look like an unsubscribe.
  const sep = msg.source.indexOf("\r\n\r\n");
  const bodyStart = (
    sep === -1 ? "" : msg.source.slice(sep + 4, sep + 4 + 2000)
  )
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l) && !/^On .+ wrote:/.test(l))
    .join("\n")
    .replace(/unsubscribe:?\s*https?:\/\/\S+/gi, "");

  const autoSubmitted = header(msg.source, "Auto-Submitted");
  // A genuine human reply is "Re: <our subject>"; auto-acks carry a fresh
  // subject — so only honor a subject-based ack when it is NOT a reply prefix.
  const replyPrefix = /^\s*(re|aw|sv|ref|fwd?)\s*:/i.test(msg.subject ?? "");
  if (
    (autoSubmitted && autoSubmitted.toLowerCase() !== "no") ||
    header(msg.source, "X-Autoreply") != null ||
    header(msg.source, "X-Autorespond") != null ||
    AUTO_SUBJECT.test(msg.subject) ||
    (!replyPrefix && AUTO_ACK_SUBJECT.test(msg.subject)) ||
    AUTO_ACK_BODY.test(bodyStart)
  ) {
    return { kind: "auto-reply", bouncedEmail: null, hardBounce: false };
  }

  // Opt-out intent in the subject or the cleaned body.
  if (UNSUB_INTENT.test(msg.subject) || UNSUB_INTENT.test(bodyStart)) {
    return { kind: "unsubscribe", bouncedEmail: null, hardBounce: false };
  }

  return { kind: "reply", bouncedEmail: null, hardBounce: false };
}
