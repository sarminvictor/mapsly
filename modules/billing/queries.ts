// Billing · server-only data fetchers for the settings/billing pages.
//
// These run inside the Suspense'd async body of `(smb)/settings/billing`
// and `(agency)/team/billing` per `.claude/rules/cache-components.md`
// Pattern 2. Stripe calls are NOT `'use cache'`d — billing state is
// security-sensitive enough that a 5-minute cache is more risk than
// value. DB reads of `User.stripeCustomerId` could be cached but the
// tag would have to flip on every webhook, and the lookup is one keyed
// `findUnique` — not worth the complexity.
//
// All exports here follow the same pattern: take an authenticated
// userId, resolve which Stripe customer to read (User vs Agency), and
// return either real data or a typed EMPTY value (NEXT_PHASE guard,
// per cache-components Pattern 1) so Vercel's build worker can render
// the shell without opening a Stripe socket or a Neon WebSocket.

import type Stripe from "stripe";

import prisma from "@/lib/prisma";
import stripeClient from "@/lib/stripe";

import type { Plan } from "./plans";

// ─── Public types ────────────────────────────────────────────────────────────

export type BillingAudience = "smb" | "agency";

export interface CurrentPlanData {
  /** Which Stripe customer record this came from. */
  audience: BillingAudience;
  /** Whether the viewing user is OWNER/ADMIN (can manage) or STAFF (read-only). */
  canManage: boolean;
  /** Stripe Customer id, null if user has never subscribed. */
  stripeCustomerId: string | null;
  /** True when the user has no Stripe customer yet (pre-subscribe state). */
  hasCustomer: boolean;
  /** Active subscription id; null when never subscribed or fully canceled. */
  subscriptionId: string | null;
  /** Plan literal from our registry (e.g. "smb_paid", "agency_growth"). */
  plan: Plan | null;
  /** Verbatim Stripe subscription status: active / past_due / canceled / etc. */
  status: string | null;
  /** Next renewal anchor (or expiry date when cancelAtPeriodEnd is true). */
  currentPeriodEnd: Date | null;
  /** Whether the subscription is set to cancel at the end of the period. */
  cancelAtPeriodEnd: boolean;
  /** Monthly amount in cents (USD). */
  amountCents: number | null;
  /** ISO currency code, defaulting to "usd". */
  currency: string;
  /** Optional human display name carried from Stripe for transparency. */
  displayName: string | null;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  /** ISO date (createdAt on Stripe) — caller formats via Intl. */
  createdAt: Date;
  status: string | null;
  amountPaidCents: number;
  currency: string;
  /** Stripe-hosted invoice page (preferred over direct PDF for UX). */
  hostedInvoiceUrl: string | null;
  /** Direct PDF download. */
  invoicePdfUrl: string | null;
}

export interface InvoicesData {
  invoices: InvoiceRow[];
  /** True when more invoices exist beyond the returned page. */
  hasMore: boolean;
}

// ─── EMPTY sentinels (NEXT_PHASE / catch fallback per Pattern 1) ────────────

export const EMPTY_CURRENT_PLAN: CurrentPlanData = {
  audience: "smb",
  canManage: false,
  stripeCustomerId: null,
  hasCustomer: false,
  subscriptionId: null,
  plan: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  amountCents: null,
  currency: "usd",
  displayName: null,
};

export const EMPTY_INVOICES: InvoicesData = {
  invoices: [],
  hasMore: false,
};

// ─── Internal user-row shape ────────────────────────────────────────────────

interface BillingUserRow {
  id: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePlan: string | null;
  stripeStatus: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  agencyMembers: Array<{
    role: "OWNER" | "ADMIN" | "STAFF";
    agency: {
      id: string;
      name: string;
      plan: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      stripePlan: string | null;
      stripeStatus: string | null;
      stripePriceId: string | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    } | null;
  }>;
}

async function loadBillingUser(userId: string): Promise<BillingUserRow | null> {
  return (await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePlan: true,
      stripeStatus: true,
      stripePriceId: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      agencyMembers: {
        select: {
          role: true,
          agency: {
            select: {
              id: true,
              name: true,
              plan: true,
              stripeCustomerId: true,
              stripeSubscriptionId: true,
              stripePlan: true,
              stripeStatus: true,
              stripePriceId: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
            },
          },
        },
        take: 1,
      },
    },
  })) as BillingUserRow | null;
}

// ─── Public · Current plan ─────────────────────────────────────────────────

/**
 * Resolve the "current plan" view for the SMB settings page.
 *
 * Reads from `User.stripe*` columns (kept in sync by the webhook handler).
 * Falls back to a no-op EMPTY value during Vercel build or on Prisma
 * failure — the shell renders, runtime first-request re-runs.
 */
export async function getSmbCurrentPlan(
  userId: string,
): Promise<CurrentPlanData> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_CURRENT_PLAN;
  }
  try {
    const user = await loadBillingUser(userId);
    if (!user) return EMPTY_CURRENT_PLAN;
    return shapeUserPlan(user);
  } catch {
    return EMPTY_CURRENT_PLAN;
  }
}

/**
 * Resolve the "current plan" view for the AGENCY settings page.
 *
 * Reads from `Agency.stripe*` columns. The viewing user's `AgencyMember.role`
 * determines `canManage` — STAFF see the data but can't open the portal.
 */
