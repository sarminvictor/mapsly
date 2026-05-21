// POST /api/billing/checkout
//
// User-initiated Stripe checkout. Auth via NextAuth v5 session. Rate-limited
// 30 req/min/user via `USER_LIMIT` (per .claude/rules/scalability.md). Zod
// validates `plan` against the canonical plan literal set.
//
// Response shapes (per .claude/rules/validation-and-errors.md):
//   200 { url, sessionId, customerId }
//   400 { error: "invalid_input", details }
//   400 { error: "invalid_return_url" }
//   401 { error: "unauthorized" }
//   403 { error: "agency_required" }       — agency_* plan, user has no agency
//   404 { error: "user_not_found" }        — session.user.id stale
//   429 { error: "rate_limited", ... }     — emitted by rateLimit middleware
//   500 { error: "internal_error" }
//
// Cost discipline note: Stripe API calls here are intentional user-path
// calls (billing handshake). They do NOT need a CronRun — see
// `modules/billing/checkout.ts` header comment for the rationale.

import { z } from "zod";

import { auth } from "@/lib/auth";
import { rateLimit, USER_LIMIT } from "@/lib/middleware/rate-limit";
import {
  CheckoutError,
  createCheckoutSession,
} from "@/modules/billing/checkout";
import { PlanSchema } from "@/modules/billing/plans";

const BodySchema = z.object({
  plan: PlanSchema,
  returnUrl: z.string().url(),
});

export async function POST(req: Request): Promise<Response> {
  // ─── Auth ───────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // ─── Rate limit ─────────────────────────────────────────────────────────
  const limited = await rateLimit(req, USER_LIMIT, session.user.id);
  if (limited) return limited;

  // ─── Body validation ────────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(
      { error: "invalid_input", details: { body: "expected JSON" } },
      { status: 400 },
    );
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_input",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  // ─── Domain ─────────────────────────────────────────────────────────────
  try {
    const result = await createCheckoutSession({
      userId: session.user.id,
      plan: parsed.data.plan,
      returnUrl: parsed.data.returnUrl,
    });
    return Response.json(
      {
        url: result.sessionUrl,
        sessionId: result.sessionId,
        customerId: result.customerId,
      },
      { status: 200 },
    );
  } catch (err) {
    return handleCheckoutError(err, session.user.id);
  }
}

function handleCheckoutError(err: unknown, userId: string): Response {
  if (err instanceof CheckoutError) {
    // Map domain codes to HTTP — see route-level docstring for full table.
    const httpStatus =
      err.code === "user_not_found"
        ? 404
        : err.code === "agency_required" || err.code === "agency_not_found"
          ? 403
          : 400;
    // Honest logging per INC-37 — surface domain errors with context so they
    // don't get hidden by the generic 500 path below.
    console.error(
      JSON.stringify({
        level: "warn",
        event: "billing.checkout.domain_error",
        userId,
        code: err.code,
        message: err.message,
      }),
    );
    return Response.json({ error: err.code }, { status: httpStatus });
  }

  // Unknown failure — log full error server-side, return generic to client
  // per .claude/rules/validation-and-errors.md (never leak internals).
  console.error(
    JSON.stringify({
      level: "error",
      event: "billing.checkout.internal_error",
      userId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return Response.json({ error: "internal_error" }, { status: 500 });
}
