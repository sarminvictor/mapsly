/**
 * SMB search visibility · `/(smb)/search` (locale-prefixed variants
 * e.g. `/es/visibilidad`, `/fr/visibilite` declared in
 * `i18n/routing.ts`).
 *
 * Audience: Maria (single-business owner). Per
 * `.claude/rules/ui-ux-smb.md` and `.claude/rules/copy-voice.md`:
 *
 *   - Page opens with a one-line narrative ("you're in the top 3 for X
 *     and missing N customers/mo across the rest"). Plain English, no
 *     "3-pack" / "SERP" / "MSI".
 *   - State bar (4 cells) + Rank bars + "Customers you miss" tile + a
 *     top-5 keywords card ("where the demand is") + competitor
 *     leaderboard. The full 200-keyword list lives in a `<details>`
 *     disclosure at the bottom.
 *   - Right rail (desktop) carries the three quick wins so the analytic
 *     left column doesn't fight the action column. On mobile the rail
 *     stacks below the main column via `.smb-search-grid` CSS.
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — default export is SYNC. Async body (auth + cached
 *     query) lives inside a Suspense boundary so the route prerenders
 *     a shell under `experimental.cacheComponents: true`.
 *   - **Pattern 1** — `getSmbSearchData()` has the NEXT_PHASE build-
 *     guard returning EMPTY_SMB_SEARCH so Vercel's build worker can
 *     prerender without opening a Neon WebSocket.
 *   - **Pattern 4b** — label builders RESOLVE every string on the
 *     server and pass plain strings into the components. The single
 *     `'use client'` component (KeywordFinder) takes plain string +
 *     option-list props · no functions cross the boundary.
 *   - **Pattern 5** — no `export const dynamic = 'force-dynamic'`.
 *
 * Auth: page is authenticated. Anonymous visitors get
 * `unauthorized()` → `/signin`. Users with no claimed business get
 * the same onboarding empty state as the dashboard.
 *
 * KPITile is REUSED from `@/modules/smb-home/components` — do not
 * redefine.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { requirePortal } from "@/lib/portal-guard";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  CompetitorLeaderboardCard,
  KeywordVisibilityTable,
  RankBreakdownCard,
  SearchStateBar,
} from "@/modules/smb-search/components";
import type {
  CompetitorLeaderboardCardLabels,
  KeywordVisibilityTableLabels,
  RankBreakdownCardLabels,
  SearchStateBarLabels,
} from "@/modules/smb-search/components";
import { industryForCategory } from "@/modules/local-intent/category-to-industry";
import { SmbPageHeader } from "@/components/smb/SmbPageHeader";
import { getSmbSearchData } from "@/modules/smb-search/queries";
import { getCellKeywordTable } from "@/modules/smb-search/cell-keyword-table";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "smb.search.meta",
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
 * itself does ZERO async work — Vercel's build worker prerenders this
 * tree without touching DB or auth. Per cache-components Pattern 2.
 */
export default function SmbSearchPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchBody params={params} />
    </Suspense>
  );
}

/**
 * Skeleton · matches the resolved page heights to avoid CLS once the
 * Suspense'd body resolves. Honors `prefers-reduced-motion` (no
 * shimmer animation — just static low-contrast blocks).
 */
function SearchSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <div
        style={{
          height: 28,
          width: 240,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 96,
              background: "var(--color-bg-2)",
              borderRadius: 12,
            }}
          />
        ))}
      </div>
      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 0,
          margin: 0,
          listStyle: "none",
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            style={{
              height: 60,
              background: "var(--color-bg-2)",
              borderRadius: 12,
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Type-erased translator pulled from `getTranslations("smb.search")`.
 * Inline string-replace pattern matches the components — see
 * `SearchStateBar.tsx`, `RankBreakdownCard.tsx`,
 * `CompetitorLeaderboardCard.tsx`, `TopKeywordsCard.tsx`.
 *
 * Per cache-components Pattern 4b · these label builders RESOLVE every
 * string on the server and pass plain strings into the components. No
 * function props cross the `'use client'` boundary.
 */
type SmbSearchTranslator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

function buildStateBarLabels(t: SmbSearchTranslator): SearchStateBarLabels {
  return {
    totalSearches: t("state_total_searches"),
    estimatedVisits: t("state_estimated_visits"),
    trafficValue: t("state_traffic_value"),
    topThreeSearch: t("state_top_three_search"),
    missedCustomers: t("state_missed_customers"),
    topThreeMaps: t("state_top_three_maps"),
    topThreeSublabel: t("state_top_three_sublabel", { total: "{total}" }),
    topThreeMapsSublabel: t("state_top_three_maps_sublabel", {
      total: "{total}",
    }),
    missedCustomersSublabel: t("state_missed_customers_sublabel"),
    trafficValueSublabel: t("state_traffic_value_sublabel"),
    topThreeMapsNotScannedSublabel: t(
      "state_top_three_maps_not_scanned_sublabel",
    ),
    totalSearchesTip: t("state_total_searches_tip"),
    estimatedVisitsTip: t("state_estimated_visits_tip"),
    trafficValueTip: t("state_traffic_value_tip"),
    missedCustomersTip: t("state_missed_customers_tip"),
    topThreeSearchTip: t("state_top_three_search_tip"),
    topThreeMapsTip: t("state_top_three_maps_tip"),
  };
}

function buildRankBreakdownLabels(
  t: SmbSearchTranslator,
): RankBreakdownCardLabels {
  return {
    heading: t("bucket_heading"),
    subtitle: t("bucket_subtitle"),
    top3: t("bucket_top3"),
    top10: t("bucket_top10"),
    below10: t("bucket_below10"),
    ctrFootnote: t("bucket_ctr_footnote"),
    rowTemplate: t("bucket_row_template", {
      count: "{count}",
      searches: "{searches}",
      visits: "{visits}",
    }),
    rowTemplateNoVisits: t("bucket_row_template_no_visits", {
      count: "{count}",
      searches: "{searches}",
    }),
    empty: t("bucket_empty"),
  };
}

function buildCompetitorLeaderboardLabels(
  t: SmbSearchTranslator,
): CompetitorLeaderboardCardLabels {
  return {
    heading: t("leaderboard_heading"),
    subtitleOwn: t("leaderboard_subtitle_own", {
      rank: "{rank}",
      total: "{total}",
      city: "{city}",
    }),
    subtitleNoOwn: t("leaderboard_subtitle_no_own", { city: "{city}" }),
    colRank: t("leaderboard_col_rank"),
    colName: t("leaderboard_col_name"),
    colTopThreeMaps: t("leaderboard_col_top_three_maps"),
    colTopThreeSearch: t("leaderboard_col_top_three_search"),
    colMonthlyVisitors: t("leaderboard_col_monthly_visitors"),
    colDomain: t("leaderboard_col_domain"),
    topThreeMapsHelp: t("leaderboard_top_three_maps_help"),
    topThreeSearchHelp: t("leaderboard_top_three_search_help"),
    monthlyVisitorsHelp: t("leaderboard_monthly_visitors_help"),
    noDomain: t("leaderboard_no_domain"),
    empty: t("leaderboard_empty"),
    columnsLegend: t("leaderboard_columns_legend"),
  };
}

function buildVisibilityTableLabels(
  t: SmbSearchTranslator,
  industryLabel: string,
  city: string,
): KeywordVisibilityTableLabels {
  return {
    heading: t("table_heading", { industry: industryLabel, city }),
    subtitle: t("table_subtitle", { total: "{total}" }),
    colKeyword: t("table_col_keyword"),
    colSearches: t("table_col_searches"),
    colMaps: t("table_col_maps"),
    colOrganic: t("table_col_organic"),
    serviceBadge: t("table_service_badge"),
    empty: t("table_empty"),
    emptyFiltered: t("table_empty_filtered"),
    legend: t("table_legend"),
    sortAriaTemplate: t("table_sort_aria", { column: "{column}" }),
    filterToggleOn: t("table_filter_on"),
    filterToggleOff: t("table_filter_off"),
    pageOfTotal: t("table_page_of_total", { page: "{page}", total: "{total}" }),
    prev: t("table_prev"),
    next: t("table_next"),
  };
}

/**
 * Async body · runs auth check + cached query inside the Suspense
 * boundary. Per cache-components Pattern 2.
 */
async function SearchBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    // Next 16 auth interrupt — bubbles to the closest unauthorized.tsx
    // (or framework default). Per `.claude/rules/security.md`.
    unauthorized();
  }

  // Cross-portal guard · agency members get bounced to /lists so the
  // SMB portal is reserved for Maria + non-agency users (ADMIN passes
  // through). Per `lib/portal-guard.ts`.
  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.search");
  const data = await getSmbSearchData(session.user.id);

  // No business yet — Maria's first visit. Show the same onboarding
  // empty state as the dashboard for voice consistency.
  if (data.ownedBusinessId === "") {
    return (
      <section
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "64px 20px",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 36px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--color-text)",
          }}
        >
          {t("empty_title")}
        </h1>
        <p
          style={{
            margin: "16px 0 0",
            color: "var(--color-text-2)",
            fontSize: 17,
            lineHeight: 1.5,
          }}
        >
          {t("empty_body")}
        </p>
      </section>
    );
  }

  // Industry recognition · drives whether we render the table at all.
  const industryRecognised = industryForCategory(data.category) !== null;

  // Cell-keyword-table data · server fetches ALL cell keywords with
  // Maria's ranks (capped 500). The KeywordVisibilityTable client
  // component holds sort/filter/page state locally for smooth UX
  // (no page reload + scroll-to-top on filter/sort/page change).
  const tableData = industryRecognised
    ? await getCellKeywordTable({
        ownBusinessId: data.ownedBusinessId,
        city: data.city,
        country: data.country,
      })
    : null;
  const tableIndustryLabel = tableData?.industryLabel ?? data.category ?? "";

  return (
    <section
      aria-labelledby="search-heading"
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <SmbPageHeader
        userId={session.user.id}
        namespace="smb.search"
        titleId="search-heading"
        subtitleParams={{ city: data.city ?? "" }}
      />

      {/* Two-column layout · left = analytics, right = quick wins rail.
          Mirrors the reviews-page layout for voice consistency. The
          `.smb-search-grid` class collapses to one column < 720px via
          `app/globals.css`. */}
      <div
        className="smb-search-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 24,
          alignItems: "start",
        }}
      >
        <main>
          {/* State bar · 6-cell 2×3 grid. Row 1 the funnel (demand →
              visits → value), row 2 the scoreboard (organic wins →
              misses → maps wins). S.6.2: replaced single-rank "Best in
              Maps" cell with count-based "Top 3 in Maps". */}
          <SearchStateBar
            totalSearchVolume={data.totalSearchVolume}
            totalEstimatedVisits={data.totalEstimatedVisits}
            totalEstTrafficUsd={data.totalEstTrafficUsd}
            topThreeSearchCount={data.topThreeSearchCount}
            topThreeMapsCount={data.topThreeMapsCount}
            tracked={data.keywordsTracked}
            mapsScanned={data.mapsScannedCount}
            missedCustomers={data.totalEstPatientsLost}
            hasMapsScans={data.mapsScanCount > 0}
            labels={buildStateBarLabels(t)}
          />

          {/* Rank breakdown bars · Top 3 / Top 4-10 / 11+. */}
          <RankBreakdownCard
            buckets={data.rankBuckets}
            labels={buildRankBreakdownLabels(t)}
          />

          {/* "How customers search for {industry} in {city}" · S.6.4
              cell-wide pool, all keywords any cell business has
              (capped 500). Sort/filter/page handled client-side for
              smooth UX (no router round-trip). Filter "show only
              where I rank" ON by default. */}
          {industryRecognised && tableData ? (
            <KeywordVisibilityTable
              rows={tableData.rows}
              labels={buildVisibilityTableLabels(
                t,
                tableIndustryLabel,
                data.city ?? "",
              )}
            />
          ) : null}

          {/* Competitor leaderboard · top 10 in cell + Maria's row ·
              renders "Customers/mo" instead of raw $ traffic value. */}
          <CompetitorLeaderboardCard
            rows={data.competitorLeaderboard}
            ownRank={data.competitorLeaderboardOwnRank}
            total={data.competitorLeaderboardTotal}
            city={data.city}
            labels={buildCompetitorLeaderboardLabels(t)}
          />

          {/* Empty state when local-intent set is empty (transition
              window after deploy before the cron has populated, or
              unknown industry). The table above also renders its own
              empty state · this is the page-level fallback for the
              "no business / no data at all" case. */}
          {data.allTrackedKeywords.length === 0 ? (
            <EmptyCard body={t("empty_no_keywords")} />
          ) : null}

          <p
            style={{
              margin: "16px 0 0",
              color: "var(--color-text-3)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
          >
            {t("footer_help")}
          </p>
        </main>

        {/* Right rail · three quick wins. Mirrors the reviews-page rail
            (rail_rating + rail_themes). Falls below `<main>` on mobile
            via `.smb-search-grid` CSS. */}
        <aside
          aria-label={t("quick_wins_heading")}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {data.topQuickWins.length > 0 ? (
            <>
              <h2
                style={{
                  margin: "0 0 6px",
                  fontFamily: "var(--font-serif)",
                  fontSize: 16,
                  letterSpacing: "-0.01em",
                  color: "var(--color-text)",
                }}
              >
                {t("quick_wins_heading")}
              </h2>
              {data.topQuickWins.map((win, idx) => {
                const stateText = t(
                  `quick_win_state_${win.stateKey}`,
                  win.stateParams,
                );
                const actionText = t(`quick_win_action_${win.actionKey}`);
                const impactText = t("quick_win_impact", {
                  count: win.estCustomersPerMo,
                });
                const chipLabel = t(`quick_win_chip_${win.surface}`);
                const chipBg =
                  win.surface === "maps"
                    ? "rgba(195, 85, 58, 0.10)"
                    : "rgba(59, 110, 196, 0.10)";
                const chipColor =
                  win.surface === "maps"
                    ? "var(--color-coral)"
                    : "var(--color-info, #3b6ec4)";
                return (
                  <article
                    key={win.id}
                    style={{
                      background: "var(--color-bg-2)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 14,
                      padding: "14px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: "var(--color-coral)",
                          fontWeight: 600,
                        }}
                      >
                        #{idx + 1} · {impactText}
                      </p>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: chipBg,
                          color: chipColor,
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {chipLabel}
                      </span>
                    </div>
                    <h3
                      style={{
                        margin: 0,
                        fontFamily: "var(--font-serif)",
                        fontSize: 16,
                        letterSpacing: "-0.01em",
                        lineHeight: 1.25,
                        color: "var(--color-text)",
                      }}
                    >
                      {win.keyword}
                    </h3>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "var(--color-text-2)",
                      }}
                    >
                      {stateText}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "var(--color-text)",
                        fontWeight: 500,
                      }}
                    >
                      {actionText}
                    </p>
                  </article>
                );
              })}
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

/**
 * Small reusable empty-state card so the page handler doesn't need to
 * pull in a richer alert-style block for one calm line of plain
 * English (mirrors the pattern in `/(smb)/competitors`).
 */
function EmptyCard({ body }: { body: string }) {
  return (
    <div
      style={{
        padding: "18px 20px",
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        color: "var(--color-text-2)",
        fontSize: 15,
        lineHeight: 1.5,
      }}
    >
      {body}
    </div>
  );
}
