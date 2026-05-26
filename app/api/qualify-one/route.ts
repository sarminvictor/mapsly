/**
 * /api/qualify-one · receives per-business callbacks from Boxly Worker.
 *
 * Flow:
 *   Admin clicks "Qualify" in /admin/discovery
 *     → server action enqueues N jobs to Boxly Worker
 *     → worker POSTs HERE once per business (with concurrency + retry)
 *     → this endpoint runs qualifyBusiness() within Vercel's 300s budget
 *     → returns 200 / 4xx-reject / 5xx-retryable
 *
 * Auth: shared `BOXLY_WORKER_AUTH_TOKEN` Bearer — only the worker
 * (and admin smoke scripts) can call this. Constant-time compare in
 * verifyBoxlyWorkerAuth.
 *
 * Idempotency: qualifyBusiness() is already idempotent (overwrites
 * status, emails, candidates; services are dedup-protected). Worker
 * retries on 5xx/timeout never produce duplicate state.
 */

import { z } from "zod";

import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import {
  qualifyBusiness,
  recomputeCellAggregates,
} from "@/modules/business-qualification";

// Per-business qualify can take ~30-60s (email scrape + RDAP + service
// detection + JS bundle). Vercel default is 300s — generous headroom.
export const maxDuration = 300;

const RequestSchema = z.object({
  businessId: z.string().min(1).max(128),
  // Optional · when provided, we recompute the cell's aggregate tallies
  // after qualifying so /admin/discovery shows live progress as worker
  // callbacks land. Older clients without this field still work (we
  // just skip the recompute step).
  trackedLocationId: z.string().min(1).max(128).optional(),
});

export async function POST(request: Request): Promise<Response> {
  // 1. Verify Bearer auth · the worker sends the AUTH_TOKEN
  const authHeader = request.headers.get("authorization");
  if (!verifyBoxlyWorkerAuth(authHeader)) {
    // Diagnostic logging · safe to ship · logs length + 4-char fingerprint
    // (NOT the full token) so config mismatches are obvious in Vercel
    // Logs without leaking the secret.
    const incoming = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const expected = process.env.BOXLY_WORKER_AUTH_TOKEN ?? "";
    console.warn(
      `[/api/qualify-one] 401 · incoming-token len=${incoming.length} ` +
        `prefix=${incoming.slice(0, 4)} suffix=${incoming.slice(-4)} · ` +
        `expected len=${expected.length} ` +
        `prefix=${expected.slice(0, 4)} suffix=${expected.slice(-4)} · ` +
        `env-set=${expected.length > 0}`,
    );
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Validate body · returning 400 tells the worker NOT to retry
  let parsed: z.infer<typeof RequestSchema>;
  try {
    const json = (await request.json()) as unknown;
    const result = RequestSchema.safeParse(json);
    if (!result.success) {
      return Response.json(
        {
          error: "invalid_input",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  // 3. Run qualification · this is the long-running work the worker
  //    deferred for us. If it throws we return 500 so the worker retries.
  //
  // Wrap in withCronRun so the AI tier-3 fallback (services/ai/email-finder.ts)
  // can satisfy assertCronContext + cost-counter increment. Without this,
  // every AI call throws "External API calls must run inside withCronRun"
  // and qualify silently falls through to no_email — see INC: AI never
  // billed despite ai_attempted flag set on every no_email row.
  try {
    const outcome = await withCronRun("admin:qualify-one", async () =>
      qualifyBusiness(parsed.businessId),
    );

    // 3a. Live-aggregate update · after every callback, recompute the
    //     cell's qualified/disqualified/unreachable tallies so the
    //     /admin/discovery page reflects progress in real time. Failures
    //     here MUST NOT mask the successful qualify — log + continue.
    if (parsed.trackedLocationId) {
      try {
        await recomputeCellAggregates(parsed.trackedLocationId);
      } catch (aggErr) {
        console.warn(
          "[/api/qualify-one] aggregate recompute failed:",
          aggErr instanceof Error ? aggErr.message : aggErr,
        );
      }
    }

    return Response.json(
      {
        ok: true,
        businessId: outcome.businessId,
        status: outcome.status,
        flags: outcome.flags,
        emailDiscovered: outcome.emailDiscovered,
        servicesCreated: outcome.servicesCreated,
        // R.2 · review-pull trigger result — visible in worker logs so
        // we can audit "did the pull fire?" across a cell's qualifies.
        reviewPull: outcome.reviewPull,
      },
      { status: 200 },
    );
  } catch (err) {
    // Unknown business id → 404, retry won't help · the worker treats
    // 4xx as non-retryable (per its CallbackWebhookProcessor rules).
    if (err instanceof Error && /not found/i.test(err.message)) {
      return Response.json(
        { error: "business_not_found", businessId: parsed.businessId },
        { status: 404 },
      );
    }
    // Anything else is potentially transient (DB hiccup, scrape timeout
    // bubbling up, etc.). 500 = "retry me later" to the worker.
    console.error(
      "[/api/qualify-one] qualifyBusiness threw:",
      err instanceof Error ? err.stack : err,
    );
    return Response.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
