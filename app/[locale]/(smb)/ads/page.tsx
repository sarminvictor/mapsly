/**
 * SMB ads · `/(smb)/ads` — "Ads in your area".
 *
 * Maria-facing market intelligence, rebuilt as a VISUAL SPLIT between two
 * fundamentally different stories (per ui-ux-smb · mirrors /search layout):
 *
 *   🔵 GOOGLE — "Showing up in Google search": KPI row → cost table (sortable)
 *      → "Where to start" (best openings) → market leaderboard → suggestions.
 *   🟣 META   — "Winning on Facebook & Instagram": status → who's advertising
 *      (table) → "What's working" (format / service / promos / platform focus,
 *      one analysis block).
 *
 * The page opens with a one-line SUMMARY HEADLINE so Maria grasps it in 3-5s.
 * A right rail carries "What to do this week" — the PERSONALIZED quick wins
 * (`data.quickWins`, already personalized by the query engine), collapsing
 * below the main column on mobile via `.smb-ads-grid`.
 *
 * Data: `getSmbAdsData()` reads only DB rows the weekly ads crons / admin "Run
 * Ads" trigger wrote (DataForSEO keyword costs + Google Transparency + our Meta
 * actor). No live API in the request path.
 *
 * cache-components:
 *   - Pattern 2 — default export is SYNC; the async body (auth + cached query)
 *     lives inside a Suspense boundary so the route prerenders a shell.
 *   - Pattern 1 — `getSmbAdsData()` has the NEXT_PHASE guard + EMPTY shape.
 *   - Pattern 4b — every label/plural/date is RESOLVED on the server and passed
 *     as a plain string. The only client component (KeywordCostTable) takes
 *     serializable rows + plain-string labels; no function crosses the boundary.
 *   - Pattern 5 — no `export const dynamic`.
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
  GoogleAdvertiserLeaderboard,
  GoogleStartCard,
  KeywordCostTable,
  MetaAdvertiserTable,
  MetaMarketAnalysis,
  type FormatMixView,
  type GoogleStartPick,
  type MetaAdvertiserRowView,
  type PlatformStatView,
  type PromoView,
  type ServiceMixView,
} from "@/modules/smb-ads/components";
import { SmbPageHeader } from "@/components/smb/SmbPageHeader";
import { getSmbAdsData } from "@/modules/smb-ads/queries";
import {
  competitionLabelFromBucket,
  platformLabel,
  type AdKeywordCost,
} from "@/modules/smb-ads/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "smb.ads.meta" });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

export default function SmbAdsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<AdsSkeleton />}>
      <AdsBody params={params} />
    </Suspense>
  );
}

function block(height: number, radius = 14): React.CSSProperties {
  return { height, background: "var(--color-bg-2)", borderRadius: radius };
}

function AdsSkeleton() {
  return (
    <section
      aria-hidden
      style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 64px" }}
    >
      <div style={{ ...block(28, 8), width: 260, marginBottom: 16 }} />
      <div style={{ ...block(20, 6), width: 420, marginBottom: 24 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={block(92)} />
        ))}
      </div>
      <div style={{ ...block(180), marginBottom: 16 }} />
      <div style={block(220)} />
    </section>
  );
}

function usd(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

function monthYear(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Type-erased translator · resolves every string server-side (Pattern 4b). */
type AdsTranslator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/** Build the "Where to start" picks · best opportunity + top cost rows,
 *  copy resolved server-side via the page translator (Pattern 4b). */
function buildStartPicks(
  t: AdsTranslator,
  bestOpportunity: AdKeywordCost | null,
  keywordCosts: readonly AdKeywordCost[],
): GoogleStartPick[] {
  // Top 3 distinct openings · best opportunity first (already sorted by the
  // query), de-duplicated by keyword.
  const ordered: AdKeywordCost[] = [];
  const seen = new Set<string>();
  const push = (r: AdKeywordCost | null) => {
    if (!r || seen.has(r.keyword)) return;
    seen.add(r.keyword);
    ordered.push(r);
  };
  push(bestOpportunity);
  for (const r of keywordCosts) {
    if (ordered.length >= 3) break;
    push(r);
  }

  const bestKeyword = bestOpportunity?.keyword ?? null;
  return ordered.slice(0, 3).map((r) => ({
    keyword: r.keyword,
    isBest: r.keyword === bestKeyword,
    line: t("g_start_pick_line", {
      cpc: usd(r.cpc),
      competition: competitionLabelFromBucket(r.competition) ?? "—",
      volume:
        r.searchVolume != null ? r.searchVolume.toLocaleString("en-US") : "—",
    }),
  }));
}

