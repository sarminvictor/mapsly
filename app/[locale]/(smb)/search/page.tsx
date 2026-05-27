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
import { ServiceContextChipForCurrentUser } from "@/components/smb/ServiceContextChipForCurrentUser";
import { KPITile } from "@/modules/smb-home/components";
import {
  CompetitorLeaderboardCard,
  KeywordFinder,
  KeywordRow,
  RankBreakdownCard,
  SearchNarrative,
  SearchStateBar,
  TopKeywordsCard,
} from "@/modules/smb-search/components";
import type {
  CompetitorLeaderboardCardLabels,
  DeltaDirection,
  KeywordFinderLabels,
  RankBreakdownCardLabels,
  SearchStateBarLabels,
  TopKeywordsCardLabels,
  VisibilityStatus,
} from "@/modules/smb-search/components";
import { getSmbSearchData } from "@/modules/smb-search/queries";
import type { KeywordRow as KeywordRowData } from "@/modules/smb-search/types";

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

/** DOM id for the expandable "all tracked keywords" disclosure. The
 *  KeywordFinder client component opens this and scrolls into it on
 *  selection. */
const ALL_KEYWORDS_DETAILS_ID = "smb-search-all-keywords";
/** Per-row DOM id prefix · `${PREFIX}${keyword.id}` selects one row. */
const ALL_KEYWORDS_ROW_PREFIX = "smb-search-row-";

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
 * Bucket a keyword row's latest ranks into a Maria-readable status.
 * Pure function — server-component-safe.
 */
function bucketStatus(row: KeywordRowData): VisibilityStatus {
  if (row.localPackRank != null) return "in_local_pack";
  if (row.organicRank != null && row.organicRank <= 10) return "top_organic";
  if (row.organicRank != null) return "ranking_organic";
  return "not_ranked";
}

/**
 * Compare a row's latest rank vs previous-week rank and return a
 * direction. Uses local-pack first (Maria's headline metric); falls
 * back to organic. Returns `null` when neither pair has both sides.
 */
function deriveDelta(row: KeywordRowData): DeltaDirection | null {
  // Local-pack takes precedence — that's what Maria sees first.
  if (row.prevLocalPackRank != null && row.localPackRank != null) {
    if (row.localPackRank < row.prevLocalPackRank) return "improved";
    if (row.localPackRank > row.prevLocalPackRank) return "slipped";
    return "flat";
  }
  if (row.prevLocalPackRank == null && row.localPackRank != null) {
    return "new";
  }
  if (row.prevOrganicRank != null && row.organicRank != null) {
    if (row.organicRank < row.prevOrganicRank) return "improved";
    if (row.organicRank > row.prevOrganicRank) return "slipped";
    return "flat";
  }
  if (row.prevOrganicRank == null && row.organicRank != null) {
    return "new";
  }
  return null;
}

/**
 * Format a search-volume integer as "2.4K", "12K", "950", or "—".
 * Locale-aware separators are NOT applied here — the rendered string
 * is short and uses an ASCII suffix the page wraps in i18n "/mo".
 */
function formatVolume(volume: number | null): string {
  if (volume == null || volume <= 0) return "—";
  if (volume >= 1000) {
    return (volume / 1000).toFixed(volume >= 10_000 ? 0 : 1) + "K";
  }
  return String(volume);
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
    inTopThree: t("state_in_top_three"),
    bestSpot: t("state_best_spot"),
    inTopThreeSublabel: t("state_in_top_three_sublabel", { total: "{total}" }),
    bestSpotSublabel: t("state_best_spot_sublabel", { keyword: "{keyword}" }),
    bestSpotNoneSublabel: t("state_best_spot_none_sublabel"),
    bestSpotNoneValue: t("state_best_spot_none_value"),
    totalSearchesTip: t("state_total_searches_tip"),
    estimatedVisitsTip: t("state_estimated_visits_tip"),
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
    colKeywords: t("leaderboard_col_keywords"),
    colTopThree: t("leaderboard_col_top_three"),
    colCustomers: t("leaderboard_col_customers"),
    topThreeHelp: t("leaderboard_top_three_help"),
    customersHelp: t("leaderboard_customers_help"),
    empty: t("leaderboard_empty"),
  };
}

