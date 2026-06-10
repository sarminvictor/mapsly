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
    // No parsable DSN status → treat failure-subject NDRs as final (most are).
    const hard = status ? status[1] === "5" : true;
    return {
      kind: "bounce",
      bouncedEmail: extractBouncedEmail(msg.source),
      hardBounce: hard,
    };
  }

  const autoSubmitted = header(msg.source, "Auto-Submitted");
  if (
    (autoSubmitted && autoSubmitted.toLowerCase() !== "no") ||
    header(msg.source, "X-Autoreply") != null ||
    header(msg.source, "X-Autorespond") != null ||
    AUTO_SUBJECT.test(msg.subject)
  ) {
    return { kind: "auto-reply", bouncedEmail: null, hardBounce: false };
  }

  // Opt-out intent in the subject or the first chunk of the body.
  const bodyStart = msg.source
    .slice(msg.source.indexOf("\r\n\r\n"))
    .slice(0, 1000);
  if (UNSUB_INTENT.test(msg.subject) || UNSUB_INTENT.test(bodyStart)) {
    return { kind: "unsubscribe", bouncedEmail: null, hardBounce: false };
  }

  return { kind: "reply", bouncedEmail: null, hardBounce: false };
}
