/**
 * Agency · unified "Billing & credits" page · `/(agency)/team/billing`.
 *
 * This is the prototype's single credit-economy screen (docs/portal-prototype.html
 * #view-billing) rebuilt on the `.agency-portal` design system. It UNIFIES what
 * was previously split across /team/billing (Stripe subscription) and /usage
 * (wallet + ledger). /usage now redirects here.
 *
 * Top-to-bottom composition (reworked 2026-07-09 · Part D):
 *   1. Header + credit explainer
 *   2. Slim current-plan card (plan · balance · renews · thin bar · cancel/resume)
 *   3. Plans grid (4 paid cards: Starter / Solo · featured / Growth / Pro) +
 *      the Free plan as a de-emphasized horizontal strip below
 *   4. What-a-credit-buys + Top-up packs (2-up, #topup anchor)
 *   5. Why-Mapsly-is-cheaper comparison table (+ Origami row)
 *   6. Credit ledger (paginated, timestamps, run detail)
 *   7. Stripe invoices (low-emphasis "update card in Stripe" link)
 *
 * Pricing is the canonical prototype model in modules/cost/pricing.ts
 * (PLAN_CARDS / TOPUP_PACKS / CREDIT_MEANING). The display layer is decoupled
 * from the Prisma AgencyPlan enum via planKeyForEnum() — the live grant engine
 * (PLAN_CREDITS) and the Stripe enum are untouched (see the build summary for
 * what remains human-required).
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 — sync default export, async
 * body in a Suspense boundary doing auth + DB reads (no `export const dynamic`,
 * no function props across a client boundary; the CTAs are server-action forms).
 *
 * Auth mirrors /(agency)/touchpoints: no session → unauthorized(); session but
 * no AgencyMember → redirect('/home'). Copy is English-only (i18n/routing.ts).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { openBillingPortal } from "@/modules/billing/actions";
import {
  isPlanCheckoutConfigured,
  isTopUpConfigured,
} from "@/modules/billing/credit-checkout";
import {
  getAgencyInvoices,
  type InvoiceRow,
  type InvoicesData,
} from "@/modules/billing/queries";
import { buildUsageDetails } from "@/modules/billing/usage-detail";
import { grantFreeTierIfNew } from "@/modules/cost/server";
import { isPaidAgency } from "@/modules/agency-portal/team/seats";
import {
  PLAN_CARDS,
  planKeyForEnum,
  type AgencyPlanTier,
  type PlanKey,
  type TopUpPack,
} from "@/modules/cost/pricing";

import { CreditExplainer } from "@/components/agency/billing/CreditExplainer";
import { CurrentPlanWalletCard } from "@/components/agency/billing/CurrentPlanWalletCard";
import { PlansGrid } from "@/components/agency/billing/PlansGrid";
import { WhatACreditBuys } from "@/components/agency/billing/WhatACreditBuys";
import { TopUpPacks } from "@/components/agency/billing/TopUpPacks";
import { WhyCheaper } from "@/components/agency/billing/WhyCheaper";
import {
  CreditLedgerTable,
  type LedgerRow,
} from "@/components/agency/billing/CreditLedgerTable";

export const metadata: Metadata = {
  title: "Billing & credits · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Newest-N ledger rows loaded for the usage table; also drives the "older
 *  activity exists" truncation note (must stay a single source of truth). */
const LEDGER_PAGE_LIMIT = 50;

