"use server";

/**
 * Billing · server actions for the unified "Billing & credits" page.
 *
 * Two flows, both invoked via `<form action={...}>` from the (server-rendered)
 * billing page — so no `'use client'` boundary and no function props cross the
 * server→client seam (cacheComponents-safe):
 *
 *   - `startPlanCheckout`   → subscription checkout for a paid display plan
 *                             (Starter / Growth / Scale).
 *   - `startTopUpCheckout`  → one-time payment checkout for a top-up pack.
 *
 * Pricing is the prototype model (Free $0 / Starter $19 / Growth $99 /
 * Scale $299). Those plans need NEW Stripe products + price IDs (the old env
 * vars hold the legacy $49/$99/$249/$499 prices). Rather than couple to the
 * legacy `plans.ts` registry, this module resolves price IDs from its OWN env
 * vars at call-time and DEGRADES GRACEFULLY when they're unset: instead of
 * crashing the page, the action redirects back with `?billing_error=unconfigured`
 * so the UI can show a "contact us" note. The button itself is also disabled
 * server-side when the price id is missing (see `isPlanCheckoutConfigured` /
 * `isTopUpConfigured`).
 *
 * Per `.claude/rules/security.md`: auth() at the top; role gate (OWNER/ADMIN
 * only) for any agency billing action; redirect() short-circuits the response.
 */

import { z } from "zod";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import stripeClient from "@/lib/stripe";
import {
  ACTION_ENQUEUE_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import {
  TOPUP_PACKS,
  type PlanKey,
  type TopUpPack,
} from "@/modules/cost/pricing";

// ─── Env-var resolution (call-time, per INC-07) ─────────────────────────────
//
// New price IDs for the prototype pricing. The human creates these Stripe
// products and sets the env vars out of band (see the build summary). Free has
// no price (it's the default, no-subscription tier).

const PAID_PLAN_ENV: Record<Exclude<PlanKey, "free">, string> = {
  starter: "STRIPE_PRICE_PLAN_STARTER", // $19
  solo: "STRIPE_PRICE_PLAN_SOLO", // $49 (added 2026-07-09)
  growth: "STRIPE_PRICE_PLAN_GROWTH", // $99
  scale: "STRIPE_PRICE_PLAN_SCALE", // $299
};

const TOPUP_ENV: Record<TopUpPack["key"], string> = {
  pack_1000: "STRIPE_PRICE_TOPUP_1000",
  pack_5000: "STRIPE_PRICE_TOPUP_5000",
};

function planPriceId(key: Exclude<PlanKey, "free">): string | null {
  const v = process.env[PAID_PLAN_ENV[key]];
  return v && v.length > 0 ? v : null;
}

function topUpPriceId(key: TopUpPack["key"]): string | null {
  const v = process.env[TOPUP_ENV[key]];
  return v && v.length > 0 ? v : null;
}

/** Whether a paid plan's checkout is wired (price id present). UI gate. */
export async function isPlanCheckoutConfigured(key: PlanKey): Promise<boolean> {
  if (key === "free") return false;
  return planPriceId(key) !== null;
}

/** Whether a top-up pack's checkout is wired (price id present). UI gate. */
export async function isTopUpConfigured(
  key: TopUpPack["key"],
): Promise<boolean> {
  return topUpPriceId(key) !== null;
}

// ─── Shared auth + agency resolution ────────────────────────────────────────

interface AgencyContext {
  userId: string;
  email: string;
  agencyId: string;
  agencyName: string;
  stripeCustomerId: string | null;
  canManage: boolean;
}

async function resolveAgencyContext(): Promise<
  AgencyContext | { error: "unauthorized" | "no_agency" }
> {
  const session = await auth();
  if (!session?.user?.id) return { error: "unauthorized" };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      agencyMembers: {
        take: 1,
        select: {
          role: true,
          agency: {
            select: { id: true, name: true, stripeCustomerId: true },
          },
        },
      },
    },
  });
  const membership = user?.agencyMembers[0];
  const agency = membership?.agency;
  if (!user || !membership || !agency) return { error: "no_agency" };

  return {
    userId: user.id,
    email: user.email,
    agencyId: agency.id,
    agencyName: agency.name,
    stripeCustomerId: agency.stripeCustomerId,
    canManage: membership.role === "OWNER" || membership.role === "ADMIN",
  };
}

