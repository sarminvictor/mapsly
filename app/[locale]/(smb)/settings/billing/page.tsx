/**
 * SMB billing settings · `/(smb)/settings/billing`.
 *
 * Audience: Maria. Per `.claude/rules/ui-ux-smb.md`:
 *   - Warm, plain English, single primary CTA, info-tips for jargon.
 *   - No tables until they fit (invoices is the rare case where a table
 *     is the right shape — keep it light, mobile-friendly).
 *   - Generous whitespace; one focal action per screen.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2: sync default export + Suspense'd async body.
 *   - Pattern 1: `modules/billing/queries.ts` has NEXT_PHASE guards
 *     returning typed EMPTY values so Vercel build prerenders cleanly.
 *   - No `'use cache'` on the data fetchers — billing state must be live.
 *
 * Per `.claude/rules/security.md`:
 *   - `auth()` at the top of the inner Suspense'd body; `unauthorized()`
 *     interrupt for anon visitors.
 *
 * Per `.claude/rules/i18n.md`:
 *   - No hardcoded English — keys under `smb.settings.billing.*`.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { requirePortal } from "@/lib/portal-guard";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { openBillingPortal } from "@/modules/billing/actions";
import {
  getSmbCurrentPlan,
  getSmbInvoices,
  type CurrentPlanData,
  type InvoiceRow,
  type InvoicesData,
} from "@/modules/billing/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "smb.settings.billing.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    // Authenticated route — keep out of search results.
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

/**
 * Default export · SYNC shell with a Suspense'd async body. The shell
 * itself does ZERO async work so cacheComponents can prerender it.
 */
export default function SmbBillingPage({
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
        maxWidth: 720,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <div
        style={{
          height: 28,
          width: 180,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          height: 160,
          background: "var(--color-bg-2)",
          borderRadius: 16,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          height: 220,
          background: "var(--color-bg-2)",
          borderRadius: 16,
        }}
      />
    </section>
  );
}

/**
 * Async body · auth + Stripe reads + render. Lives inside the Suspense
 * boundary so the page-shell remains prerenderable. Throws redirect via
 * `unauthorized()` for anon visitors (Next 16 auth interrupts).
 */
async function BillingBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  // Cross-portal guard · agency members get bounced to /lists so the
  // SMB portal is reserved for Maria + non-agency users (ADMIN passes
  // through). Per `lib/portal-guard.ts`.
  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.settings.billing");

  const [plan, invoices] = await Promise.all([
    getSmbCurrentPlan(session.user.id),
    getSmbInvoices(session.user.id),
  ]);

  const returnUrl = absoluteReturnUrl(locale);

  return (
    <section
      aria-labelledby="billing-heading"
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <header style={{ marginBottom: 28 }}>
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
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 36px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: "6px 0 0",
            color: "var(--color-text)",
          }}
        >
          {t("title")}
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--color-text-2)",
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {t("subtitle")}
        </p>
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
          planLabel: t("plan_label"),
          smbPlanName: t("smb_plan_name"),
          statusActive: t("status_active"),
          statusPastDue: t("status_past_due"),
          statusCanceled: t("status_canceled"),
          statusTrialing: t("status_trialing"),
          statusOther: t("status_other"),
          renewsLabel: t("renews_on"),
          endsLabel: t("ends_on"),
          pendingCancelLabel: t("pending_cancel"),
          monthlySuffix: t("per_month"),
          locale,
        }}
      />

      <InvoicesSection
        invoices={invoices}
        labels={{
          heading: t("invoices_heading"),
          empty: t("invoices_empty"),
          colDate: t("col_date"),
          colAmount: t("col_amount"),
          colStatus: t("col_status"),
          colDownload: t("col_download"),
          downloadAction: t("download_action"),
          // Per-row template — the invoices table fills {date} via .replace().
          // Pass the placeholder literal so next-intl keeps "{date}" intact.
          downloadAriaLabel: t("download_aria", { date: "{date}" }),
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
  planLabel: string;
  smbPlanName: string;
  statusActive: string;
  statusPastDue: string;
  statusCanceled: string;
  statusTrialing: string;
  statusOther: string;
  renewsLabel: string;
  endsLabel: string;
  pendingCancelLabel: string;
  monthlySuffix: string;
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
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {labels.freeBody}
        </p>
        <Link href="/for-businesses" style={primaryButtonStyle()}>
          {labels.subscribeCta}
        </Link>
      </section>
    );
  }

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

      <dl style={{ margin: "12px 0 20px", display: "grid", gap: 8 }}>
        <Row label={labels.planLabel} value={labels.smbPlanName} />
        {amount ? (
          <Row
            label={""}
            value={
              <span>
                <span style={{ fontSize: 22, fontWeight: 600 }}>{amount}</span>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--color-text-2)",
                    marginLeft: 4,
                  }}
                >
                  {labels.monthlySuffix}
                </span>
              </span>
            }
          />
        ) : null}
        {statusLabel ? (
          <Row
            label={""}
            value={<StatusPill status={plan.status} label={statusLabel} />}
          />
        ) : null}
        {renewLine ? <Row label={""} value={renewLine} /> : null}
        {plan.cancelAtPeriodEnd ? (
          <Row label={""} value={labels.pendingCancelLabel} />
        ) : null}
      </dl>

      <form action={openBillingPortal}>
        <input type="hidden" name="returnUrl" value={returnUrl} />
        <button type="submit" style={primaryButtonStyle()}>
          {labels.manageCta}
        </button>
      </form>
    </section>
  );
}

