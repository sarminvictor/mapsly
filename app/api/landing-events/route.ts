/**
 * Landing-page funnel event ingest · POST /api/landing-events.
 *
 * Receives best-effort beacons from the public landing pages (PAGE_OPENED,
 * SECTION_VIEWED, CTA_CLICKED, CHECKOUT_OPENED) and records a LandingEvent.
 * SUBSCRIPTION_BOUGHT is NOT accepted here — it's emitted server-side from the
 * Stripe webhook (a client can't be trusted to claim a conversion).
 *
 * Public, unauthenticated by design — rate-limited by IP, bot-filtered, and
 * Zod-validated. The raw IP is never stored: only a salted hash (`ipHash`),
 * per `.claude/rules/security.md` PII handling. Always returns 200 (analytics
 * must never surface an error to the visitor) except on rate-limit / bad input.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import prisma from "@/lib/prisma";
import { PUBLIC_LIMIT, ipKey, rateLimit } from "@/lib/middleware/rate-limit";

const Body = z.object({
  token: z.string().regex(/^[1-9][0-9]{15}$/),
  type: z.enum([
    "PAGE_OPENED",
    "SECTION_VIEWED",
    "CTA_CLICKED",
    "CHECKOUT_OPENED",
  ]),
  section: z.string().max(40).optional(),
  visitorId: z.string().max(64).optional(),
  sessionId: z.string().max(64).optional(),
  stripeSessionId: z.string().max(160).optional(),
});

const BOT_RE =
  /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|embedly|quora link|whatsapp|telegrambot|bingbot|googlebot|applebot|semrush|ahrefs|lighthouse/i;

function hashIp(ip: string): string {
  const salt = process.env.AUTH_SECRET ?? "mapsly-landing";
  return createHash("sha256")
    .update(`${salt}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}

export async function POST(req: Request): Promise<Response> {
  // Rate-limit by IP — best-effort. A limiter failure must NEVER drop the
  // beacon (this is analytics), so any throw here falls through to "allow".
  try {
    const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
    if (limited) return limited;
  } catch {
    /* limiter unavailable — allow */
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const input = parsed.data;

  try {
    const landing = await prisma.landingPage.findUnique({
      where: { token: input.token },
      select: { id: true, isActive: true },
    });
    // Silently accept unknown / revoked tokens — don't reveal which exist.
    if (!landing || !landing.isActive) return Response.json({ ok: true });

    const ua = req.headers.get("user-agent") ?? "";
    const isBot = BOT_RE.test(ua);

    await prisma.landingEvent.create({
      data: {
        landingPageId: landing.id,
        type: input.type,
        section: input.section ?? null,
        visitorId: input.visitorId ?? null,
        sessionId: input.sessionId ?? null,
        stripeSessionId: input.stripeSessionId ?? null,
        ipHash: hashIp(ipKey(req)),
        userAgent: ua.slice(0, 400) || null,
        isBot,
      },
    });

    // Cheap denormalized open counter (real visitors only).
    if (input.type === "PAGE_OPENED" && !isBot) {
      await prisma.landingPage.update({
        where: { id: landing.id },
        data: { viewCount: { increment: 1 } },
      });
    }

    return Response.json({ ok: true });
  } catch {
    // Never surface ingest errors to the visitor.
    return Response.json({ ok: true });
  }
}
