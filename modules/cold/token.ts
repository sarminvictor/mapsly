/**
 * One-click unsubscribe tokens — HMAC-signed, stateless (no DB row to mint).
 * `${base64url(email)}.${hmac}` → verifiable + tamper-proof via COLD_UNSUBSCRIBE_SECRET.
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
    return Buffer.from(payload, "base64url").toString("utf8").toLowerCase();
  } catch {
    return null;
  }
}

export function unsubscribeUrlFor(email: string): string {
  const { baseUrl } = getColdSenderConfig();
  return `${baseUrl}/u/${makeUnsubscribeToken(email)}`;
}
