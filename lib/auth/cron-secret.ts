// WP8-3 · Timing-safe CRON_SECRET verification for server-to-server routes.
//
// Every internal cron / worker-callback route authenticates with
// `Authorization: Bearer <CRON_SECRET>`. Comparing with `!==` leaks length and
// prefix-match timing; a shared helper uses `crypto.timingSafeEqual` over
// equal-length buffers and rejects length mismatches early (per
// `.claude/rules/security.md`). Returns a discriminated result so callers keep
// their existing 401/500 response shapes.

import { timingSafeEqual } from "node:crypto";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "unauthorized" };

/** Constant-time compare of two secrets. False on any length mismatch. */
export function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a request's `Authorization: Bearer <CRON_SECRET>` header in constant
 * time. `not_configured` → the server is missing CRON_SECRET (respond 500);
 * `unauthorized` → bad/absent token (respond 401).
 */
export function verifyCronAuth(req: Request): CronAuthResult {
  const expected = process.env.CRON_SECRET;
  if (!expected) return { ok: false, reason: "not_configured" };
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return { ok: false, reason: "unauthorized" };
  const token = header.slice(prefix.length);
  return secretsMatch(token, expected)
    ? { ok: true }
    : { ok: false, reason: "unauthorized" };
}
