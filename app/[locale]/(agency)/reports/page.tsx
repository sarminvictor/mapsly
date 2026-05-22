/**
 * Agency reports hub · `/(agency)/reports`.
 *
 * Tom's "every artefact I've ever generated for my agency" surface:
 * one-pagers (PDF), CSV list exports, and shareable HTML links. The
 * hub is read-only — generation entry points live on the prospect
 * detail and list detail pages.
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — default export is SYNC, async body lives in a
 *     Suspense boundary (auth + DB reads).
 *   - **Pattern 1** — `getAgencyReports` short-circuits to
 *     `EMPTY_AGENCY_REPORTS` for `NEXT_PHASE === 'phase-production-
 *     build'` + Prisma errors.
 *
 * Auth: page is authenticated. Anonymous → `unauthorized()`. User
 * with no `AgencyMember` row → redirect to `/dashboard` (SMB).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  CopyShareLinkButton,
  ReportsTable,
  getAgencyReports,
  type CopyShareLinkButtonLabels,
  type ReportRow,
  type ReportsTableLabels,
} from "@/modules/reports-hub";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "agency.reports.meta",
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

export default function AgencyReportsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <ReportsBody params={params} />
    </Suspense>
  );
}

function ReportsSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <div
        style={{
          height: 30,
          width: 200,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 360,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
        }}
      />
    </section>
  );
}

async function ReportsBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const data = await getAgencyReports(session.user.id);
  if (data.agencyId === "") {
    redirect({ href: "/dashboard", locale: locale as Locale });
  }

  const t = await getTranslations("agency.reports");

  // ─── locale-aware formatters ────────────────────────────────
  const intFmt = new Intl.NumberFormat(locale);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const formatCreated = (iso: string): string => formatRelativeTime(iso, rtf);

  // Expires can be: null ("—"), in the future ("expires in 3 days"),
  // or in the past ("expired"). We delegate to a top-level helper so
  // the React 19 compiler's "no impure call during render" lint rule
  // stays happy — `Date.now()` is fine OUTSIDE a closure but flagged
  // when it lives inline in the render body.
  const expiresNa = t("expires_na");
  const expiresExpired = t("expires_expired");
  const formatExpires = (iso: string | null): string =>
    formatExpiresStatic({ iso, rtf, expiresNa, expiresExpired });

  const shareBase = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://mapsly.ai"}/share/`;

  const copyLabels: CopyShareLinkButtonLabels = {
    copy: t("action_copy"),
    copied: t("action_copied"),
    failed: t("action_copy_failed"),
    ariaLabel: (shareId) => t("action_copy_aria", { id: shareId }),
  };

  const tableLabels: ReportsTableLabels = {
    caption: t("table_caption"),
    empty: {
      title: t("empty_title"),
      body: t("empty_body"),
    },
    cappedFooter: ({ shown, total }) => t("capped_footer", { shown, total }),
    colType: t("col_type"),
    colSubject: t("col_subject"),
    colCreated: t("col_created"),
    colExpires: t("col_expires"),
    colViews: t("col_views"),
    colAction: t("col_action"),
    typePill: {
      PDF_ONE_PAGER: t("type_pdf"),
      CSV_LIST: t("type_csv"),
      SHARE_LINK: t("type_share"),
    },
    formatExpires,
    formatCreated,
    formatInt: (n) => intFmt.format(n),
    formatSubject: (row) =>
      composeSubject(row, {
        forBusiness: (name) => t("subject_for_business", { name }),
        forList: (name) => t("subject_for_list", { name }),
        agencyLevel: t("subject_agency_level"),
      }),
    tableAria: t("table_aria"),
    actionOpen: t("action_open"),
    actionShare: t("action_share"),
    actionPending: t("action_pending"),
  };

  const linkForRow = (row: ReportRow): React.ReactNode => {
    if (row.status !== "READY") {
      return (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
          }}
        >
          {tableLabels.actionPending}
        </span>
      );
    }
    if (row.type === "SHARE_LINK" && row.publicShareId) {
      return (
        <CopyShareLinkButton
          url={`${shareBase}${row.publicShareId}`}
          shareId={row.publicShareId}
          labels={copyLabels}
        />
      );
    }
    if (row.storageUrl) {
      return (
        <a
          href={row.storageUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`reports-open-${row.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 12px",
            borderRadius: 6,
            background: "var(--color-agency-indigo)",
            color: "#fff",
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {tableLabels.actionOpen}
        </a>
      );
    }
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
        }}
      >
        {tableLabels.actionPending}
      </span>
    );
  };

  return (
    <section
      aria-labelledby="reports-heading"
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <div>
          <h1
            id="reports-heading"
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("title")}
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--color-text-2)",
            }}
          >
            {t("subtitle_with_agency", { agency: data.agencyName })}
          </p>
        </div>
        <Link
          href={{ pathname: "/lists" }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "10px 16px",
            borderRadius: 8,
            background: "var(--color-agency-indigo)",
            color: "#fff",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {t("generate_cta")}
        </Link>
      </header>

      <CountsRow
        counts={data.counts}
        labels={{
          onePager: t("counts_one_pager"),
          csv: t("counts_csv"),
          shareLink: t("counts_share_link"),
          total: t("counts_total"),
        }}
        formatInt={intFmt.format.bind(intFmt)}
      />

      <ReportsTable
        rows={data.reports}
        totalCount={data.counts.total}
        labels={tableLabels}
        linkForRow={linkForRow}
      />
    </section>
  );
}

/* ----------------------------------------------- counts row */