async function AdsBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
    return null;
  }

  const t = (await getTranslations("smb.ads")) as AdsTranslator;
  const data = await getSmbAdsData(session.user.id);

  // No business yet — Maria's first visit. Keep the existing onboarding copy.
  if (data.ownedBusinessId === "") {
    return (
      <section
        style={{ maxWidth: 720, margin: "0 auto", padding: "64px 20px" }}
      >
        <h1 style={headingStyle}>{t("empty_title")}</h1>
        <p style={leadStyle}>{t("empty_body")}</p>
      </section>
    );
  }

  const g = data.google;
  const m = data.meta;

  // ── summary headline · grasp the page in 3-5s ─────────────────────────────
  const summary = t("summary_headline", {
    googleOwn: g.ownAdCount,
    metaOwn: m.ownAdCount,
    advertiserCount: m.advertiserCount,
  });

  // ── GOOGLE labels ─────────────────────────────────────────────────────────
  const costLabels = {
    colService: t("g_cost_col_service"),
    colSearches: t("g_cost_col_searches"),
    colCpc: t("g_cost_col_cpc"),
    colCompetition: t("g_cost_col_competition"),
    bestBadge: t("g_cost_best_badge"),
    compLow: t("g_cost_comp_low"),
    compMedium: t("g_cost_comp_medium"),
    compHigh: t("g_cost_comp_high"),
    empty: t("g_cost_empty"),
    sortAriaTemplate: t("g_cost_sort_aria", { column: "{column}" }),
  };
  const startPicks = buildStartPicks(t, g.bestOpportunity, g.keywordCosts);
  const startLabels = {
    intro:
      g.ownAdCount === 0 ? t("g_start_intro_new") : t("g_start_intro_expand"),
    empty: t("g_start_empty"),
  };
  const leaderboardLabels = {
    ownRankLine: t("g_board_own_rank", { rank: "{rank}", total: "{total}" }),
    colRank: t("g_board_col_rank"),
    colBusiness: t("g_board_col_business"),
    colAdCount: t("g_board_col_ads"),
    colDomain: t("g_board_col_domain"),
    youBadge: t("g_board_you_badge"),
    noDomain: t("g_board_no_domain"),
    empty: t("g_board_empty"),
  };

  // ── META labels ───────────────────────────────────────────────────────────
  // Advertiser table rows · resolve plurals + platform labels + month-year
  // server-side so no function crosses the boundary (Pattern 4b).
  const metaAdvertiserRows: MetaAdvertiserRowView[] = m.advertisers.map(
    (a) => ({
      pageId: a.pageId,
      name: a.name,
      handle: a.handle,
      isOwn: a.isOwn,
      adCountText: t("m_table_ad_count", { count: a.adCount }),
      platforms: a.platforms,
      runningSinceText: monthYear(a.runningSince),
    }),
  );
  const metaTableLabels = {
    colBusiness: t("m_table_col_business"),
    colAds: t("m_table_col_ads"),
    colPlatforms: t("m_table_col_platforms"),
    colRunningSince: t("m_table_col_running_since"),
    youBadge: t("m_table_you_badge"),
    noDate: t("m_table_no_date"),
    empty: t("m_table_empty"),
  };

  // Market analysis · format mix + service mix + promos + platform focus.
  const formatMixViews: FormatMixView[] = m.formatMix.map((f) => ({
    label: f.format,
    pct: Math.round(f.share * 100),
  }));
  const serviceMixViews: ServiceMixView[] = m.serviceMix
    .slice(0, 8)
    .map((s) => ({
      service: s.service,
      adsText: t("m_table_ad_count", { count: s.ads }),
      pct: Math.round(s.share * 100),
      youOffer: s.youOffer,
    }));
  const promoViews: PromoView[] = m.promos.map((p) => ({
    text: p.price
      ? t("m_analysis_promo_priced", { offer: p.offer, price: p.price })
      : t("m_analysis_promo_plain", { offer: p.offer }),
    hasPrice: Boolean(p.price),
  }));
  // Platform spread → % bars (FB/IG highlighted as "core"). Replaces the prose.
  const CORE = new Set(["FACEBOOK", "INSTAGRAM"]);
  const platformStats: PlatformStatView[] = m.platformSpread.map((p) => ({
    label: platformLabel(p.platform),
    pct: Math.round(p.share * 100),
    core: CORE.has(p.platform.toUpperCase()),
  }));

  const analysisLabels = {
    formatHeading: t("m_analysis_format_heading"),
    serviceHeading: t("m_analysis_service_heading"),
    serviceColService: t("m_analysis_service_col_service"),
    serviceColAds: t("m_analysis_service_col_ads"),
    promoHeading: t("m_analysis_promo_heading"),
    platformHeading: t("m_analysis_platform_heading"),
    platformHint: t("m_analysis_platform_hint"),
    youOfferChip: t("m_analysis_you_offer_chip"),
    empty: t("m_analysis_empty"),
  };

  const metaOwnStatus =
    m.ownAdCount > 0
      ? t("m_status_running", {
          count: m.ownAdCount,
          platforms:
            m.ownPlatforms.length > 0
              ? m.ownPlatforms.map(platformLabel).join(" + ")
              : t("m_status_running_fallback_platforms"),
        })
      : t("m_status_none");

  // ── quick wins (sidebar · personalized by the query engine) ───────────────
  const quickWins = data.quickWins;

  return (
    <section
      aria-labelledby="ads-heading"
      style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 64px" }}
    >
      <SmbPageHeader
        userId={session.user.id}
        namespace="smb.ads"
        titleId="ads-heading"
      />

      {/* Summary banner · the one thing to grasp in 3-5s — who's advertising,
          on which networks, vs. you. Styled as its own block so it leads. */}
      <div
        style={{
          margin: "0 0 22px",
          padding: "16px 20px",
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderLeft: "4px solid var(--color-coral)",
          borderRadius: 12,
          fontSize: 17,
          lineHeight: 1.45,
          color: "var(--color-text)",
        }}
      >
        {summary}
      </div>

      {!data.hasData ? (
        <div style={calmCardStyle}>
          <h2 style={cardHeadingStyle}>{t("no_data_title")}</h2>
          <p style={cardBodyStyle}>{t("no_data_body")}</p>
        </div>
      ) : (
        <div
          className="smb-ads-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 300px",
            gap: 24,
            alignItems: "start",
          }}
        >
          <main>
            {/* ═══ 🔵 GOOGLE block ═══════════════════════════════════════ */}
            <NetworkBlock
              accent="var(--color-info)"
              tint="rgba(59, 110, 196, 0.06)"
              eyebrow={t("g_block_eyebrow")}
              heading={t("g_block_heading")}
              subtitle={t("g_block_subtitle")}
            >
              <SubSection title={t("g_cost_heading")}>
                <KeywordCostTable
                  rows={g.keywordCosts}
                  bestKeyword={g.bestOpportunity?.keyword ?? null}
                  labels={costLabels}
                />
              </SubSection>

              <SubSection title={t("g_start_heading")}>
                <GoogleStartCard picks={startPicks} labels={startLabels} />
              </SubSection>

              <SubSection title={t("g_board_heading")}>
                <GoogleAdvertiserLeaderboard
                  rows={g.topAdvertisers}
                  ownRank={g.ownRank}
                  total={g.advertiserCount}
                  labels={leaderboardLabels}
                />
              </SubSection>
            </NetworkBlock>

            {/* ═══ 🟣 META block ═════════════════════════════════════════ */}
            <NetworkBlock
              accent="#7a3ff5"
              tint="rgba(122, 63, 245, 0.06)"
              eyebrow={t("m_block_eyebrow")}
              heading={t("m_block_heading")}
              subtitle={t("m_block_subtitle")}
            >
              {/* Own status line */}
              <div
                style={{
                  background: "var(--color-bg-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 14,
                  padding: "16px 18px",
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 19,
                    fontWeight: 700,
                    color:
                      m.ownAdCount > 0
                        ? "var(--color-success, #2d8659)"
                        : "var(--color-text)",
                    letterSpacing: "-0.01em",
                    lineHeight: 1.2,
                  }}
                >
                  {metaOwnStatus}
                </div>
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13.5,
                    color: "var(--color-text-2)",
                    lineHeight: 1.45,
                  }}
                >
                  {m.advertiserCount > 0
                    ? t("m_status_rivals", { count: m.advertiserCount })
                    : t("m_status_rivals_none")}
                </p>
              </div>

              <SubSection title={t("m_table_heading")}>
                <MetaAdvertiserTable
                  rows={metaAdvertiserRows}
                  labels={metaTableLabels}
                />
              </SubSection>

              <SubSection title={t("m_analysis_heading")}>
                <MetaMarketAnalysis
                  formatMix={formatMixViews}
                  serviceMix={serviceMixViews}
                  promos={promoViews}
                  platformStats={platformStats}
                  labels={analysisLabels}
                />
              </SubSection>
            </NetworkBlock>

            <p style={footerStyle}>{t("footer_help")}</p>
          </main>

          {/* Right rail · "What to do this week" · personalized quick wins.
              Falls below <main> on mobile via `.smb-ads-grid` CSS. */}
          <aside
            aria-label={t("quick_wins_heading")}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {quickWins.length > 0 ? (
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
                {quickWins.map((win, idx) => {
                  const isGoogle = win.network === "google";
                  const chipLabel = isGoogle
                    ? t("quick_win_chip_google")
                    : t("quick_win_chip_meta");
                  const chipBg = isGoogle
                    ? "rgba(59, 110, 196, 0.10)"
                    : "rgba(122, 63, 245, 0.10)";
                  const chipColor = isGoogle ? "var(--color-info)" : "#7a3ff5";
                  return (
                    <article
                      key={`${win.key}-${idx}`}
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
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: "var(--color-text-3)",
                            fontWeight: 600,
                          }}
                        >
                          #{idx + 1}
                        </span>
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
                          fontSize: 15.5,
                          letterSpacing: "-0.01em",
                          lineHeight: 1.25,
                          color: "var(--color-text)",
                        }}
                      >
                        {t(`suggestion_${win.key}_title`, win.params)}
                      </h3>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: "var(--color-text-2)",
                        }}
                      >
                        {t(`suggestion_${win.key}_detail`, win.params)}
                      </p>
                    </article>
                  );
                })}
              </>
            ) : (
              <div style={calmCardStyle}>
                <p style={{ ...cardBodyStyle, margin: 0 }}>
                  {t("quick_wins_empty")}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

/**
 * Network block wrapper · gives each story (Google / Meta) a distinct accent
 * tint stripe so the two are unmistakably different surfaces.
 */
function NetworkBlock({
  accent,
  tint,
  eyebrow,
  heading,
  subtitle,
  children,
}: {
  accent: string;
  tint: string;
  eyebrow: string;
  heading: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginBottom: 32,
        border: "1px solid var(--color-border)",
        borderTop: `3px solid ${accent}`,
        borderRadius: 16,
        background: tint,
        padding: "22px 22px 24px",
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: accent,
            fontWeight: 700,
          }}
        >
          {eyebrow}
        </p>
        <h2
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(22px, 3vw, 26px)",
            letterSpacing: "-0.02em",
            color: "var(--color-text)",
            lineHeight: 1.15,
          }}
        >
          {heading}
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: "var(--color-text-2)",
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </p>
      </header>
      {children}
    </section>
  );
}

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h3
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 17,
          letterSpacing: "-0.01em",
          color: "var(--color-text)",
          margin: "0 0 10px",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

const headingStyle: React.CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontSize: "clamp(28px, 4vw, 36px)",
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
  margin: 0,
  color: "var(--color-text)",
};
const leadStyle: React.CSSProperties = {
  margin: "16px 0 0",
  color: "var(--color-text-2)",
  fontSize: 17,
  lineHeight: 1.5,
};
const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-3)",
};
const calmCardStyle: React.CSSProperties = {
  padding: "22px 24px",
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 16,
  marginBottom: 24,
};
const cardHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-serif)",
  fontSize: 20,
  letterSpacing: "-0.01em",
  color: "var(--color-text)",
};
const cardBodyStyle: React.CSSProperties = {
  margin: "10px 0 0",
  color: "var(--color-text-2)",
  fontSize: 15,
  lineHeight: 1.5,
};
const footerStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--color-text-3)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
};
