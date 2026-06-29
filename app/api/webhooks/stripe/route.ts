// POST /api/webhooks/stripe
//
// Receives Stripe webhook deliveries for subscription lifecycle events.
// Steps, in strict order:
//
//   1. Read raw body (constructEvent requires the verbatim bytes — buffering
//      via req.json() would corrupt the signature).
//   2. Verify Stripe-Signature with STRIPE_WEBHOOK_SECRET → 400 on fail.
//   3. INSERT a row into StripeWebhookEvent keyed by event.id. The UNIQUE
//      constraint provides idempotency — a duplicate delivery hits the
//      unique violation and we return 200 immediately without re-processing.
//   4. Hand the parsed Stripe.Event to `handleStripeEvent` (modules/billing/webhook).
//   5. Stamp processedAt on success; record the error message on failure.
//   6. Return 200 OK so Stripe stops retrying.
//
// Rate-limited via WEBHOOK_LIMIT (200/min, keyed by stripe-signature). In
// the wild Stripe sends < 10/min even for our highest-volume signups, so
// the limit is mostly to keep a malicious POSTer from filling the
// idempotency table with junk.
//
// Per .claude/rules/security.md, the route runs in Node.js runtime (the
// default in Next 16 with Turbopack) — Stripe's SDK uses Node's crypto.
//
// Response shapes:
//   200 { ok: true, outcome: "handled" | "ignored" | "duplicate" | "skipped" }
//   400 { error: "bad_signature" }                — signature verification failed
//   400 { error: "missing_signature" }            — no Stripe-Signature header
//   400 { error: "invalid_payload" }              — body wasn't valid JSON
//   429 { error: "rate_limited", ... }            — WEBHOOK_LIMIT triggered
//   500 { error: "internal_error" }               — handler threw (Stripe will retry)
//
// IMPORTANT: a 500 response triggers Stripe's retry schedule (up to 3 days).
// We return 500 ONLY for unexpected errors; known-but-unhandled event types
// return 200 with `outcome: "ignored"` so Stripe stops retrying.

import type Stripe from "stripe";

import prisma from "@/lib/prisma";
import stripeClient from "@/lib/stripe";
import { rateLimit, WEBHOOK_LIMIT } from "@/lib/middleware/rate-limit";
import { provisionSmbFromCheckout } from "@/modules/billing/provision";
import {
  handleStripeEvent,
  type WebhookOutcome,
} from "@/modules/billing/webhook";
import { recordLandingConversion } from "@/modules/smb-landing/conversion";
import { grantPlanCredits } from "@/modules/cost/server";
import { PLAN_CREDITS, type AgencyPlanTier } from "@/modules/cost/pricing";

