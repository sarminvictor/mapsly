// Stripe webhook · subscription lifecycle handler.
//
// Receives Stripe.Event objects after signature verification + idempotency
// gating (see `app/api/webhooks/stripe/route.ts`) and applies the
// state-transition to our DB. Pure(-ish) function over (event, prismaClient)
// — easy to test by passing a fake Prisma.
//
// Handled event types (G.2 scope):
//
//   - checkout.session.completed         → wire subscriptionId + plan onto
//                                          the User or Agency that triggered
//                                          the checkout.
//   - customer.subscription.created      → first observation of an active
//                                          subscription (often duplicates the
//                                          checkout.session.completed payload
//                                          — both write the same final state).
//   - customer.subscription.updated      → renewal, upgrade, downgrade, plan
//                                          change, cancel-at-period-end toggle.
//   - customer.subscription.deleted      → subscription fully canceled (after
//                                          the current period if cancel_at_
//                                          period_end was set; immediate if
//                                          forced).
//   - invoice.paid                       → renewal succeeded — refresh
//                                          `currentPeriodEnd` from the
//                                          invoice's period_end.
//   - invoice.payment_failed             → dunning — mark status="past_due"
//                                          without revoking access yet
//                                          (Stripe's retry schedule + the
//                                          tier-enforcement layer decide
//                                          what to gate).
//
// Anything else logs `unhandled_event_type` at info level and returns
// without side effects — keeps the route 200-OK so Stripe stops retrying.
//
// ─── Invariants ──────────────────────────────────────────────────────────────
//
// 1. Audience routing comes from `subscription.metadata.audience`. Checkout
//    creator writes "smb" or "agency" + `userId` / `agencyId` so the webhook
//    never has to guess. If metadata is missing (manual Stripe dashboard
//    edit), we fall back to lookup by `customer` id — both User.stripeCustomerId
//    and Agency.stripeCustomerId are UNIQUE so at most one match.
//
// 2. Plan literal validated against `PlanSchema` (modules/billing/plans.ts).
//    Unknown plans log a warning + abort — we'd rather a webhook be replayed
//    once Stripe state stabilises than write garbage into our DB.
//
// 3. Writes are scoped (User.update where stripeSubscriptionId=... OR
//    User.update where id=...). No cross-row blast radius from a bad event.
//
// 4. Tier sync: when audience='agency' we also update `Agency.plan` to the
//    AgencyPlan enum value derived from the plan literal. This is what
//    feature-gates the rest of the app — `stripePlan` is informational,
//    `Agency.plan` is the operational tier.

import type Stripe from "stripe";

import { PlanSchema, type Plan } from "./plans";
// AgencyPlan literal — must stay in sync with the AgencyPlan enum in
// prisma/schema.prisma. Inlined here (vs imported from a generated prisma
// client) so this module is testable without `prisma generate` having run.
type AgencyPlan = "SOLO" | "GROWTH" | "AGENCY_PRO" | "BOUTIQUE";

// ─── Public verdict shape ────────────────────────────────────────────────────

export type WebhookOutcome =
  | {
      kind: "handled";
      event: string;
      targetType: "user" | "agency";
      targetId: string;
    }
  | { kind: "ignored"; event: string; reason: string }
  | {
      kind: "skipped";
      event: string;
      reason: string;
      /**
       * True when the skip is because the target User/Agency doesn't exist YET
       * (out-of-order delivery: a subscription/invoice event arrived before the
       * checkout.session.completed that provisions the user). The route turns
       * this into a 500 so Stripe RETRIES the event — otherwise the carried
       * state (status, priceId, period end) would be silently lost.
       */
      retryable?: boolean;
    };

// ─── Prisma seam · structural type so tests can pass a fake ──────────────────
//
// We intentionally don't import the real PrismaClient type here — the
// webhook handler should be testable without the generated prisma client
// (which doesn't exist until `prisma generate` has run). The structural
// type below covers every field this module actually reads or writes.

export interface PrismaSeam {
  user: {
    findFirst: (args: {
      where: {
        stripeCustomerId?: string | null;
        stripeSubscriptionId?: string | null;
      };
      select: { id: true; stripeSubscriptionId: true };
    }) => Promise<{ id: string; stripeSubscriptionId: string | null } | null>;
    update: (args: {
      where: { id: string };
      data: UserSubscriptionUpdate;
    }) => Promise<unknown>;
  };
  agency: {
    findFirst: (args: {
      where: {
        stripeCustomerId?: string | null;
        stripeSubscriptionId?: string | null;
      };
      select: { id: true; stripeSubscriptionId: true };
    }) => Promise<{ id: string; stripeSubscriptionId: string | null } | null>;
    update: (args: {
      where: { id: string };
      data: AgencySubscriptionUpdate;
    }) => Promise<unknown>;
  };
}

