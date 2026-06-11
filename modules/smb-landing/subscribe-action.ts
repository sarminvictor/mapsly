"use server";

/**
 * Free weekly-score signup · server action (plan #7).
 *
 * The low-commitment second CTA on /l: "Get your score by email every week —
 * free." Creates the ENGAGED-list row (`WeeklyScoreSubscriber`) + its EXPRESS
 * `ConsentRecord` + a server-emitted `FREE_SIGNUP` LandingEvent in ONE
 * transaction. FREE_SIGNUP is NEVER accepted from the client beacon at
 * /api/landing-events — a client can't be trusted to claim a conversion, so
 * this action is the only emitter (mirrors SUBSCRIPTION_BOUGHT via the Stripe
 * webhook).
 *
 * Contract (architect seams, plan #7):
 *   - Zod at the boundary: 16-digit landing token + email ≤320 chars.
 *   - PUBLIC_LIMIT rate limit by IP (server actions are CSRF-checked by Next).
 *   - Unknown / revoked tokens return `{ ok: true }` silently — never reveal
 *     which tokens exist (same posture as /api/landing-events).
 *   - Idempotent: upsert by (email lowercase, businessId). A re-subscribe
 *     clears `unsubscribedAt` and ROTATES `unsubToken`; we never reveal
 *     whether the email was already subscribed.
 *   - The subscriber lives fully OUTSIDE the cold engine: no cold caps, no
 *     sequences, unsubscribe is per-subscription (never ColdSuppression).
 *   - PII: the raw IP is never stored — only the salted hash (`ipHash`,
 *     same recipe as /api/landing-events).
 *
 * One honest deviation from "always {ok:true} on valid input": an
 * infrastructure failure (DB down) returns `{ ok: false, error:
 * "unavailable" }` — telling the visitor "Done" when nothing was saved would
 * fake a conversion. Duplicate signups still always succeed via the upsert,
 * so prior-subscription state is never leaked.
 */

import { createHash, randomBytes } from "node:crypto";

import { headers } from "next/headers";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { PUBLIC_LIMIT, rateLimit } from "@/lib/middleware/rate-limit";

import { buildLandingPath } from "./token";

/* ============================================================ schema */

const SubscribeInput = z.object({
  token: z.string().regex(/^[1-9][0-9]{15}$/),
  email: z.string().trim().min(3).max(320).email(),
  visitorId: z.string().max(64).optional(),
  sessionId: z.string().max(64).optional(),
});

/* ============================================================ result */

export type SubscribeWeeklyScoreResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "rate_limited" | "unavailable" };

/* =========================================================== helpers */

/** Salted IP hash — IDENTICAL recipe to /api/landing-events (`hashIp`) so
 * funnel queries can join FREE_SIGNUP rows against the beacon events.
 * Duplicated here because that route file belongs to the analytics surface
 * (ownership seam); keep the two in sync if the salt source ever changes. */
function hashIp(ip: string): string {
  const salt = process.env.AUTH_SECRET ?? "mapsly-landing";
  return createHash("sha256")
    .update(`${salt}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}

/** First-hop client IP from the proxy headers (rate-limit keying only). */
function ipFromHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = h.get("x-real-ip");
  if (xri) return xri.trim();
  return "ip:unknown";
}

/** Unguessable per-subscription unsubscribe token (STORED — revocation and
 * rotation are per-row, unlike the stateless HMAC /u email tokens). */
function mintUnsubToken(): string {
  return randomBytes(16).toString("base64url");
}

/* ============================================================ action */

export async function subscribeWeeklyScore(
  input: unknown,
): Promise<SubscribeWeeklyScoreResult> {
  const parsed = SubscribeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const h = await headers();
  const ip = ipFromHeaders(h);

  // Rate-limit by IP. Unlike the read-only analytics beacon this is a WRITE,
  // so a 429 is enforced (rateLimit itself fails soft when KV is unbound).
  try {
    const limited = await rateLimit(
      new Request("https://www.mapsly.ai/_action/weekly-score-subscribe"),
      PUBLIC_LIMIT,
      ip,
    );
    if (limited) return { ok: false, error: "rate_limited" };
  } catch {
    /* limiter unavailable — allow (fail-soft, matches landing-events) */
  }

  const email = parsed.data.email.toLowerCase();

  try {
    const landing = await prisma.landingPage.findUnique({
      where: { token: parsed.data.token },
      select: {
        id: true,
        businessId: true,
        slug: true,
        token: true,
        isActive: true,
        business: { select: { country: true } },
      },
    });
    // Silently accept unknown / revoked tokens — don't reveal which exist.
    if (!landing || !landing.isActive) return { ok: true };

    const ua = (h.get("user-agent") ?? "").slice(0, 400);

    await prisma.$transaction(async (tx) => {
      // CASL/CAN-SPAM defense file: the EXPRESS opt-in for this exact
      // email + business, captured in the same transaction as the row.
      const consent = await tx.consentRecord.create({
        data: {
          email,
          businessId: landing.businessId,
          basis: "EXPRESS",
          sourceUrl: `https://www.mapsly.ai${buildLandingPath(landing.slug, landing.token)}`,
          relevanceNote:
            "Opted in to the free weekly score email on their business landing page.",
          country: landing.business.country ?? "US",
        },
      });

      await tx.weeklyScoreSubscriber.upsert({
        where: {
          email_businessId: { email, businessId: landing.businessId },
        },
        create: {
          email,
          businessId: landing.businessId,
          landingPageId: landing.id,
          unsubToken: mintUnsubToken(),
          consentRecordId: consent.id,
          source: "landing",
        },
        // Re-subscribe: reuse the row, clear the opt-out, rotate the token
        // (old /wu links die with the old subscription), refresh consent ref.
        update: {
          unsubscribedAt: null,
          unsubToken: mintUnsubToken(),
          consentRecordId: consent.id,
          landingPageId: landing.id,
        },
      });

      // Server-emitted conversion event (NEVER from the client beacon).
      await tx.landingEvent.create({
        data: {
          landingPageId: landing.id,
          type: "FREE_SIGNUP",
          section: null,
          visitorId: parsed.data.visitorId ?? null,
          sessionId: parsed.data.sessionId ?? null,
          ipHash: hashIp(ip),
          userAgent: ua || null,
          isBot: false,
        },
      });
    });

    return { ok: true };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "landing.weekly_score_subscribe.failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: "unavailable" };
  }
}