function buildTopKeywordsLabels(
  t: SmbSearchTranslator,
  trackedTotal: number,
): TopKeywordsCardLabels {
  return {
    heading: t("top_heading"),
    subtitle: t("top_subtitle", { total: trackedTotal }),
    volumeTemplate: t("top_volume_template", { value: "{value}" }),
    mapsLabel: t("top_maps_label"),
    organicLabel: t("top_organic_label"),
    rankTemplate: t("top_rank_template", { rank: "{rank}" }),
    notRanked: t("top_not_ranked"),
    topThreeInMapsLabel: t("top_top_three_in_maps_label"),
    emptySlot: t("top_empty_slot"),
    missedTemplate: t("top_missed_template", { count: "{count}" }),
    inTopThree: t("top_in_top_three"),
    empty: t("top_empty"),
  };
}

function buildKeywordFinderLabels(t: SmbSearchTranslator): KeywordFinderLabels {
  return {
    placeholder: t("finder_placeholder"),
    ariaLabel: t("finder_aria_label"),
    expandAll: t("finder_expand_all"),
  };
}

/**
 * Pick the narrative sentence for the top of the page. The choice is
 * deterministic — there are only three real cases (in the pack / not in
 * the pack / no data yet) and Maria sees the same line every time her
 * underlying numbers stay flat. Pure · server-component-safe.
 */