function Row({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        fontSize: 14,
      }}
    >
      {label ? (
        <dt
          style={{
            margin: 0,
            color: "var(--color-text-3)",
            minWidth: 90,
            fontSize: 13,
          }}
        >
          {label}
        </dt>
      ) : null}
      <dd
        style={{
          margin: 0,
          color: "var(--color-text)",
        }}
      >
        {value}
      </dd>
    </div>
  );
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
        padding: "2px 10px",
        borderRadius: 999,
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
  colAmount: string;
  colStatus: string;
  colDownload: string;
  downloadAction: string;
  downloadAriaLabel: string;
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
      <div style={{ marginTop: 16, overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-3)" }}>
              <th scope="col" style={thStyle()}>
                {labels.colDate}
              </th>
              <th scope="col" style={thStyle()}>
                {labels.colAmount}
              </th>
              <th scope="col" style={thStyle()}>
                {labels.colStatus}
              </th>
              <th scope="col" style={thStyle()}>
                <span className="sr-only">{labels.colDownload}</span>
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
            margin: "12px 0 0",
            color: "var(--color-text-3)",
            fontSize: 13,
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
  const ariaLabel = labels.downloadAriaLabel.replace("{date}", date);

  return (
    <tr style={{ borderTop: "1px solid var(--color-border)" }}>
      <td style={tdStyle()}>{date}</td>
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
              color: "var(--color-coral)",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            {labels.downloadAction}
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
    padding: "22px 22px 24px",
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 14,
    marginBottom: 20,
  };
}

function cardTitleStyle(): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: "var(--font-serif)",
    fontSize: 19,
    letterSpacing: "-0.01em",
    color: "var(--color-text)",
  };
}

function primaryButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    padding: "0 18px",
    background: "var(--color-coral)",
    color: "#fff",
    border: "1px solid var(--color-coral)",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 500,
    textDecoration: "none",
    cursor: "pointer",
  };
}

function thStyle(): React.CSSProperties {
  return {
    padding: "8px 12px 8px 0",
    fontSize: 12,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
}

function tdStyle(): React.CSSProperties {
  return {
    padding: "10px 12px 10px 0",
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

/**
 * Map next-intl locale keys ("en", "es", "en-CA", "fr") to BCP-47 tags
 * Intl APIs accept ("en-US", "es-US", "en-CA", "fr-CA").
 */
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

/**
 * Build the absolute returnUrl the Stripe portal will redirect back to.
 * Mirrors checkout.ts allow-list (must match `NEXT_PUBLIC_APP_URL` host
 * or a vercel.app preview).
 */
function absoluteReturnUrl(locale: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // Locale prefix handling — next-intl `as-needed`, so "en" has no prefix.
  const prefix = locale === "en" ? "" : `/${locale}`;
  return `${base}${prefix}/settings/billing`;
}
