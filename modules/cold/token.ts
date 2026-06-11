/**
 * HMAC-signed, stateless tokens for cold-email links (no DB row to mint).
 * Secret: COLD_UNSUBSCRIBE_SECRET (services/cold-mailer/config.ts).
 *
 *  - Unsubscribe (/u):  `${base64url(email)}.${hmac}`
 *  - Open pixel  (/o):  `${base64url("open:" + coldSendId)}.${hmac}`
 *
 * The "open:" prefix domain-separates the two token families — a valid /u
 * token can never verify as an open token (and vice versa) even though both
 * are signed with the same secret.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { getColdSenderConfig } from "@/services/cold-mailer/config";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function makeUnsubscribeToken(email: string): string {
  const { unsubscribeSecret } = getColdSenderConfig();
  const payload = Buffer.from(email.toLowerCase()).toString("base64url");
  return `${payload}.${sign(payload, unsubscribeSecret)}`;
}

/** Returns the lowercased email if the token is valid, else null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const { unsubscribeSecret } = getColdSenderConfig();
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload, unsubscribeSecret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    // Domain separation — an open-pixel token must never pass as an email.
    if (decoded.startsWith(OPEN_PREFIX)) return null;
    return decoded.toLowerCase();
  } catch {
    return null;
  }
}

export function unsubscribeUrlFor(email: string): string {
  const { baseUrl } = getColdSenderConfig();
  return `${baseUrl}/u/${makeUnsubscribeToken(email)}`;
}

// ── Open-tracking pixel tokens · plan #7 ─────────────────────────────────
// HMAC over the ColdSend id (NOT the recipient email — one send = one pixel,
// so step 1 and step 2 opens are distinguishable). The send row exists before
// dispatch (created at enroll/scheduling), so the URL can be embedded at
// render time in process-cold-sequences.

const OPEN_PREFIX = "open:";

export function makeOpenToken(coldSendId: string): string {
  const { unsubscribeSecret } = getColdSenderConfig();
  const payload = Buffer.from(`${OPEN_PREFIX}${coldSendId}`).toString(
    "base64url",
  );
  return `${payload}.${sign(payload, unsubscribeSecret)}`;
}

/** Returns the ColdSend id if the token is a valid OPEN token, else null. */
export function verifyOpenToken(token: string): string | null {
  const { unsubscribeSecret } = getColdSenderConfig();
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload, unsubscribeSecret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    if (!decoded.startsWith(OPEN_PREFIX)) return null; // /u token or garbage
    const id = decoded.slice(OPEN_PREFIX.length);
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Absolute pixel URL for a ColdSend — embed via toHtmlBody's pixel slot. */
export function openPixelUrlFor(coldSendId: string): string {
  const { baseUrl } = getColdSenderConfig();
  return `${baseUrl}/o/${makeOpenToken(coldSendId)}`;
}
