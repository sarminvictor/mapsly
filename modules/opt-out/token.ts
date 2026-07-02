// modules/opt-out/token.ts · HMAC-signed tokens for the public /opt-out flow.
//
// WP7-2. The public do-not-sell page lets a business owner remove their data.
// To prove control of the email before we suppress anything, we email a
// verification link carrying a stateless HMAC token (no DB row to mint). The
// link POSTs back to /opt-out/[token], which verifies + writes the suppression.
//
// Domain separation: every payload is prefixed "optout:" and signed with the
// shared secret. An opt-out token can NEVER verify as a cold /u unsubscribe
// token (whose payload is a bare base64url email) or an /o open-pixel token
// (prefix "open:") — the prefix check rejects cross-family tokens even though
// all three share the secret.
//
// Secret resolution mirrors services/cold-mailer/config.ts:
//   COLD_UNSUBSCRIBE_SECRET → AUTH_SECRET → NEXTAUTH_SECRET.
// In non-prod envs without any of those, a fixed dev sentinel keeps the flow
// working (the tokens are only meaningful within one deployment anyway).

import { createHmac, timingSafeEqual } from "node:crypto";

import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";

const OPTOUT_PREFIX = "optout:";

function secret(): string {
  return (
    process.env.COLD_UNSUBSCRIBE_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "dev-optout-secret-not-for-production"
  );
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Build a verification token for an email (`${base64url("optout:"+email)}.${hmac}`). */
export function makeOptOutToken(email: string): string {
  const payload = Buffer.from(
    `${OPTOUT_PREFIX}${email.toLowerCase()}`,
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the lowercased email if the token is a valid opt-out token, else null. */
export function verifyOptOutToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    // Domain separation — only opt-out-family payloads pass.
    if (!decoded.startsWith(OPTOUT_PREFIX)) return null;
    const email = decoded.slice(OPTOUT_PREFIX.length).toLowerCase();
    return email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

/** Absolute verification URL for the opt-out confirmation email. */
export function optOutUrlFor(email: string): string {
  return `${getMapslyPublicUrl()}/opt-out/${makeOptOutToken(email)}`;
}
