/**
 * Cold-email open-tracking pixel · /o/[token] · plan #7.
 *
 * GET only. The token is a stateless HMAC over the ColdSend id
 * (modules/cold/token.ts — "open:"-prefixed payload, domain-separated from
 * the /u email tokens so the two families can never cross-verify).
 *
 * CONTRACT: ALWAYS answer 200 with the transparent 1x1 GIF — invalid token,
 * unknown send, DB error, even when rate-limited. Mail clients render this
 * URL as an inline image; a 4xx/5xx shows a broken-image glyph and a status
 * difference would leak token validity to probes. Recording is strictly
 * best-effort (same posture as /api/landing-events): on rate-limit we skip
 * the write and still serve the GIF. No redirects, no caching.
 *
 * What gets recorded (RAW fields are authoritative — classification lives in
 * lib/bot-detect so heuristics can evolve and stats re-derive):
 *   - openCount +1 · lastOpenedAt = now (every fetch)
 *   - first fetch also sets firstOpenedAt, firstOpenUserAgent (≤400 chars),
 *     suspectedPrefetch = isPrefetchOpen(<5s after sentAt OR proxy/scanner UA)
 *   - suspectedPrefetch means "every open so far looked like machine
 *     prefetch" — the first human-looking open CLEARS it
 *
 * Opens are a fuzzy upper bound (Apple MPP auto-fetches with a generic UA —
 * only the <5s window nets it); clicks/landing visits are the truth and the
 * only funnel-gate denominators (lib/funnel-thresholds). Locale-agnostic
 * (middleware bypass next to /u, /r). No-index.
 */

import { z } from "zod";

import { isPrefetchOpen } from "@/lib/bot-detect";
import { ipKey, PUBLIC_LIMIT, rateLimit } from "@/lib/middleware/rate-limit";
import prisma, { Prisma } from "@/lib/prisma";

import { verifyOpenToken } from "@/modules/cold/token";

/** Transparent 1x1 GIF (GIF89a, 42 bytes) — the classic tracking pixel. */
const TRANSPARENT_GIF = new Uint8Array(
  Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  ),
);

/** `${base64url(payload)}.${base64url(hmac)}` — cheap shape gate pre-HMAC. */
const TokenSchema = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

function gif(): Response {
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "content-length": String(TRANSPARENT_GIF.byteLength),
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "x-robots-tag": "noindex",
    },
  });
}

async function recordOpen(coldSendId: string, userAgent: string) {
  const now = new Date();
  const send = await prisma.coldSend.findUnique({
    where: { id: coldSendId },
    select: { sentAt: true, firstOpenedAt: true, suspectedPrefetch: true },
  });
  if (!send) return; // row deleted (cascade) — nothing to record

  // sentAt should always be set by the time the pixel is fetchable; if it
  // somehow isn't, delta 0 → prefetch, which is the safe (discounting) side.
  const prefetch = isPrefetchOpen({
    sentAt: send.sentAt ?? now,
    openedAt: now,
    userAgent,
  });

  const data: Prisma.ColdSendUpdateInput = {
    openCount: { increment: 1 }, // non-null @default(0) — prisma.md §5b safe
    lastOpenedAt: now,
  };
  if (!send.firstOpenedAt) {
    data.firstOpenedAt = now;
    data.firstOpenUserAgent = userAgent.slice(0, 400) || null;
    data.suspectedPrefetch = prefetch;
  } else if (!prefetch && send.suspectedPrefetch) {
    data.suspectedPrefetch = false; // a human-looking open arrived — upgrade
  }
  await prisma.coldSend.update({ where: { id: coldSendId }, data });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    // Best-effort limiter: when limited we skip recording but STILL serve
    // the GIF — never 429 an email image, never leak token validity.
    const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
    if (!limited) {
      const { token } = await ctx.params;
      const parsed = TokenSchema.safeParse(token);
      const coldSendId = parsed.success ? verifyOpenToken(parsed.data) : null;
      if (coldSendId) {
        await recordOpen(coldSendId, req.headers.get("user-agent") ?? "");
      }
    }
  } catch {
    // Recording must never break the image response (contract above).
  }
  return gif();
}