export async function getAgencyCurrentPlan(
  userId: string,
): Promise<CurrentPlanData> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return { ...EMPTY_CURRENT_PLAN, audience: "agency" };
  }
  try {
    const user = await loadBillingUser(userId);
    if (!user) return { ...EMPTY_CURRENT_PLAN, audience: "agency" };
    return shapeAgencyPlan(user);
  } catch {
    return { ...EMPTY_CURRENT_PLAN, audience: "agency" };
  }
}

function shapeUserPlan(user: BillingUserRow): CurrentPlanData {
  return {
    audience: "smb",
    canManage: true, // SMB user always owns their own subscription
    stripeCustomerId: user.stripeCustomerId,
    hasCustomer: Boolean(user.stripeCustomerId),
    subscriptionId: user.stripeSubscriptionId,
    plan: asPlan(user.stripePlan),
    status: user.stripeStatus,
    currentPeriodEnd: user.currentPeriodEnd,
    cancelAtPeriodEnd: user.cancelAtPeriodEnd,
    amountCents: amountFromPlan(asPlan(user.stripePlan)),
    currency: "usd",
    displayName: null,
  };
}

function shapeAgencyPlan(user: BillingUserRow): CurrentPlanData {
  const membership = user.agencyMembers[0];
  const agency = membership?.agency ?? null;
  if (!agency) return { ...EMPTY_CURRENT_PLAN, audience: "agency" };
  return {
    audience: "agency",
    canManage: membership.role === "OWNER" || membership.role === "ADMIN",
    stripeCustomerId: agency.stripeCustomerId,
    hasCustomer: Boolean(agency.stripeCustomerId),
    subscriptionId: agency.stripeSubscriptionId,
    plan: asPlan(agency.stripePlan),
    status: agency.stripeStatus,
    currentPeriodEnd: agency.currentPeriodEnd,
    cancelAtPeriodEnd: agency.cancelAtPeriodEnd,
    amountCents: amountFromPlan(asPlan(agency.stripePlan)),
    currency: "usd",
    displayName: agency.name,
  };
}

function asPlan(literal: string | null): Plan | null {
  if (!literal) return null;
  switch (literal) {
    case "smb_paid":
    case "agency_solo":
    case "agency_growth":
    case "agency_pro":
    case "agency_boutique":
      return literal;
    default:
      return null;
  }
}

/**
 * Static plan → monthly price (cents). Source of truth per CLAUDE.md
 * (SMB $29; Agency Solo $49, Growth $99, Pro $249, Boutique $499). Used
 * for UI display only — Stripe's invoices are the dollar source of truth.
 */
export function amountFromPlan(plan: Plan | null): number | null {
  switch (plan) {
    case "smb_paid":
      return 2900;
    case "agency_solo":
      return 4900;
    case "agency_growth":
      return 9900;
    case "agency_pro":
      return 24900;
    case "agency_boutique":
      return 49900;
    case null:
    default:
      return null;
  }
}

// ─── Public · Invoices ─────────────────────────────────────────────────────

/** Maximum number of invoices to fetch from Stripe per page. */
export const INVOICE_PAGE_SIZE = 12;

/**
 * Fetch the last 12 invoices for an SMB user via Stripe API. Returns
 * EMPTY during Vercel build (no Stripe socket) and EMPTY when the user
 * has no `stripeCustomerId` (pre-subscribe state).
 */
export async function getSmbInvoices(userId: string): Promise<InvoicesData> {
  if (process.env.NEXT_PHASE === "phase-production-build")
    return EMPTY_INVOICES;
  try {
    const user = await loadBillingUser(userId);
    if (!user?.stripeCustomerId) return EMPTY_INVOICES;
    return fetchInvoices(user.stripeCustomerId);
  } catch {
    return EMPTY_INVOICES;
  }
}

/**
 * Fetch the last 12 invoices for an AGENCY (resolved from the user's
 * first AgencyMember). Same EMPTY semantics as the SMB variant.
 */
export async function getAgencyInvoices(userId: string): Promise<InvoicesData> {
  if (process.env.NEXT_PHASE === "phase-production-build")
    return EMPTY_INVOICES;
  try {
    const user = await loadBillingUser(userId);
    const agency = user?.agencyMembers[0]?.agency ?? null;
    if (!agency?.stripeCustomerId) return EMPTY_INVOICES;
    return fetchInvoices(agency.stripeCustomerId);
  } catch {
    return EMPTY_INVOICES;
  }
}

async function fetchInvoices(customerId: string): Promise<InvoicesData> {
  // Stripe list endpoint returns newest-first; ask for one extra to detect
  // truncation cheaply.
  const list = await stripeClient.invoices.list({
    customer: customerId,
    limit: INVOICE_PAGE_SIZE + 1,
  });
  const slice = list.data.slice(0, INVOICE_PAGE_SIZE);
  return {
    invoices: slice.map(toInvoiceRow),
    hasMore: list.data.length > INVOICE_PAGE_SIZE || list.has_more,
  };
}

function toInvoiceRow(invoice: Stripe.Invoice): InvoiceRow {
  return {
    id: invoice.id ?? "",
    number: invoice.number ?? null,
    createdAt: new Date(invoice.created * 1000),
    status: invoice.status ?? null,
    amountPaidCents: invoice.amount_paid ?? 0,
    currency: invoice.currency ?? "usd",
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
  };
}
