/**
 * Agency billing settings · `/(agency)/team/billing` (path renamed to avoid (smb)/(agency) URL collision).
 *
 * Audience: Tom. Per `.claude/rules/ui-ux-agency.md`:
 *   - Tool-y, dense, jargon-OK. "Subscription · Growth · $99/mo · renews
 *     2026-06-18" is the tone.
 *   - Cool gray + indigo palette tokens.
 *   - Tables are first-class (invoices fit naturally).
 *   - Imperative actions ("Manage subscription", "Open invoice").
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2: sync default export + Suspense'd async body.
 *   - Pattern 1: queries return EMPTY during build / on Prisma failure.
 *
 * Per `.claude/rules/security.md`:
 *   - `auth()` + `unauthorized()` interrupt at the inner body's top.
 *   - Cross-agency leakage protected by the queries' AgencyMember scope
 *     (queries look up the user's first membership).
 *
 * Tier-change UX: STAFF members see the data but can't open the portal —
 * we hide the "Manage" CTA and render an explanation instead. OWNER/ADMIN
 * get a form-action that opens Stripe's customer portal.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { openBillingPortal } from "@/modules/billing/actions";
import {
  getAgencyCurrentPlan,
  getAgencyInvoices,
  type CurrentPlanData,
  type InvoiceRow,
  type InvoicesData,
} from "@/modules/billing/queries";
import type { Plan } from "@/modules/billing/plans";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "agency.settings.billing.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

export default function AgencyBillingPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<BillingSkeleton />}>
      <BillingBody params={params} />
    </Suspense>
  );
}

function BillingSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        padding: "32px 24px 64px",
      }}
    >
      <div
        style={{
          height: 22,
          width: 180,
          background: "var(--color-bg-3)",
          borderRadius: 6,
          marginBottom: 20,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            height: 140,
            background: "var(--color-bg-2)",
            borderRadius: 10,
          }}
        />
        <div
          style={{
            height: 140,
            background: "var(--color-bg-2)",
            borderRadius: 10,
          }}
        />
      </div>
      <div
        style={{
          height: 280,
          background: "var(--color-bg-2)",
          borderRadius: 10,
        }}
      />
    </section>
  );
}

async function BillingBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const t = await getTranslations("agency.settings.billing");

  const [plan, invoices] = await Promise.all([
    getAgencyCurrentPlan(session.user.id),
    getAgencyInvoices(session.user.id),
  ]);

  const returnUrl = absoluteReturnUrl(locale);

  return (
    <section
      aria-labelledby="billing-heading"
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        padding: "32px 24px 64px",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-3)",
          }}
        >
          {t("eyebrow")}
        </p>
        <h1
          id="billing-heading"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 26,
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            margin: "4px 0 0",
            color: "var(--color-text)",
          }}
        >
          {t("title")}
        </h1>
        {plan.displayName ? (
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--color-text-2)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
            }}
          >
            {plan.displayName}
          </p>
        ) : null}
      </header>

      <CurrentPlanCard
        plan={plan}
        returnUrl={returnUrl}
        labels={{
          headingActive: t("current_plan_heading"),
          headingFree: t("free_plan_heading"),
          freeBody: t("free_plan_body"),
          subscribeCta: t("subscribe_cta"),
          manageCta: t("manage_cta"),
          manageStaffNote: t("manage_staff_note"),
          planLabel: t("plan_label"),
          statusLabel: t("status_label"),
          renewsLabel: t("renews_label"),
          endsLabel: t("ends_label"),
          pendingCancelLabel: t("pending_cancel"),
          monthlySuffix: t("per_month"),
          statusActive: t("status_active"),
          statusPastDue: t("status_past_due"),
          statusCanceled: t("status_canceled"),
          statusTrialing: t("status_trialing"),
          statusOther: t("status_other"),
          planSolo: t("plan_solo"),
          planGrowth: t("plan_growth"),
          planPro: t("plan_pro"),
          planBoutique: t("plan_boutique"),
          planFallback: t("plan_fallback"),
          locale,
        }}
      />

      <InvoicesSection
        invoices={invoices}
        labels={{
          heading: t("invoices_heading"),
          empty: t("invoices_empty"),
          colDate: t("col_date"),
          colInvoice: t("col_invoice"),
          colAmount: t("col_amount"),
          colStatus: t("col_status"),
          colAction: t("col_action"),
          openAction: t("open_action"),
          openAriaLabel: t("open_aria"),
          moreNote: t("invoices_more_note"),
          statusPaid: t("invoice_status_paid"),
          statusOpen: t("invoice_status_open"),
          statusVoid: t("invoice_status_void"),
          statusUncollectible: t("invoice_status_uncollectible"),
          statusDraft: t("invoice_status_draft"),
          locale,
        }}
      />
    </section>
  );
}

// ─── Current plan card ─────────────────────────────────────────────────────

interface CurrentPlanLabels {
  headingActive: string;
  headingFree: string;
  freeBody: string;
  subscribeCta: string;
  manageCta: string;
  manageStaffNote: string;
  planLabel: string;
  statusLabel: string;
  renewsLabel: string;
  endsLabel: string;
  pendingCancelLabel: string;
  monthlySuffix: string;
  statusActive: string;
  statusPastDue: string;
  statusCanceled: string;
  statusTrialing: string;
  statusOther: string;
  planSolo: string;
  planGrowth: string;
  planPro: string;
  planBoutique: string;
  planFallback: string;
  locale: string;
}

function CurrentPlanCard({
  plan,
  returnUrl,
  labels,
}: {
  plan: CurrentPlanData;
  returnUrl: string;
  labels: CurrentPlanLabels;
}) {
  const isActive = plan.hasCustomer && (plan.subscriptionId || plan.status);

  if (!isActive) {
    return (
      <section aria-labelledby="current-plan-heading" style={cardStyle()}>
        <h2 id="current-plan-heading" style={cardTitleStyle()}>
          {labels.headingFree}
        </h2>
        <p
          style={{
            margin: "8px 0 16px",
            color: "var(--color-text-2)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {labels.freeBody}
        </p>
        <Link href="/pricing" style={primaryButtonStyle()}>
          {labels.subscribeCta}
        </Link>
      </section>
    );
  }

  const planName = formatPlanName(plan.plan, labels);
  const amount = formatAmount(plan.amountCents, plan.currency, labels.locale);
  const statusLabel = formatStatus(plan.status, labels);
  const renewDate = plan.currentPeriodEnd
    ? formatDate(plan.currentPeriodEnd, labels.locale)
    : null;
  const renewLine = renewDate
    ? plan.cancelAtPeriodEnd
      ? `${labels.endsLabel} ${renewDate}`
      : `${labels.renewsLabel} ${renewDate}`
    : null;

  return (
    <section aria-labelledby="current-plan-heading" style={cardStyle()}>
      <h2 id="current-plan-heading" style={cardTitleStyle()}>
        {labels.headingActive}
      </h2>

      <dl
        style={{
          margin: "14px 0 18px",
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          columnGap: 16,
          rowGap: 8,
          fontSize: 14,
        }}
      >
        <dt style={dtStyle()}>{labels.planLabel}</dt>
        <dd style={ddStyle()}>
          <span style={{ fontWeight: 600 }}>{planName}</span>
          {amount ? (
            <span
              style={{
                marginLeft: 8,
                color: "var(--color-text-2)",
              }}
            >
              · {amount} {labels.monthlySuffix}
            </span>
          ) : null}
        </dd>

        {statusLabel ? (
          <>
            <dt style={dtStyle()}>{labels.statusLabel}</dt>
            <dd style={ddStyle()}>
              <StatusPill status={plan.status} label={statusLabel} />
              {plan.cancelAtPeriodEnd ? (
                <span
                  style={{
                    marginLeft: 8,
                    color: "var(--color-text-3)",
                    fontSize: 12,
                  }}
                >
                  · {labels.pendingCancelLabel}
                </span>
              ) : null}
            </dd>
          </>
        ) : null}

        {renewLine ? (
          <>
            <dt style={dtStyle()}>
              {plan.cancelAtPeriodEnd ? labels.endsLabel : labels.renewsLabel}
            </dt>
            <dd style={ddStyle()}>{renewDate}</dd>
          </>
        ) : null}
      </dl>

      {plan.canManage ? (
        <form action={openBillingPortal} style={{ marginTop: 4 }}>
          <input type="hidden" name="returnUrl" value={returnUrl} />
          <button type="submit" style={primaryButtonStyle()}>
            {labels.manageCta}
          </button>
        </form>
      ) : (
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--color-text-3)",
            fontSize: 13,
            fontStyle: "italic",
          }}
        >
          {labels.manageStaffNote}
        </p>
      )}
    </section>
  );
}

function formatPlanName(
  plan: Plan | null,
  labels: Pick<
    CurrentPlanLabels,
    "planSolo" | "planGrowth" | "planPro" | "planBoutique" | "planFallback"
  >,
): string {
  switch (plan) {
    case "agency_solo":
      return labels.planSolo;
    case "agency_growth":
      return labels.planGrowth;
    case "agency_pro":
      return labels.planPro;
    case "agency_boutique":
      return labels.planBoutique;
    default:
      return labels.planFallback;
  }
}

function StatusPill({
  status,
  label,
}: {
  status: string | null;
  label: string;
}) {
  const tone = statusTone(status);
  return (
    <span
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 9px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone.fg,
        }}
      />
      {label}
    </span>
  );
}

function statusTone(status: string | null): {
  bg: string;
  fg: string;
  border: string;
} {
  switch (status) {
    case "active":
    case "trialing":
      return {
        bg: "var(--color-success-bg, rgba(16, 156, 102, 0.08))",
        fg: "var(--color-success)",
        border: "var(--color-success)",
      };
    case "past_due":
    case "unpaid":
      return {
        bg: "var(--color-alert-bg, rgba(195, 85, 58, 0.08))",
        fg: "var(--color-alert)",
        border: "var(--color-alert)",
      };
    case "canceled":
    case "incomplete_expired":
      return {
        bg: "var(--color-bg-3)",
        fg: "var(--color-text-3)",
        border: "var(--color-border)",
      };
    default:
      return {
        bg: "var(--color-bg-3)",
        fg: "var(--color-text-2)",
        border: "var(--color-border)",
      };
  }
}

function formatStatus(
  status: string | null,
  labels: Pick<
    CurrentPlanLabels,
    | "statusActive"
    | "statusPastDue"
    | "statusCanceled"
    | "statusTrialing"
    | "statusOther"
  >,
): string | null {
  if (!status) return null;
  switch (status) {
    case "active":
      return labels.statusActive;
    case "trialing":
      return labels.statusTrialing;
    case "past_due":
    case "unpaid":
      return labels.statusPastDue;
    case "canceled":
    case "incomplete_expired":
      return labels.statusCanceled;
    default:
      return labels.statusOther;
  }
}

// ─── Invoices section ──────────────────────────────────────────────────────

interface InvoicesLabels {
  heading: string;
  empty: string;
  colDate: string;
  colInvoice: string;
  colAmount: string;
  colStatus: string;
  colAction: string;
  openAction: string;
  openAriaLabel: string;
  moreNote: string;
  statusPaid: string;
  statusOpen: string;
  statusVoid: string;
  statusUncollectible: string;
  statusDraft: string;
  locale: string;
}

function InvoicesSection({
  invoices,
  labels,
}: {
  invoices: InvoicesData;
  labels: InvoicesLabels;
}) {
  if (invoices.invoices.length === 0) {
    return (
      <section aria-labelledby="invoices-heading" style={cardStyle()}>
        <h2 id="invoices-heading" style={cardTitleStyle()}>
          {labels.heading}
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--color-text-2)",
            fontSize: 14,
          }}
        >
          {labels.empty}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="invoices-heading" style={cardStyle()}>
      <h2 id="invoices-heading" style={cardTitleStyle()}>
        {labels.heading}
      </h2>
      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-3)" }}>
              <th scope="col" style={thStyle()}>
                {labels.colDate}
              </th>
              <th scope="col" style={thStyle()}>
                {labels.colInvoice}
              </th>
              <th scope="col" style={thStyle()}>
                {labels.colAmount}
              </th>
              <th scope="col" style={thStyle()}>
                {labels.colStatus}
              </th>
              <th scope="col" style={{ ...thStyle(), textAlign: "right" }}>
                <span className="sr-only">{labels.colAction}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.invoices.map((row) => (
              <InvoiceRowComponent
                key={
                  row.id ||
                  `${row.createdAt.toISOString()}-${row.amountPaidCents}`
                }
                row={row}
                labels={labels}
              />
            ))}
          </tbody>
        </table>
      </div>
      {invoices.hasMore ? (
        <p
          style={{
            margin: "10px 0 0",
            color: "var(--color-text-3)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          {labels.moreNote}
        </p>
      ) : null}
    </section>
  );
}

function InvoiceRowComponent({
  row,
  labels,
}: {
  row: InvoiceRow;
  labels: InvoicesLabels;
}) {
  const date = formatDate(row.createdAt, labels.locale);
  const amount = formatAmount(row.amountPaidCents, row.currency, labels.locale);
  const status = invoiceStatusLabel(row.status, labels);
  const downloadHref = row.hostedInvoiceUrl ?? row.invoicePdfUrl ?? null;
  const ariaLabel = labels.openAriaLabel.replace("{date}", date);

  return (
    <tr style={{ borderTop: "1px solid var(--color-border)" }}>
      <td style={tdStyle()}>{date}</td>
      <td style={tdStyle()}>
        {row.number ?? <span style={{ color: "var(--color-text-3)" }}>—</span>}
      </td>
      <td style={tdStyle()}>{amount}</td>
      <td style={tdStyle()}>{status}</td>
      <td style={{ ...tdStyle(), textAlign: "right" }}>
        {downloadHref ? (
          <a
            href={downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={ariaLabel}
            style={{
              color: "var(--color-agency-indigo)",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            {labels.openAction}
          </a>
        ) : (
          <span style={{ color: "var(--color-text-3)" }}>—</span>
        )}
      </td>
    </tr>
  );
}

function invoiceStatusLabel(
  status: string | null,
  labels: Pick<
    InvoicesLabels,
    | "statusPaid"
    | "statusOpen"
    | "statusVoid"
    | "statusUncollectible"
    | "statusDraft"
  >,
): string {
  switch (status) {
    case "paid":
      return labels.statusPaid;
    case "open":
      return labels.statusOpen;
    case "void":
      return labels.statusVoid;
    case "uncollectible":
      return labels.statusUncollectible;
    case "draft":
      return labels.statusDraft;
    default:
      return status ?? "—";
  }
}

// ─── Styles + helpers ──────────────────────────────────────────────────────

function cardStyle(): React.CSSProperties {
  return {
    padding: "20px 22px 22px",
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 10,
    marginBottom: 16,
  };
}

function cardTitleStyle(): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: "var(--font-sans)",
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "-0.005em",
    color: "var(--color-text)",
  };
}

function primaryButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 38,
    padding: "0 14px",
    background: "var(--color-agency-indigo)",
    color: "#fff",
    border: "1px solid var(--color-agency-indigo)",
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "var(--font-sans)",
    textDecoration: "none",
    cursor: "pointer",
  };
}

function dtStyle(): React.CSSProperties {
  return {
    margin: 0,
    color: "var(--color-text-3)",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontFamily: "var(--font-mono)",
    paddingTop: 2,
  };
}

function ddStyle(): React.CSSProperties {
  return {
    margin: 0,
    color: "var(--color-text)",
  };
}

function thStyle(): React.CSSProperties {
  return {
    padding: "8px 12px 8px 0",
    fontSize: 11,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
}

function tdStyle(): React.CSSProperties {
  return {
    padding: "9px 12px 9px 0",
    color: "var(--color-text)",
  };
}

function formatAmount(
  cents: number | null,
  currency: string,
  locale: string,
): string | null {
  if (cents == null) return null;
  try {
    return new Intl.NumberFormat(jsLocale(locale), {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function formatDate(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(jsLocale(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function jsLocale(locale: string): string {
  switch (locale) {
    case "en":
      return "en-US";
    case "es":
      return "es-US";
    case "en-CA":
      return "en-CA";
    case "fr":
      return "fr-CA";
    default:
      return locale;
  }
}

function absoluteReturnUrl(locale: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const prefix = locale === "en" ? "" : `/${locale}`;
  return `${base}${prefix}/team/billing`;
}
