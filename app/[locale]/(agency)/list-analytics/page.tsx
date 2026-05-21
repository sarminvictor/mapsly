/**
 * Agency list-analytics · `/(agency)/list-analytics` (F.5).
 *
 * Audience: Tom (the 4-seat agency owner). Surface for cross-list
 * funnel review — "which lists are converting · where leads stall ·
 * which signals predict reply".
 *
 * Per `_design/agency/list-analytics.html` (when it lands) and
 * `.claude/rules/ui-ux-agency.md`:
 *
 *   - 4-stat header at top (90d surfaced · contact rate · reply rate
 *     · closed-won)
 *   - Per-list funnel table with mini-SVG funnel viz per row
 *   - Signal correlation panel (which signals predict reply) · STUB
 *     at F.5 awaiting D.x signal-engineering task
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** · the default export is SYNC. The async body
 *     (auth + cached query) lives inside a Suspense boundary so the
 *     route prerenders a shell under `experimental.cacheComponents:
 *     true`.
 *   - **Pattern 1** · `getListAnalyticsForAgency` short-circuits to
 *     `EMPTY_LIST_ANALYTICS` for `NEXT_PHASE === 'phase-production-
 *     build'` and Prisma errors (INC-27, INC-25).
 *   - **Pattern 3** · no `searchParams` at v1 · if added later (`?
 *     window=30d`), MUST be awaited INSIDE the Suspense'd inner
 *     component.
 *   - **Pattern 4** · no `t.rich()` render-props · all interpolation
 *     resolves to plain strings server-side (INC-26).
 *   - **Pattern 5** · no `export const dynamic` · Suspense wrap is
 *     the canonical "this route reads request data" signal.
 *
 * Auth: page is authenticated. Anonymous → `unauthorized()`.
 * Authenticated user with NO `AgencyMember` row → redirect to
 * `/dashboard` (the SMB surface) so SMB-only users don't see an
 * empty agency shell. Cross-agency leak is structurally impossible —
 * the query filters by the agencyId from the user's first
 * `AgencyMember` row.
 *
 * Per `.claude/rules/copy-voice.md` (Agency register):
 *
 *   - Tool-y, precise, jargon-OK · "Reply rate · last 90d"
 *   - Numbers over adjectives · "84 surfaced · 32% reply" not
 *     "we found tons of leads"
 *   - Sentence case throughout · no exclamation marks
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  ListFunnelTable,
  SignalCorrelationPanel,
  StatHeader,
  type ListFunnelTableLabels,
  type SignalCorrelationPanelLabels,
  type StatHeaderLabels,
} from "@/modules/list-analytics/components";
import { getListAnalyticsForAgency } from "@/modules/list-analytics/queries";
import type { ListFunnelRow } from "@/modules/list-analytics/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "agency.list_analytics.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    // Authenticated surface — keep out of search results.
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

/**
 * Default export · SYNC shell wrapping the async body in a Suspense
 * boundary so Vercel's build worker prerenders this tree without
 * touching DB or auth (cache-components Pattern 2).
 */
export default function AgencyListAnalyticsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<ListAnalyticsSkeleton />}>
      <ListAnalyticsBody params={params} />
    </Suspense>
  );
}

function ListAnalyticsSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <div
        style={{
          height: 30,
          width: 220,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 96,
              background: "var(--color-bg-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
            }}
          />
        ))}
      </div>
      <div
        style={{
          height: 320,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 200,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
        }}
      />
    </section>
  );
}

/* ----------------------------------------------------- async body */

