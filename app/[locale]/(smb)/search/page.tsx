/**
 * SMB search visibility · `/(smb)/search` (locale-prefixed variants
 * e.g. `/es/visibilidad`, `/fr/visibilite` declared in
 * `i18n/routing.ts`).
 *
 * Audience: Maria (single-business owner). Per
 * `.claude/rules/ui-ux-smb.md` and `.claude/rules/copy-voice.md`:
 *
 *   - Hero KPIs in plain English. No "3-pack", no "SERP", no "MSI".
 *     "Best spot in maps" beats "Best local-pack rank".
 *   - Table shows where she shows up per keyword + last-week delta.
 *   - Empty state for users still being indexed.
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — default export is SYNC. Async body (auth + cached
 *     query) lives inside a Suspense boundary so the route prerenders
 *     a shell under `experimental.cacheComponents: true`.
 *   - **Pattern 1** — `getSmbSearchData()` has the NEXT_PHASE build-
 *     guard returning EMPTY_SMB_SEARCH so Vercel's build worker can
 *     prerender without opening a Neon WebSocket.
 *   - **Pattern 5** — no `export const dynamic = 'force-dynamic'`.
 *
 * Auth: page is authenticated. Anonymous visitors get
 * `unauthorized()` → `/signin`. Users with no claimed business get
 * the same onboarding empty state as the dashboard.
 *
 * Per `.claude/rules/i18n.md`:
 *
 *   - All copy in `messages/{locale}.json` under `smb.search.*`
 *   - en / es / fr-CA all populated; en-CA falls back to en
 *   - No `t.rich()` (Pattern 4 — would break server-component
 *     prerender). Plain `t(key)` only.
 *
 * KPITile is REUSED from `@/modules/smb-dashboard/components` — do not
 * redefine.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { KPITile } from "@/modules/smb-dashboard/components";
import { KeywordRow } from "@/modules/smb-search/components";
import type {
  DeltaDirection,
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
        maxWidth: 960,
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

  // Build a top headline string for the "best spot" KPI. We pick the
  // single keyword where Maria has the lowest local-pack rank and put
  // it in plain English — this beats showing a bare "1" / "2" / "3".
  const bestRow =
    data.bestLocalPackRank != null
      ? (data.keywords.find(
          (k) => k.localPackRank === data.bestLocalPackRank,
        ) ?? null)
      : null;

  const heroBestValue =
    data.bestLocalPackRank != null
      ? t("hero_best_value", { rank: data.bestLocalPackRank })
      : t("hero_best_value_empty");
  const heroBestSublabel = bestRow
    ? t("hero_best_sublabel", { keyword: bestRow.keyword })
    : t("hero_best_sublabel_empty");

  return (
    <section
      aria-labelledby="search-heading"
      style={{
        maxWidth: 960,
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

      {/* Hero · 4 plain-English KPIs */}
      <section
        aria-labelledby="kpis-heading"
        style={{
          marginBottom: 28,
        }}
      >
        <h2 id="kpis-heading" style={{ position: "absolute", left: -9999 }}>
          {t("kpis_heading")}
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <KPITile
            variant="standard"
            label={t("kpi_best")}
            value={heroBestValue}
            sublabel={heroBestSublabel}
            tone={data.bestLocalPackRank != null ? "good" : "neutral"}
            infoTip={t("kpi_best_help")}
          />
          <KPITile
            variant="standard"
            label={t("kpi_tracked")}
            value={data.keywordsTracked}
            sublabel={t("kpi_tracked_sublabel")}
            tone="neutral"
            infoTip={t("kpi_tracked_help")}
          />
          <KPITile
            variant="standard"
            label={t("kpi_in_local")}
            value={data.keywordsInLocalPack}
            sublabel={t("kpi_in_local_sublabel", {
              total: data.keywordsTracked,
            })}
            tone={data.keywordsInLocalPack > 0 ? "good" : "neutral"}
            infoTip={t("kpi_in_local_help")}
          />
          <KPITile
            variant="standard"
            label={t("kpi_improved")}
            value={data.keywordsImprovedThisWeek}
            sublabel={t("kpi_improved_sublabel")}
            trend={data.keywordsImprovedThisWeek > 0 ? "up" : "flat"}
            tone={data.keywordsImprovedThisWeek > 0 ? "good" : "neutral"}
            infoTip={t("kpi_improved_help")}
          />
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

      {data.topQuickWins.length > 0 ? (
        <section
          aria-labelledby="quick-wins-heading"
          style={{ marginBottom: 24 }}
        >
          <h2
            id="quick-wins-heading"
            style={{
              margin: "0 0 14px",
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("quick_wins_heading")}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {data.topQuickWins.map((win, idx) => (
              <article
                key={win.id}
                style={{
                  background: "var(--color-bg-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 14,
                  padding: "16px 18px",
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
                    fontSize: 17,
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
                    fontSize: 13.5,
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
          </div>
        </section>
      ) : null}

      {/* Keyword visibility list */}
      <section aria-labelledby="list-heading" style={{ marginBottom: 24 }}>
        <h2
          id="list-heading"
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {t("list_heading")}
        </h2>

        {data.keywords.length === 0 ? (
          <EmptyCard body={t("empty_no_keywords")} />
        ) : (
          <>
            {/* Visible column labels */}
            <div
              role="presentation"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "0 16px 8px",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--color-text-3)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{t("col_keyword")}</span>
              <span
                style={{
                  flexShrink: 0,
                  textAlign: "right",
                  minWidth: 0,
                }}
              >
                {t("col_status")}
              </span>
              <span style={{ width: 88, textAlign: "right", flexShrink: 0 }}>
                {t("col_delta")}
              </span>
              <span style={{ width: 72, textAlign: "right", flexShrink: 0 }}>
                {t("col_volume")}
              </span>
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
              {data.keywords.map((row) => {
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
          </>
        )}
      </section>

      <p
        style={{
          margin: 0,
          color: "var(--color-text-3)",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
        }}
      >
        {t("footer_help")}
      </p>
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