export default function AgencyBillingPage({ params, searchParams }: PageProps) {
  return (
    <Suspense fallback={null}>
      <BillingBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BillingBody({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // WP2-3 · `?deficit=N` arrives from the Preview credit wall / cost bars —
  // the run the buyer just tried was N credits short. Frames the header so
  // the context survives the navigation. Bounded parse; garbage → ignored.
  const sp = await searchParams;
  const deficitRaw = typeof sp.deficit === "string" ? Number(sp.deficit) : NaN;
  const deficit =
    Number.isFinite(deficitRaw) && deficitRaw > 0 && deficitRaw <= 1_000_000
      ? Math.ceil(deficitRaw)
      : null;

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    select: { agencyId: true, role: true },
  });
  if (!member) {
    redirect({ href: "/home", locale });
    return null;
  }
  const agencyId = member.agencyId;
  const canManage = member.role === "OWNER" || member.role === "ADMIN";

  // Fund a brand-new agency's free tier so the wallet shows a real balance.
  await grantFreeTierIfNew(agencyId).catch(() => {});

  const [wallet, agency, ledger, invoices, planCfg, topUpCfg] =
    await Promise.all([
      prisma.agencyWallet.findUnique({
        where: { agencyId },
        select: {
          planCredits: true,
          purchasedCredits: true,
          rolloverCredits: true,
          heldCredits: true,
        },
      }),
      prisma.agency.findUnique({
        where: { id: agencyId },
        select: {
          plan: true,
          currentPeriodEnd: true,
          stripeStatus: true,
          cancelAtPeriodEnd: true,
        },
      }),
      prisma.creditLedger.findMany({
        where: { agencyId },
        orderBy: { createdAt: "desc" },
        take: LEDGER_PAGE_LIMIT,
        select: {
          id: true,
          type: true,
          credits: true,
          note: true,
          runId: true,
          createdAt: true,
        },
      }),
      getAgencyInvoices(session.user.id),
      Promise.all([
        isPlanCheckoutConfigured("starter"),
        isPlanCheckoutConfigured("solo"),
        isPlanCheckoutConfigured("growth"),
        isPlanCheckoutConfigured("scale"),
      ]),
      Promise.all([
        isTopUpConfigured("pack_1000"),
        isTopUpConfigured("pack_5000"),
      ]),
    ]);

  const planBucket =
    (wallet?.planCredits ?? 0) + (wallet?.rolloverCredits ?? 0);
  const topUpBalance = wallet?.purchasedCredits ?? 0;
  const held = wallet?.heldCredits ?? 0;
  const availableBalance = Math.max(0, planBucket + topUpBalance - held);

  // A SOLO/GROWTH/etc. AgencyPlan only counts as a PAID plan when the Stripe
  // subscription is actually live — feature-gating consults stripeStatus, and
  // the default plan (SOLO) covers the pre-billing free state. Without an
  // active subscription the agency is on Free regardless of the enum value.
  //
  // Review Part E · use isPaidAgency (active/trialing/PAST_DUE) so a dunning
  // subscriber is treated as a subscriber: they see portal "switch/upgrade"
  // CTAs, not fresh-checkout buttons that would create a second subscription.
  const subActive = isPaidAgency(agency?.stripeStatus ?? null);
  const activePlanKey: PlanKey = subActive
    ? planKeyForEnum(
        (agency?.plan as AgencyPlanTier | null | undefined) ?? null,
      )
    : "free";
  const activeCard = PLAN_CARDS[activePlanKey];

  // Renewal date label (e.g. "Jul 1"). Free tier shows none.
  const renewsLabel =
    !activeCard.oneTime && agency?.currentPeriodEnd
      ? formatRenew(agency.currentPeriodEnd)
      : null;

  // Phase 5 · join run metadata so each usage row can show market · N
  // businesses · what ran (defensive — empty map on any failure).
  const usageDetails = await buildUsageDetails(ledger.map((l) => l.runId));
  const ledgerRows: LedgerRow[] = ledger.map((l) => ({
    id: l.id,
    type: l.type,
    credits: l.credits,
    note: l.note,
    createdAt: l.createdAt,
    runId: l.runId,
    detail: l.runId ? (usageDetails.get(l.runId) ?? null) : null,
  }));
  // The ledger query loads at most LEDGER_PAGE_LIMIT rows; if it returned
  // exactly that many, older activity exists beyond the loaded window.
  const ledgerTruncated = ledger.length === LEDGER_PAGE_LIMIT;

  const planConfigured: Record<Exclude<PlanKey, "free">, boolean> = {
    starter: planCfg[0],
    solo: planCfg[1],
    growth: planCfg[2],
    scale: planCfg[3],
  };
  const topUpConfigured: Record<TopUpPack["key"], boolean> = {
    pack_1000: topUpCfg[0],
    pack_5000: topUpCfg[1],
  };

  return (
    <div className="view">
      {deficit != null ? (
        <div className="callout amber" style={{ marginBottom: 12 }}>
          <div>
            <b>Your run needs {deficit.toLocaleString()} more credits.</b>{" "}
            <a
              href="#topup"
              style={{ color: "var(--indigo)", fontWeight: 600 }}
            >
              Top up below
            </a>{" "}
            — the pack lands instantly and your Preview picks up where you left
            off.
          </div>
        </div>
      ) : null}
      <CreditExplainer />

      <CurrentPlanWalletCard
        planName={activeCard.displayName}
        featured={activeCard.featured}
        monthlyCredits={activeCard.monthlyCredits}
        oneTime={activeCard.oneTime}
        renewsLabel={renewsLabel}
        planBalance={planBucket}
        topUpBalance={topUpBalance}
        availableBalance={availableBalance}
        heldCredits={held}
        locale={locale}
        subActive={subActive}
        cancelAtPeriodEnd={Boolean(agency?.cancelAtPeriodEnd)}
        canManage={canManage}
      />

      <PlansGrid
        activePlan={activePlanKey}
        configured={planConfigured}
        locale={locale}
        subActive={subActive}
        portalReturnUrl={billingReturnUrl(locale)}
      />

      <div
        id="topup"
        className="grid"
        style={{
          gridTemplateColumns: "1fr 1fr",
          marginTop: 16,
          alignItems: "stretch",
          scrollMarginTop: 16,
        }}
      >
        <WhatACreditBuys />
        <TopUpPacks
          configured={topUpConfigured}
          locale={locale}
          available={subActive}
        />
      </div>

      <WhyCheaper />

      <CreditLedgerTable
        rows={ledgerRows}
        currentBalance={availableBalance}
        truncated={ledgerTruncated}
      />

      <InvoicesSection
        invoices={invoices}
        returnUrl={billingReturnUrl(locale)}
      />
    </div>
  );
}

// ─── Invoices (Stripe subscription management) ──────────────────────────────

function InvoicesSection({
  invoices,
  returnUrl,
}: {
  invoices: InvoicesData;
  returnUrl: string;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2>Invoices</h2>
          <p className="note" style={{ marginTop: -4 }}>
            Your Stripe billing history — receipts and the card on file.
          </p>
        </div>
        {/* Low-emphasis portal link — card + older invoices only. Cancel/resume
            is native now (current-plan card); no redundant "Manage" button. */}
        <form action={openBillingPortal} style={{ margin: 0 }}>
          <input type="hidden" name="returnUrl" value={returnUrl} />
          <button
            type="submit"
            className="linkbtn"
            style={{
              border: "none",
              background: "none",
              padding: 0,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--indigo)",
            }}
          >
            Update card in Stripe →
          </button>
        </form>
      </div>

      {invoices.invoices.length === 0 ? (
        <p className="note" style={{ marginTop: 10 }}>
          No invoices yet. Subscription receipts appear here once you upgrade.
        </p>
      ) : (
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Invoice</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.invoices.map((row) => (
              <InvoiceRowView key={invoiceKey(row)} row={row} />
            ))}
          </tbody>
        </table>
      )}
      {invoices.hasMore ? (
        <p className="note" style={{ marginTop: 10 }}>
          Older invoices are available in the Stripe portal.
        </p>
      ) : null}
    </div>
  );
}

function InvoiceRowView({ row }: { row: InvoiceRow }) {
  const date = formatInvoiceDate(row.createdAt);
  const amount = formatAmount(row.amountPaidCents, row.currency);
  const downloadHref = row.hostedInvoiceUrl ?? row.invoicePdfUrl ?? null;
  return (
    <tr>
      <td>{date}</td>
      <td>{row.number ?? "—"}</td>
      <td style={{ textAlign: "right", fontFamily: "var(--mono)" }}>
        {amount}
      </td>
      <td>{row.status ?? "—"}</td>
      <td style={{ textAlign: "right" }}>
        {downloadHref ? (
          <a
            href={downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open invoice from ${date}`}
            style={{ color: "var(--indigo)", fontWeight: 600 }}
          >
            Open →
          </a>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRenew(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatInvoiceDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function invoiceKey(row: InvoiceRow): string {
  return row.id || `${row.createdAt.toISOString()}-${row.amountPaidCents}`;
}

function billingReturnUrl(locale: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const prefix = locale === "en" ? "" : `/${locale}`;
  return `${base}${prefix}/team/billing`;
}