async function ListAnalyticsBody({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const data = await getListAnalyticsForAgency(session.user.id);

  // Authenticated but no agency membership · bounce to the SMB
  // surface rather than rendering an empty agency shell. `redirect()`
  // throws so the rest of the body is unreachable for this branch.
  if (data.agencyId === "") {
    redirect({ href: "/dashboard", locale: locale as Locale });
  }

  const t = await getTranslations("agency.list_analytics");

  /* ---------- locale-aware number / percent formatters ---------- */
  // `Intl.NumberFormat` is locale-aware (per `.claude/rules/i18n.md`)
  // and stable across renders. Instantiated once per request.
  const intFmt = new Intl.NumberFormat(locale);
  const pctFmt = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const liftFmt = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const formatInt = (n: number) => intFmt.format(n);
  const formatPct = (rate: number) => pctFmt.format(rate);
  const formatLift = (lift: number) => `${liftFmt.format(lift)}×`;
  const formatN = (n: number) => `n=${intFmt.format(n)}`;

  /* ---------------------- label payloads ----------------------- */
  const statLabels: StatHeaderLabels = {
    surfacedTitle: t("stat_surfaced_90d"),
    surfacedHelp: t("stat_surfaced_90d_help"),
    contactRateTitle: t("stat_contact_rate"),
    contactRateHelp: t("stat_contact_rate_help"),
    replyRateTitle: t("stat_reply_rate"),
    replyRateHelp: t("stat_reply_rate_help"),
    closedWonTitle: t("stat_closed_won"),
    closedWonHelp: t("stat_closed_won_help"),
    formatPct,
    formatInt,
  };

  const tableLabels: ListFunnelTableLabels = {
    tableTitle: t("table_title"),
    tableAria: t("table_aria"),
    colList: t("table_col_list"),
    colNew: t("table_col_new"),
    colContacted: t("table_col_contacted"),
    colReplied: t("table_col_replied"),
    colWon: t("table_col_won"),
    colLost: t("table_col_lost"),
    colFunnel: t("table_col_funnel"),
    row: {
      formatInt,
      pausedPill: t("row_paused_pill"),
      funnelAria: ({
        listName,
        new: n,
        contacted,
        replied,
        won,
        lost,
      }) =>
        t("row_funnel_aria", {
          listName,
          new: formatInt(n),
          contacted: formatInt(contacted),
          replied: formatInt(replied),
          won: formatInt(won),
          lost: formatInt(lost),
        }),
      emptyRowHint: t("row_empty_hint"),
    },
    emptyTableTitle: t("table_empty_title"),
    emptyTableBody: t("table_empty_body"),
  };

  const correlationLabels: SignalCorrelationPanelLabels = {
    title: t("correlation_title"),
    subtitle: t("correlation_subtitle"),
    empty: t("correlation_empty"),
    formatLift,
    formatN,
  };

  /* ------------------ per-row Link constructor ----------------- */
  // The funnel table's row component is i18n-agnostic — the page
  // builds locale-aware `Link` nodes here so route translation
  // (`/lists/[id]` → `/es/listas/[id]` / `/fr/listes/[id]`) works.
  const linkForList = (row: ListFunnelRow) => (
    <Link
      href={{ pathname: "/lists/[id]", params: { id: row.listId } }}
      data-testid={`list-analytics-row-link-${row.listId}`}
      style={{
        color: "var(--color-text)",
        textDecoration: "none",
        fontWeight: 600,
      }}
    >
      {row.listName}
    </Link>
  );

  const totalLists = data.lists.length;
  const totalLeads = data.lists.reduce((s, l) => s + l.totalLeads, 0);
  const isEmpty = totalLists === 0 || totalLeads === 0;

  return (
    <section
      aria-labelledby="list-analytics-heading"
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <h1
          id="list-analytics-heading"
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
      </header>

      <StatHeader stats={data.stats} labels={statLabels} />

      {isEmpty ? (
        <EmptyStateLinked
          title={t("empty_state_title")}
          body={t("empty_state_body")}
          ctaLabel={t("empty_state_cta")}
        />
      ) : (
        <ListFunnelTable
          rows={data.lists}
          labels={tableLabels}
          linkForList={linkForList}
        />
      )}

      <SignalCorrelationPanel
        correlations={data.signalCorrelations}
        labels={correlationLabels}
      />
    </section>
  );
}

/**
 * Empty-state wrapper · uses the i18n-aware Link so the CTA route
 * resolves per locale. Defined inline (rather than passing a `ctaHref`
 * string) so we don't lose route translation per `.claude/rules/i18n.md`.
 */
function EmptyStateLinked({
  title,
  body,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaLabel: string;
}) {
  return (
    <section
      data-testid="list-analytics-empty-state"
      style={{
        background: "var(--color-bg-2)",
        border: "1px dashed var(--color-border)",
        borderRadius: 14,
        padding: "40px 24px",
        textAlign: "center",
        marginBottom: 22,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: "8px auto 18px",
          maxWidth: 520,
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--color-text-2)",
        }}
      >
        {body}
      </p>
      <Link
        href={{ pathname: "/search" }}
        data-testid="list-analytics-empty-cta"
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "10px 18px",
          borderRadius: 8,
          background: "var(--color-agency-indigo)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 13,
          textDecoration: "none",
        }}
      >
        {ctaLabel}
      </Link>
    </section>
  );
}