interface UserSubscriptionUpdate {
  stripeSubscriptionId?: string | null;
  stripePlan?: string | null;
  stripeStatus?: string | null;
  stripePriceId?: string | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

interface AgencySubscriptionUpdate extends UserSubscriptionUpdate {
  plan?: AgencyPlan;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleStripeEvent(
  event: Stripe.Event,
  prisma: PrismaSeam,
): Promise<WebhookOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event, prisma);

    case "customer.subscription.created":
    case "customer.subscription.updated":
      return handleSubscriptionUpsert(event, prisma);

    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event, prisma);

    case "invoice.paid":
      return handleInvoicePaid(event, prisma);

    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event, prisma);

    default:
      // Stripe sends many event types we don't care about (charges, refunds,
      // tax events, etc.). Returning 200 stops Stripe from retrying — the
      // route layer logs at info level for visibility.
      return {
        kind: "ignored",
        event: event.type,
        reason: "unhandled_event_type",
      };
  }
}

// ─── Event-specific handlers ─────────────────────────────────────────────────

async function handleCheckoutCompleted(
  event: Stripe.Event,
  prisma: PrismaSeam,
): Promise<WebhookOutcome> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "subscription") {
    return {
      kind: "ignored",
      event: event.type,
      reason: `mode=${session.mode} (not subscription)`,
    };
  }
  const subscriptionId = asString(session.subscription);
  if (!subscriptionId) {
    return {
      kind: "skipped",
      event: event.type,
      reason: "missing subscription id on session",
    };
  }
  const metadata = (session.metadata ?? {}) as Record<
    string,
    string | undefined
  >;
  const audience = metadata.audience as "smb" | "agency" | undefined;
  const plan = parsePlan(metadata.plan);
  if (!plan) {
    return {
      kind: "skipped",
      event: event.type,
      reason: `unknown plan literal ${metadata.plan}`,
    };
  }
  const customerId = asString(session.customer);
  if (!customerId) {
    return {
      kind: "skipped",
      event: event.type,
      reason: "missing customer id on session",
    };
  }

  return upsertSubscriptionRow({
    prisma,
    event: event.type,
    audience: audience ?? inferAudience(plan),
    customerId,
    subscriptionId,
    metadata,
    plan,
    status: null, // status updates land via subscription.updated; checkout completion alone doesn't carry status
    priceId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
}

async function handleSubscriptionUpsert(
  event: Stripe.Event,
  prisma: PrismaSeam,
): Promise<WebhookOutcome> {
  const sub = event.data.object as Stripe.Subscription;
  const metadata = (sub.metadata ?? {}) as Record<string, string | undefined>;
  const audienceMaybe = metadata.audience as "smb" | "agency" | undefined;
  const planLiteral = metadata.plan;
  const plan = parsePlan(planLiteral);
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const periodEnd = subscriptionPeriodEnd(sub);

  // Plan is optional here — for an `updated` event firing on an existing row
  // we may not need to change the plan literal at all (e.g. status flip from
  // `trialing` → `active`). Fall back to whatever's already on the DB row by
  // omitting the field from the update payload.
  return upsertSubscriptionRow({
    prisma,
    event: event.type,
    audience:
      audienceMaybe ?? (plan ? inferAudience(plan) : undefined) ?? "smb",
    customerId: asString(sub.customer) ?? "",
    subscriptionId: sub.id,
    metadata,
    plan,
    status: sub.status,
    priceId,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  });
}

async function handleSubscriptionDeleted(
  event: Stripe.Event,
  prisma: PrismaSeam,
): Promise<WebhookOutcome> {
  const sub = event.data.object as Stripe.Subscription;
  const metadata = (sub.metadata ?? {}) as Record<string, string | undefined>;
  const audience = (metadata.audience as "smb" | "agency" | undefined) ?? "smb";
  const customerId = asString(sub.customer) ?? "";
  const target = await findTarget(prisma, audience, {
    subscriptionId: sub.id,
    customerId,
  });
  if (!target) {
    return {
      kind: "skipped",
      event: event.type,
      reason: `no ${audience} matches subscription ${sub.id}`,
      retryable: true,
    };
  }

  // Clear subscription state but leave `stripeCustomerId` set — the customer
  // record persists in Stripe and re-subscribing later should reuse it.
  if (audience === "agency") {
    await prisma.agency.update({
      where: { id: target.id },
      data: {
        stripeSubscriptionId: null,
        stripeStatus: sub.status,
        stripePriceId: null,
        stripePlan: null,
        currentPeriodEnd: subscriptionPeriodEnd(sub),
        cancelAtPeriodEnd: false,
        plan: "SOLO", // downgrade to default free-tier sentinel
      },
    });
  } else {
    await prisma.user.update({
      where: { id: target.id },
      data: {
        stripeSubscriptionId: null,
        stripeStatus: sub.status,
        stripePriceId: null,
        stripePlan: null,
        currentPeriodEnd: subscriptionPeriodEnd(sub),
        cancelAtPeriodEnd: false,
      },
    });
  }
  return {
    kind: "handled",
    event: event.type,
    targetType: audience === "agency" ? "agency" : "user",
    targetId: target.id,
  };
}

async function handleInvoicePaid(
  event: Stripe.Event,
  prisma: PrismaSeam,
): Promise<WebhookOutcome> {
  const invoice = event.data.object as Stripe.Invoice;
  // Stripe Invoice in API 2024-12-18 carries `subscription` (id or expanded object)
  // and `lines.data[].period.end` for the renewal anchor.
  const subscriptionId = asString(
    (invoice as unknown as { subscription?: string | Stripe.Subscription })
      .subscription,
  );
  if (!subscriptionId) {
    return {
      kind: "ignored",
      event: event.type,
      reason: "invoice has no subscription (one-off)",
    };
  }
  const customerId = asString(invoice.customer) ?? "";
  // Prefer line-item period end (the renewal anchor) over invoice-level dates.
  const lineEnd = invoice.lines?.data?.[0]?.period?.end ?? null;
  const periodEnd = lineEnd ? new Date(lineEnd * 1000) : null;
  const audience = inferAudienceFromInvoice(invoice);

  const target = await findTarget(prisma, audience, {
    subscriptionId,
    customerId,
  });
  if (!target) {
    return {
      kind: "skipped",
      event: event.type,
      reason: `no ${audience} matches subscription ${subscriptionId}`,
      retryable: true,
    };
  }
  const update = {
    stripeStatus: "active",
    currentPeriodEnd: periodEnd,
  } as const;
  if (audience === "agency") {
    await prisma.agency.update({ where: { id: target.id }, data: update });
  } else {
    await prisma.user.update({ where: { id: target.id }, data: update });
  }
  return {
    kind: "handled",
    event: event.type,
    targetType: audience === "agency" ? "agency" : "user",
    targetId: target.id,
  };
}

async function handleInvoicePaymentFailed(
  event: Stripe.Event,
  prisma: PrismaSeam,
): Promise<WebhookOutcome> {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = asString(
    (invoice as unknown as { subscription?: string | Stripe.Subscription })
      .subscription,
  );
  if (!subscriptionId) {
    return {
      kind: "ignored",
      event: event.type,
      reason: "invoice has no subscription",
    };
  }
  const customerId = asString(invoice.customer) ?? "";
  const audience = inferAudienceFromInvoice(invoice);
  const target = await findTarget(prisma, audience, {
    subscriptionId,
    customerId,
  });
  if (!target) {
    return {
      kind: "skipped",
      event: event.type,
      reason: `no ${audience} matches subscription ${subscriptionId}`,
      retryable: true,
    };
  }
  const update = { stripeStatus: "past_due" } as const;
  if (audience === "agency") {
    await prisma.agency.update({ where: { id: target.id }, data: update });
  } else {
    await prisma.user.update({ where: { id: target.id }, data: update });
  }
  return {
    kind: "handled",
    event: event.type,
    targetType: audience === "agency" ? "agency" : "user",
    targetId: target.id,
  };
}

// ─── Shared upsert primitive ─────────────────────────────────────────────────

interface UpsertParams {
  prisma: PrismaSeam;
  event: string;
  audience: "smb" | "agency";
  customerId: string;
  subscriptionId: string;
  metadata: Record<string, string | undefined>;
  plan: Plan | null;
  status: string | null;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

async function upsertSubscriptionRow(p: UpsertParams): Promise<WebhookOutcome> {
  const target = await findTarget(p.prisma, p.audience, {
    subscriptionId: p.subscriptionId,
    customerId: p.customerId,
    metadata: p.metadata,
  });
  if (!target) {
    return {
      kind: "skipped",
      event: p.event,
      reason: `no ${p.audience} matches customer ${p.customerId} / subscription ${p.subscriptionId}`,
      retryable: true,
    };
  }

  const baseUpdate: UserSubscriptionUpdate = {
    stripeSubscriptionId: p.subscriptionId,
    cancelAtPeriodEnd: p.cancelAtPeriodEnd,
  };
  if (p.plan) baseUpdate.stripePlan = p.plan;
  if (p.status) baseUpdate.stripeStatus = p.status;
  if (p.priceId) baseUpdate.stripePriceId = p.priceId;
  if (p.currentPeriodEnd) baseUpdate.currentPeriodEnd = p.currentPeriodEnd;

  if (p.audience === "agency") {
    const update: AgencySubscriptionUpdate = { ...baseUpdate };
    if (p.plan) {
      const tier = planToAgencyTier(p.plan);
      if (tier) update.plan = tier;
    }
    await p.prisma.agency.update({ where: { id: target.id }, data: update });
  } else {
    await p.prisma.user.update({ where: { id: target.id }, data: baseUpdate });
  }

  return {
    kind: "handled",
    event: p.event,
    targetType: p.audience === "agency" ? "agency" : "user",
    targetId: target.id,
  };
}

// ─── Lookup helpers ──────────────────────────────────────────────────────────

interface FindTargetInput {
  subscriptionId?: string;
  customerId?: string;
  metadata?: Record<string, string | undefined>;
}

async function findTarget(
  prisma: PrismaSeam,
  audience: "smb" | "agency",
  input: FindTargetInput,
): Promise<{ id: string; stripeSubscriptionId: string | null } | null> {
  // Subscription id wins when present (most specific) — already UNIQUE on
  // both User and Agency. This is the canonical post-checkout lookup path.
  //
  // We do NOT look up by metadata.userId / metadata.agencyId, even though
  // it might seem like the most trusted source. Reasoning:
  //   - checkout.ts always writes `stripeCustomerId` to the User/Agency row
  //     BEFORE creating the Stripe Checkout Session, so the customer-id
  //     fallback below always succeeds for legitimately-originated subs.
  //   - Trusting metadata-supplied ids would bypass that safety net and
  //     write to whatever row id Stripe metadata says — including any
  //     id an attacker could craft if they ever found a way to inject
  //     metadata into a session creation. Better to require the customer
  //     correspondence than to accept the claim.
  //
  // The `input.metadata` field is still part of the input contract so
  // audit logs and telemetry can record what Stripe sent, even though it
  // doesn't drive the lookup.
  if (input.subscriptionId) {
    const row =
      audience === "agency"
        ? await prisma.agency.findFirst({
            where: { stripeSubscriptionId: input.subscriptionId },
            select: { id: true, stripeSubscriptionId: true },
          })
        : await prisma.user.findFirst({
            where: { stripeSubscriptionId: input.subscriptionId },
            select: { id: true, stripeSubscriptionId: true },
          });
    if (row) return row;
  }

  // Customer id fallback — also UNIQUE.
  if (input.customerId) {
    const row =
      audience === "agency"
        ? await prisma.agency.findFirst({
            where: { stripeCustomerId: input.customerId },
            select: { id: true, stripeSubscriptionId: true },
          })
        : await prisma.user.findFirst({
            where: { stripeCustomerId: input.customerId },
            select: { id: true, stripeSubscriptionId: true },
          });
    if (row) return row;
  }

  return null;
}

// ─── Small utilities ─────────────────────────────────────────────────────────

function parsePlan(value: string | undefined): Plan | null {
  if (!value) return null;
  const parsed = PlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function inferAudience(plan: Plan): "smb" | "agency" {
  return plan === "smb_paid" ? "smb" : "agency";
}

function inferAudienceFromInvoice(invoice: Stripe.Invoice): "smb" | "agency" {
  const subscriptionMeta = (
    invoice as unknown as {
      subscription_details?: { metadata?: Record<string, string> };
    }
  ).subscription_details?.metadata;
  const audience = subscriptionMeta?.audience;
  if (audience === "agency" || audience === "smb") return audience;
  // Best-effort fallback: check line item description for the plan name.
  const desc = invoice.lines?.data?.[0]?.description ?? "";
  if (/agency/i.test(desc)) return "agency";
  return "smb";
}

function planToAgencyTier(plan: Plan): AgencyPlan | null {
  switch (plan) {
    case "agency_solo":
      return "SOLO";
    case "agency_growth":
      return "GROWTH";
    case "agency_pro":
      return "AGENCY_PRO";
    case "agency_boutique":
      return "BOUTIQUE";
    case "smb_paid":
    default:
      return null;
  }
}

function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  // `current_period_end` is a unix timestamp (seconds). Stripe API 2024-12-18
  // exposes it at the top level for active subs and inside `items.data[]` —
  // we use the top-level field. Cast through unknown because Stripe's
  // generated types occasionally lag the live API.
  // Top-level `current_period_end` (≤ 2025-02 API) OR item-level (Basil
  // 2025-03+, where Stripe moved it to items.data[].current_period_end).
  // Read both so a dashboard API-version bump can't silently null the renewal
  // anchor. Cast through unknown — Stripe's generated types lag the live API.
  const top = (sub as unknown as { current_period_end?: number })
    .current_period_end;
  const item = (
    sub.items?.data?.[0] as unknown as
      | { current_period_end?: number }
      | undefined
  )?.current_period_end;
  const ts = typeof top === "number" ? top : item;
  if (typeof ts !== "number") return null;
  return new Date(ts * 1000);
}

function asString(
  value: string | { id: string } | null | undefined,
): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}