function buildNarrative(
  t: SmbSearchTranslator,
  data: {
    keywordsInLocalPack: number;
    keywordsTracked: number;
    totalEstPatientsLost: number;
  },
): string {
  if (data.keywordsTracked === 0) {
    return t("narrative_no_data");
  }
  if (data.keywordsInLocalPack === 0) {
    return t("narrative_no_top_three", {
      tracked: data.keywordsTracked,
      missed: data.totalEstPatientsLost,
    });
  }
  return t("narrative_full", {
    topThree: data.keywordsInLocalPack,
    missed: data.totalEstPatientsLost,
  });
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

  // Pick the single keyword behind Maria's best Maps rank · feeds the
  // State Bar's 4th cell sublabel ("for 'med spa miami'").
  const bestMapsRow =
    data.bestLocalPackRank != null
      ? (data.allTrackedKeywords.find(
          (k) => k.localPackRank === data.bestLocalPackRank,
        ) ?? null)
      : null;

  const topThreeKeywords =
    data.rankBuckets.find((b) => b.key === "top_3")?.keywordCount ?? 0;

  const narrative = buildNarrative(t, {
    keywordsInLocalPack: data.keywordsInLocalPack,
    keywordsTracked: data.keywordsTracked,
    totalEstPatientsLost: data.totalEstPatientsLost,
  });

  const finderOptions = data.allTrackedKeywords.map((k) => ({
    id: k.id,
    keyword: k.keyword,
  }));

  return (
    <section
      aria-labelledby="search-heading"
      style={{
        maxWidth: 1080,
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
          id="search-heading"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 36px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: "6px 0 0",
            color: "var(--color-text)",
          }}
        >
          {t("title", { name: data.name })}
        </h1>
        {data.city ? (
          <p
            style={{
              margin: "8px 0 0",
              color: "var(--color-text-2)",
              fontSize: 14,
            }}
          >
            {t("subtitle", { city: data.city })}
          </p>
        ) : null}
      </header>

      {/* Service-context chip · "Reading this for: Botox · …" deep-links
          to /my-business so Maria can refine the keyword-match lens. */}
      <div style={{ marginBottom: 20 }}>
        <Suspense fallback={null}>
          <ServiceContextChipForCurrentUser />
        </Suspense>
      </div>

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
          {/* One-line narrative · the story before the numbers. */}
          <SearchNarrative sentence={narrative} />

          {/* State bar · 4 headline numbers · "Best in Maps" replaces
              the old "Keywords tracked" cell · sublabel uses the
              keyword behind Maria's best rank. */}
          <SearchStateBar
            totalSearchVolume={data.totalSearchVolume}
            totalEstimatedVisits={data.totalEstimatedVisits}
            topThreeKeywords={topThreeKeywords}
            tracked={data.keywordsTracked}
            bestMapsRank={data.bestLocalPackRank}
            bestMapsKeyword={bestMapsRow?.keyword ?? null}
            labels={buildStateBarLabels(t)}
          />

          {/* Rank breakdown bars · Top 3 / Top 4-10 / 11+. */}
          <RankBreakdownCard
            buckets={data.rankBuckets}
            labels={buildRankBreakdownLabels(t)}
          />

          {/* "Customers we estimate you miss" tile · single high-impact
              KPI · the others moved into the StateBar. */}
          <section
            aria-labelledby="missed-kpi-heading"
            style={{ marginBottom: 24 }}
          >
            <h2
              id="missed-kpi-heading"
              style={{ position: "absolute", left: -9999 }}
            >
              {t("kpis_heading")}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 12,
              }}
            >
              <KPITile
                variant="standard"
                label={t("kpi_patients_lost")}
                value={data.totalEstPatientsLost}
                sublabel={t("kpi_patients_lost_sublabel")}
                tone={data.totalEstPatientsLost > 0 ? "warn" : "good"}
                infoTip={t("kpi_patients_lost_help")}
              />
            </div>
          </section>

          {/* Top 5 keywords by volume · the heart of the rebuild · each
              row shows Maria's Maps + organic position and the top 3
              businesses in Maps. */}
          {data.topByVolume.length > 0 ? (
            <TopKeywordsCard
              rows={data.topByVolume}
              labels={buildTopKeywordsLabels(t, data.keywordsTracked)}
            />
          ) : null}

          {/* Competitor leaderboard · top 10 in cell + Maria's row · now
              renders "Customers/mo" instead of raw $ traffic value. */}
          <CompetitorLeaderboardCard
            rows={data.competitorLeaderboard}
            ownRank={data.competitorLeaderboardOwnRank}
            total={data.competitorLeaderboardTotal}
            city={data.city}
            labels={buildCompetitorLeaderboardLabels(t)}
          />

          {/* Find + expandable full list · KeywordFinder (client) wires
              the search-with-autosuggest, the `<details>` below it
              renders all tracked keywords (collapsed by default). */}
          {data.allTrackedKeywords.length > 0 ? (
            <section style={{ marginBottom: 16 }}>
              <KeywordFinder
                options={finderOptions}
                detailsId={ALL_KEYWORDS_DETAILS_ID}
                rowIdPrefix={ALL_KEYWORDS_ROW_PREFIX}
                labels={buildKeywordFinderLabels(t)}
              />
              <details
                id={ALL_KEYWORDS_DETAILS_ID}
                style={{
                  background: "var(--color-bg-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  padding: "12px 16px",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--color-text-2)",
                    fontWeight: 600,
                    listStyle: "revert",
                  }}
                >
                  {t("all_keywords_disclosure_summary", {
                    count: data.allTrackedKeywords.length,
                  })}
                </summary>
                <ul
                  aria-label={t("all_keywords_aria_label")}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: 0,
                    margin: "14px 0 0",
                    listStyle: "none",
                  }}
                >
                  {data.allTrackedKeywords.map((row) => {
                    const status = bucketStatus(row);
                    const delta = deriveDelta(row);
                    const statusText = t(`status_${status}`);
                    let deltaText: string;
                    if (delta === "improved") {
                      deltaText = t("delta_improved");
                    } else if (delta === "slipped") {
                      deltaText = t("delta_slipped");
                    } else if (delta === "flat") {
                      deltaText = t("delta_flat");
                    } else if (delta === "new") {
                      deltaText = t("delta_new");
                    } else {
                      deltaText = t("delta_none");
                    }
                    const volumeFormatted = formatVolume(row.searchVolume);
                    const searchVolumeText =
                      row.searchVolume != null && row.searchVolume > 0
                        ? t("volume_with_unit", { value: volumeFormatted })
                        : volumeFormatted;
                    const searchVolumeAriaLabel =
                      row.searchVolume != null && row.searchVolume > 0
                        ? t("volume_aria", { value: row.searchVolume })
                        : t("volume_aria_empty");
                    const estLostText =
                      row.estPatientsLost > 0
                        ? t("est_lost_per_keyword", {
                            count: row.estPatientsLost,
                          })
                        : "";
                    return (
                      <KeywordRow
                        key={row.id}
                        rowId={`${ALL_KEYWORDS_ROW_PREFIX}${row.id}`}
                        keyword={row.keyword}
                        statusText={statusText}
                        status={status}
                        delta={delta}
                        deltaText={deltaText}
                        searchVolumeText={searchVolumeText}
                        searchVolumeAriaLabel={searchVolumeAriaLabel}
                        packSlots={row.packSlots}
                        packLabel={t("pack_label")}
                        estPatientsLostText={estLostText}
                      />
                    );
                  })}
                </ul>
              </details>
            </section>
          ) : (
            <EmptyCard body={t("empty_no_keywords")} />
          )}

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
              {data.topQuickWins.map((win, idx) => (
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
                    #{idx + 1} · {win.impact}
                  </p>
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
                    {win.currentState}
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
                    {win.action}
                  </p>
                </article>
              ))}
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