export async function POST(req: Request): Promise<Response> {
  // ─── Rate limit (key by signature so each Stripe key gets its own bucket) ──
  const signatureHeader = req.headers.get("stripe-signature");
  const rateLimitKey = signatureHeader?.slice(0, 64) ?? "no-sig";
  const limited = await rateLimit(req, WEBHOOK_LIMIT, rateLimitKey);
  if (limited) return limited;

  // ─── Read raw body (verbatim — required for signature verification) ────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  // ─── Signature verification ────────────────────────────────────────────────
  if (!signatureHeader) {
    return Response.json({ error: "missing_signature" }, { status: 400 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Misconfigured deploy — log loudly + 500 so Stripe retries while we fix.
    console.error(
      JSON.stringify({
        level: "error",
        event: "billing.webhook.missing_secret",
        message: "STRIPE_WEBHOOK_SECRET not set — refusing to process",
      }),
    );
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripeClient.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      secret,
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "billing.webhook.bad_signature",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return Response.json({ error: "bad_signature" }, { status: 400 });
  }

  // ─── Idempotency — INSERT first, hits unique violation on replay ───────────
  let webhookRowId: string;
  try {
    const row = await prisma.stripeWebhookEvent.create({
      data: {
        eventId: event.id,
        type: event.type,
        apiVersion: event.api_version ?? null,
        livemode: event.livemode,
        payload: event.data.object as object,
      },
      select: { id: true },
    });
    webhookRowId = row.id;
  } catch (err) {
    // Postgres unique-violation surfaces as Prisma P2002. If we see it here
    // the event was already processed (or is being processed concurrently).
    // Return 200 to stop Stripe from retrying. We don't crack open the
    // generated error type — string-match on the code keeps this file
    // testable without the generated client.
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      console.log(
        JSON.stringify({
          level: "info",
          event: "billing.webhook.duplicate",
          stripeEventId: event.id,
          type: event.type,
        }),
      );
      return Response.json({ ok: true, outcome: "duplicate" }, { status: 200 });
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "billing.webhook.insert_failed",
        stripeEventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  // ─── Dispatch to the pure handler ──────────────────────────────────────────
  try {
    // Direct-from-landing flow: the User doesn't exist until they pay. On the
    // completed checkout, find-or-create the User from the Stripe-confirmed
    // email + claim the prospect Business — idempotent, mirrors the
    // /checkout/return success-redirect login. Runs BEFORE handleStripeEvent so
    // the subscription upsert finds the now-existing user by customer id.
    await provisionSmbOnCheckoutCompleted(event);
    const outcome = await handleStripeEvent(event, prisma);

    // Out-of-order delivery: a subscription/invoice event arrived before the
    // checkout.session.completed that provisions the user. Drop the idempotency
    // row so the retry re-processes, and 500 so Stripe retries this event after
    // provisioning has happened — otherwise the carried state is lost forever.
    if (outcome.kind === "skipped" && outcome.retryable) {
      await prisma.stripeWebhookEvent
        .delete({ where: { id: webhookRowId } })
        .catch(() => {});
      console.log(
        JSON.stringify({
          level: "info",
          event: "billing.webhook.retry_pending",
          stripeEventId: event.id,
          type: event.type,
          reason: outcome.reason,
        }),
      );
      return Response.json({ error: "retry_pending" }, { status: 500 });
    }

    await prisma.stripeWebhookEvent.update({
      where: { id: webhookRowId },
      data: { processedAt: new Date(), error: null },
    });
    // Grant the agency's plan credits to its wallet (best-effort, idempotent
    // per billing period). Without this the cost engine's wallets stay at 0 and
    // every enrichment run would fail insufficient_credits.
    await grantAgencyCreditsFromEvent(event, outcome).catch((err) => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "billing.webhook.credit_grant_failed",
          stripeEventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
    // Landing funnel attribution (best-effort, internally guarded) — records
    // SUBSCRIPTION_BOUGHT when this conversion came from a /l/[token] proposal.
    await recordLandingConversion(event);
    console.log(
      JSON.stringify({
        level: "info",
        event: "billing.webhook.processed",
        stripeEventId: event.id,
        type: event.type,
        outcome: outcome.kind,
        ...(outcome.kind === "handled"
          ? { targetType: outcome.targetType, targetId: outcome.targetId }
          : { reason: outcome.reason }),
      }),
    );
    return Response.json({ ok: true, outcome: outcome.kind }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.stripeWebhookEvent
      .update({
        where: { id: webhookRowId },
        data: { error: message },
      })
      .catch(() => {
        // Don't mask the original failure — best-effort logging.
      });
    console.error(
      JSON.stringify({
        level: "error",
        event: "billing.webhook.handler_failed",
        stripeEventId: event.id,
        type: event.type,
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    // 500 → Stripe retries with backoff. Better to be retried than to
    // silently drop a billing event.
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * Find-or-create the SMB User + claim the prospect Business from a completed
 * direct-from-landing checkout. Internally guarded: a provisioning hiccup is
 * logged but never fails the webhook — the /checkout/return redirect provisions
 * the same user, so the subscription upsert still finds them (or a Stripe retry
 * does). Source of truth for the email is `customer_details.email`.
 */
async function provisionSmbOnCheckoutCompleted(
  event: Stripe.Event,
): Promise<void> {
  if (event.type !== "checkout.session.completed") return;
  try {
    const session = event.data.object as Stripe.Checkout.Session;
    const md = (session.metadata ?? {}) as Record<string, string | undefined>;
    if (md.audience !== "smb" || session.mode !== "subscription") return;
    const email =
      session.customer_details?.email ?? session.customer_email ?? null;
    const customer = session.customer;
    const customerId =
      typeof customer === "string" ? customer : (customer?.id ?? null);
    if (!email || !customerId) return;
    await provisionSmbFromCheckout({
      email,
      customerId,
      landingToken: md.landingToken,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "billing.webhook.provision_failed",
        stripeEventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Grant an agency's plan credits to its wallet after a subscription event that
 * established or renewed the plan. Idempotent per billing period (grantPlanCredits
 * dedupes on the period key), so checkout + subscription.created + invoice.paid
 * all converging on the same period grant exactly once. Runs AFTER handleStripeEvent
 * has written Agency.plan + currentPeriodEnd, so it reads the now-current tier.
 */
async function grantAgencyCreditsFromEvent(
  event: Stripe.Event,
  outcome: WebhookOutcome,
): Promise<void> {
  const GRANT_EVENTS = new Set<string>([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "invoice.paid",
  ]);
  if (!GRANT_EVENTS.has(event.type)) return;
  if (outcome.kind !== "handled" || outcome.targetType !== "agency") return;

  const agency = await prisma.agency.findUnique({
    where: { id: outcome.targetId },
    select: { plan: true, currentPeriodEnd: true },
  });
  const plan = agency?.plan;
  if (!plan || !(plan in PLAN_CREDITS)) return;

  const periodEnd = agency.currentPeriodEnd ?? null;
  // Dedupe per billing period: a renewal (new period end) grants fresh credits,
  // but replays of the same period don't double-grant. Fall back to the event id.
  const dedupeKey = periodEnd ? periodEnd.toISOString() : event.id;
  await grantPlanCredits(
    outcome.targetId,
    plan as AgencyPlanTier,
    periodEnd,
    dedupeKey,
  );
}