interface CountsRowProps {
  counts: { onePager: number; csv: number; shareLink: number; total: number };
  labels: {
    onePager: string;
    csv: string;
    shareLink: string;
    total: string;
  };
  formatInt: (n: number) => string;
}

function CountsRow({ counts, labels, formatInt }: CountsRowProps) {
  const tiles = [
    { id: "one-pager", label: labels.onePager, value: counts.onePager },
    { id: "csv", label: labels.csv, value: counts.csv },
    { id: "share", label: labels.shareLink, value: counts.shareLink },
    { id: "total", label: labels.total, value: counts.total },
  ];
  return (
    <section
      aria-label={labels.total}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 12,
        marginBottom: 22,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.id}
          data-testid={`reports-count-${t.id}`}
          style={{
            background: "var(--color-bg-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-3)",
            }}
          >
            {t.label}
          </span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              lineHeight: 1.1,
            }}
          >
            {formatInt(t.value)}
          </span>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------------------------- helpers */

function composeSubject(
  row: ReportRow,
  fmt: {
    forBusiness: (name: string) => string;
    forList: (name: string) => string;
    agencyLevel: string;
  },
): string {
  if (row.businessName) return fmt.forBusiness(row.businessName);
  if (row.listName) return fmt.forList(row.listName);
  return fmt.agencyLevel;
}

function formatExpiresStatic({
  iso,
  rtf,
  expiresNa,
  expiresExpired,
}: {
  iso: string | null;
  rtf: Intl.RelativeTimeFormat;
  expiresNa: string;
  expiresExpired: string;
}): string {
  if (!iso) return expiresNa;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return expiresExpired;
  return formatRelativeTime(iso, rtf);
}

function formatRelativeTime(iso: string, rtf: Intl.RelativeTimeFormat): string {
  const ms = Date.parse(iso) - Date.now();
  const absSec = Math.abs(ms) / 1000;
  if (absSec < 60) return rtf.format(0, "minute");
  if (absSec < 3600) return rtf.format(Math.round(ms / 60_000), "minute");
  if (absSec < 86_400) return rtf.format(Math.round(ms / 3_600_000), "hour");
  return rtf.format(Math.round(ms / 86_400_000), "day");
}