/** Ensure the agency has a Stripe customer; create + persist if missing. */
async function ensureAgencyCustomer(ctx: AgencyContext): Promise<string> {
  if (ctx.stripeCustomerId) return ctx.stripeCustomerId;
  const customer = await stripeClient.customers.create({
    email: ctx.email,
    name: ctx.agencyName,
    metadata: { agencyId: ctx.agencyId, audience: "agency" },
  });
  await prisma.agency.update({
    where: { id: ctx.agencyId },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

function returnBase(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function billingUrl(locale: string, suffix = ""): string {
  const prefix = locale === "en" ? "" : `/${locale}`;
  return `${returnBase()}${prefix}/team/billing${suffix}`;
}

function isNextRedirect(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { digest?: unknown };
  return (
    typeof maybe.digest === "string" && maybe.digest.startsWith("NEXT_REDIRECT")
  );
}

// ─── Action · plan upgrade (subscription) ───────────────────────────────────

const PlanFormSchema = z.object({
  plan: z.enum(["starter", "solo", "growth", "scale"]),
  locale: z.string().min(1),
});

export async function startPlanCheckout(formData: FormData): Promise<void> {
  const parsed = PlanFormSchema.safeParse({
    plan: formData.get("plan"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) redirect("/team/billing?billing_error=invalid_input");
  const { plan, locale } = parsed.data;

  const priceId = planPriceId(plan);
  if (!priceId) {
    // Stripe product not created yet — degrade gracefully.
    redirect(billingUrl(locale, "?billing_error=unconfigured"));
  }

  const ctx = await resolveAgencyContext();
  if ("error" in ctx) {
    redirect(billingUrl(locale, `?billing_error=${ctx.error}`));
  }
  if (!ctx.canManage) {
    redirect(billingUrl(locale, "?billing_error=role_required"));
  }

  // WP8-2 · bound checkout-session starts per user (Stripe-session churn).
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, ctx.userId);
  if (rl.limited) {
    redirect(billingUrl(locale, "?billing_error=rate_limited"));
  }

  try {
    const customerId = await ensureAgencyCustomer(ctx);
    const metadata: Record<string, string> = {
      audience: "agency",
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      planKey: plan,
    };
    const session = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: ctx.userId,
      line_items: [{ price: priceId as string, quantity: 1 }],
      success_url: billingUrl(locale, "?checkout=success"),
      cancel_url: billingUrl(locale, "?canceled=1"),
      metadata,
      subscription_data: { metadata },
      allow_promotion_codes: true,
    });
    if (!session.url) {
      redirect(billingUrl(locale, "?billing_error=internal_error"));
    }
    redirect(session.url as string);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error(
      JSON.stringify({
        level: "error",
        event: "billing.plan_checkout.failed",
        plan,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    redirect(billingUrl(locale, "?billing_error=internal_error"));
  }
}

// ─── Action · native cancel / resume (cancel_at_period_end) ─────────────────
//
// F-6 · in-app cancellation without bouncing to the Stripe portal. Sets
// `cancel_at_period_end` on the live subscription (true = cancel at period end,
// false = resume a pending cancellation). The subscription stays active until
// the period end either way — the webhook (customer.subscription.updated)
// reconciles the DB; we also write `cancelAtPeriodEnd` optimistically so the
// page reflects the choice on the very next render. OWNER/ADMIN only.

const CancelFormSchema = z.object({
  // "true" → schedule cancellation; "false" → resume (undo a pending cancel).
  cancel: z.enum(["true", "false"]),
  locale: z.string().min(1),
});

export async function setPlanCancellation(formData: FormData): Promise<void> {
  const parsed = CancelFormSchema.safeParse({
    cancel: formData.get("cancel"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) redirect("/team/billing?billing_error=invalid_input");
  const { cancel, locale } = parsed.data;
  const cancelAtPeriodEnd = cancel === "true";

  const ctx = await resolveAgencyContext();
  if ("error" in ctx) {
    redirect(billingUrl(locale, `?billing_error=${ctx.error}`));
  }
  if (!ctx.canManage) {
    redirect(billingUrl(locale, "?billing_error=role_required"));
  }

  // WP8-2 · bound cancel/resume toggles per user (Stripe-write churn).
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, ctx.userId);
  if (rl.limited) {
    redirect(billingUrl(locale, "?billing_error=rate_limited"));
  }

  // Resolve the live subscription id (not carried on AgencyContext).
  const agency = await prisma.agency.findUnique({
    where: { id: ctx.agencyId },
    select: { stripeSubscriptionId: true },
  });
  const subscriptionId = agency?.stripeSubscriptionId ?? null;
  if (!subscriptionId) {
    // Nothing to cancel — likely already on the free tier.
    redirect(billingUrl(locale, "?billing_error=no_subscription"));
  }

  try {
    await stripeClient.subscriptions.update(subscriptionId as string, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });
    // Optimistic DB write so the page reflects the choice immediately; the
    // customer.subscription.updated webhook is the source of truth and will
    // re-confirm (idempotent — same boolean).
    await prisma.agency.update({
      where: { id: ctx.agencyId },
      data: { cancelAtPeriodEnd },
    });
    redirect(
      billingUrl(
        locale,
        cancelAtPeriodEnd ? "?plan_canceled=1" : "?plan_resumed=1",
      ),
    );
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error(
      JSON.stringify({
        level: "error",
        event: "billing.plan_cancellation.failed",
        cancelAtPeriodEnd,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    redirect(billingUrl(locale, "?billing_error=internal_error"));
  }
}

// ─── Action · top-up (one-time payment) ─────────────────────────────────────

const TopUpFormSchema = z.object({
  pack: z.enum(["pack_1000", "pack_5000"]),
  locale: z.string().min(1),
});

export async function startTopUpCheckout(formData: FormData): Promise<void> {
  const parsed = TopUpFormSchema.safeParse({
    pack: formData.get("pack"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) redirect("/team/billing?billing_error=invalid_input");
  const { pack, locale } = parsed.data;

  const priceId = topUpPriceId(pack);
  if (!priceId) {
    redirect(billingUrl(locale, "?billing_error=unconfigured"));
  }

  const packDef = TOPUP_PACKS.find((p) => p.key === pack);
  if (!packDef) redirect(billingUrl(locale, "?billing_error=invalid_input"));

  const ctx = await resolveAgencyContext();
  if ("error" in ctx) {
    redirect(billingUrl(locale, `?billing_error=${ctx.error}`));
  }
  if (!ctx.canManage) {
    redirect(billingUrl(locale, "?billing_error=role_required"));
  }

  // WP8-2 · bound checkout-session starts per user (Stripe-session churn).
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, ctx.userId);
  if (rl.limited) {
    redirect(billingUrl(locale, "?billing_error=rate_limited"));
  }

  try {
    const customerId = await ensureAgencyCustomer(ctx);
    // The webhook reads `kind=topup` + `credits` to add purchasedCredits. The
    // grant is keyed on the Stripe session id (dedupeKey) so a replay is safe.
    const metadata: Record<string, string> = {
      kind: "topup",
      audience: "agency",
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      packKey: pack,
      credits: String((packDef as TopUpPack).credits),
    };
    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: ctx.agencyId,
      line_items: [{ price: priceId as string, quantity: 1 }],
      success_url: billingUrl(locale, "?topup=success"),
      cancel_url: billingUrl(locale, "?canceled=1"),
      metadata,
      payment_intent_data: { metadata },
    });
    if (!session.url) {
      redirect(billingUrl(locale, "?billing_error=internal_error"));
    }
    redirect(session.url as string);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error(
      JSON.stringify({
        level: "error",
        event: "billing.topup_checkout.failed",
        pack,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    redirect(billingUrl(locale, "?billing_error=internal_error"));
  }
}
