/**
 * SMB reviews · `/(smb)/reviews` (locale-prefixed variants e.g.
 * `/es/resenas`, `/fr/avis` declared in `i18n/routing.ts`).
 *
 * Audience: Maria (single-business owner). Per
 * `.claude/rules/ui-ux-smb.md`:
 *
 *   - Tabs at top: Unanswered (default) / Negative / Replied
 *   - Per-review card: stars, date, text, urgency pill, AI reply draft
 *     (Generate + Regenerate functional; Post-to-Google + Edit stay
 *     disabled until G.5 GBP integration is in place)
 *   - Right rail: rating distribution + top themes (reply-tone settings
 *     ship with E.6 settings page)
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — default export is SYNC. Async body (auth + params
 *     + cached query) lives inside a Suspense boundary. This is what
 *     lets the route prerender a shell under
 *     `experimental.cacheComponents: true`.
 *   - **Pattern 1** — the cached `getSmbReviewsData()` has the
 *     NEXT_PHASE build-guard returning EMPTY so Vercel's build worker
 *     can prerender without opening a Neon WebSocket.
 *   - **Pattern 3** — `searchParams` Promise is unwrapped INSIDE the
 *     inner Suspense'd body, not on the boundary. This avoids the
 *     `Functions cannot be passed directly to Client Components`
 *     error that bites when a Promise crosses the boundary as a prop.
 *
 * Auth: page is authenticated. Anonymous users hit `unauthorized()` →
 * `/signin`. Users with no claimed business get the same onboarding
 * empty state as the dashboard (consistent voice across the portal).
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
  CompetitorBenchmarkCard,
  MentionedNamesCard,
  PaginatedReviewList,
  PrivacySummaryCard,
  RatingDistributionCard,
  ReviewTabs,
  ReviewTrendCard,
  ServiceMentionsCard,
  ThemesCard,
  type CompetitorBenchmarkLabels,
  type MentionedNamesCardLabels,
  type ReviewCardLabels,
  type ReviewTabsLabels,
  type ReviewTrendCardLabels,
  type RatingDistributionCardLabels,
  type ServiceMentionsCardLabels,
  type ThemesCardLabels,
} from "@/modules/smb-reviews/components";
import { SmbPageHeader } from "@/components/smb/SmbPageHeader";
import { isHumanMedicalCategory } from "@/services/ai/medical-category";
import { getSmbReviewsData } from "@/modules/smb-reviews/queries";
import {
  DEFAULT_REVIEW_TAB,
  isPrivacyTabVisible,
  parseReviewTab,
  type ReviewTab,
} from "@/modules/smb-reviews/types";
import { getCompetitorRanking } from "@/modules/scoring/competitor-ranking";
import { getReviewTrends } from "@/modules/reviews/trends";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "smb.reviews.meta" });
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

interface PageSearch {
  tab?: string | string[];
}

/**
 * Sync shell — zero async work happens at this level so Vercel's build
 * worker prerenders without touching DB or auth. Per cache-components
 * Pattern 2 + Pattern 3 (searchParams unwrapped inside the boundary).
 */
export default function SmbReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearch>;
}) {
  return (
    <Suspense fallback={<ReviewsSkeleton />}>
      <ReviewsBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Skeleton matches the resolved body's rough heights so the
 * Suspense → resolved swap doesn't shift content (CLS budget).
 */
function ReviewsSkeleton() {
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
          width: 180,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          height: 44,
          background: "var(--color-bg-2)",
          borderRadius: 10,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 24,
        }}
      >
        <div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 160,
                background: "var(--color-bg-2)",
                borderRadius: 14,
                marginBottom: 14,
              }}
            />
          ))}
        </div>
        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              height: 240,
              background: "var(--color-bg-2)",
              borderRadius: 12,
            }}
          />
          <div
            style={{
              height: 200,
              background: "var(--color-bg-2)",
              borderRadius: 12,
            }}
          />
        </aside>
      </div>
    </section>
  );
}

/**
 * Async body — Suspense'd. Auth check + cached query happen here. The
 * `params` and `searchParams` Promises are awaited locally (not as
 * props crossing the boundary) per cache-components Pattern 3.
 */
async function ReviewsBody({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearch>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    // Bubbles to closest unauthorized.tsx (or framework default).
    unauthorized();
  }

  // Cross-portal guard · agency members get bounced to /lists so the
  // SMB portal is reserved for Maria + non-agency users (ADMIN passes
  // through). Per `lib/portal-guard.ts`.
  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const { tab: tabParam } = await searchParams;
  const tab = parseReviewTab(tabParam);

  const t = await getTranslations("smb.reviews");
  const data = await getSmbReviewsData(session.user.id, tab);

  // Maria has no business linked yet — show the same warm onboarding
  // copy as the dashboard so the portal feels consistent.
  if (data.ownedBusinessId === "") {
    return (
      <section
        style={{ maxWidth: 720, margin: "0 auto", padding: "64px 20px" }}
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

  const tabsLabels: ReviewTabsLabels = {
    unanswered: t("tab_unanswered_label"),
    negative: t("tab_negative"),
    replied: t("tab_replied"),
    skipped: t("tab_skipped"),
    privacy: t("tab_privacy"),
  };

  // S4 · Privacy tab visibility — human-medical businesses with ≥1
  // flagged published reply. Same gate as the per-reply hints and the
  // summary card; the count is always 0 for non-medical businesses but
  // the explicit category check keeps the rule readable + tested.
  const privacyTabVisible = isPrivacyTabVisible(
    data.businessCategory,
    data.privacyRiskCount,
  );

  // Templates with `{var}` placeholders use `t.raw()` so we get the raw
  // ICU string back. Downstream components do `.replace("{var}", value)`
  // for per-row interpolation. Using `t()` here would throw next-intl's
  // FORMATTING_ERROR because the vars aren't known until render time.
  const cardLabels: ReviewCardLabels = {
    statusUnanswered: t("status_unanswered"),
    statusReplied: t("status_replied"),
    urgent: t("pill_urgent"),
    sentimentNegative: t("sentiment_negative"),
    sentimentPositive: t("sentiment_positive"),
    sentimentNeutral: t("sentiment_neutral"),
    priorReviews: t.raw("prior_reviews") as string,
    aiDraftLabel: t("ai_draft_label"),
    ctaGenerate: t("ai_draft_generate"),
    ctaPost: t("ai_draft_post"),
    ctaSkip: t("ai_draft_skip"),
    ctaUnskip: t("ai_draft_unskip"),
    ctaSave: t("ai_draft_save"),
    ctaSaved: t("ai_draft_saved"),
    ctaEdit: t("ai_draft_edit"),
    ctaRegenerate: t("ai_draft_regenerate"),
    ctaComingSoon: t("ai_draft_coming_soon"),
    daysAgoLabel: t.raw("days_ago") as string,
    noText: t("no_text"),
    langEn: t("ai_draft_lang_en"),
    langEs: t("ai_draft_lang_es"),
    // "HIPAA-aware" badge + S2/S3 privacy-check labels · only for
    // human-medical businesses. Same matcher that flips the PHI
    // guardrail in services/ai/reply-draft.ts so the badge, the hints,
    // the pre-publish check, and the prompt behavior can never drift.
    ...(isHumanMedicalCategory(data.businessCategory)
      ? {
          hipaaBadge: t("ai_draft_hipaa_badge"),
          hipaaTooltip: t("ai_draft_hipaa_tooltip"),
          privacyHintHigh: t("privacy_hint_high"),
          privacyHintCaution: t("privacy_hint_caution"),
          privacyFixCta: t("privacy_fix_cta"),
          privacyConfirmTitle: t("privacy_confirm_title"),
          privacyConfirmEdit: t("privacy_confirm_edit"),
          privacyConfirmPost: t("privacy_confirm_post"),
        }
      : {}),
  };

  const ratingLabels: RatingDistributionCardLabels = {
    title: t("rail_rating_title"),
    subtitle: t.raw("rail_rating_subtitle") as string,
    empty: t("rail_rating_empty"),
    starRowLabel: t.raw("rail_star_row_label") as string,
  };

  const themesLabels: ThemesCardLabels = {
    title: t("rail_themes_title"),
    subtitle: t("rail_themes_subtitle"),
    empty: t("rail_themes_empty"),
    negativeSkew: t("rail_themes_negative_skew"),
  };

  const compareLabels: CompetitorBenchmarkLabels = {
    eyebrow: t("compare_eyebrow"),
    title: t("compare_title"),
    positionLine: t.raw("compare_position_line") as string,
    empty: t("compare_empty"),
    colRank: t("compare_col_rank"),
    colName: t("compare_col_name"),
    colScore: t("compare_col_score"),
    colRating: t("compare_col_rating"),
    colReviews: t("compare_col_reviews"),
    colNew30d: t("compare_col_new_30d"),
    colReplyRate: t("compare_col_reply_rate"),
    youLabel: t("compare_you_label"),
  };

  const trendLabels: ReviewTrendCardLabels = {
    eyebrow: t("compare_eyebrow"),
    title: t("trend_title"),
    rollingLine: t.raw("trend_rolling_line") as string,
    empty: t("trend_empty"),
    yAxisCount: t("trend_y_axis_count"),
    yAxisStars: t("trend_y_axis_stars"),
    lastUpdated: t.raw("trend_last_updated") as string,
  };

  const servicesLabels: ServiceMentionsCardLabels = {
    title: t("services_title"),
    subtitle: t("services_subtitle"),
    empty: t("services_empty"),
    countLabel: t.raw("services_count_label") as string,
    staleLabel: t("services_stale_label"),
    neverLabel: t("services_never_label"),
  };

  const namesLabels: MentionedNamesCardLabels = {
    title: t("names_title"),
    subtitle: t("names_subtitle"),
    empty: t("names_empty"),
    countLabel: t.raw("names_count_label") as string,
  };

  // R.5 + R.6 · competitor ranking + trend graph + service/name mentions.
  // Parallel-fetched so the cards stream together with the review list.
  const [ranking, trends] = await Promise.all([
    getCompetitorRanking(data.ownedBusinessId),
    getReviewTrends(data.ownedBusinessId),
  ]);

  return (
    <section
      aria-labelledby="reviews-heading"
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <SmbPageHeader
        userId={session.user.id}
        namespace="smb.reviews"
        titleId="reviews-heading"
        pillar="reputation"
      />

      {/* 5-KPI state bar · Maria's first glance · Reply rate ·
          Unanswered · Avg rating · Reviews 30d · Sentiment 7d. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <KpiCell
          label={t("kpi_reply_rate")}
          value={
            data.kpis.replyRate == null
              ? "—"
              : `${Math.round(data.kpis.replyRate * 100)}%`
          }
          tone={
            data.kpis.replyRate == null
              ? "neutral"
              : data.kpis.replyRate >= 0.6
                ? "good"
                : data.kpis.replyRate >= 0.25
                  ? "warn"
                  : "bad"
          }
        />
        <KpiCell
          label={t("kpi_unanswered")}
          value={data.kpis.unanswered}
          tone={
            data.kpis.unanswered === 0
              ? "good"
              : data.kpis.unanswered >= 5
                ? "bad"
                : "warn"
          }
        />
        <KpiCell
          label={t("kpi_avg_rating")}
          value={
            data.kpis.avgRating == null ? "—" : data.kpis.avgRating.toFixed(1)
          }
          suffix={data.kpis.avgRating == null ? "" : "/5"}
          tone={
            data.kpis.avgRating == null
              ? "neutral"
              : data.kpis.avgRating >= 4.5
                ? "good"
                : data.kpis.avgRating >= 4.0
                  ? "neutral"
                  : "warn"
          }
        />
        <KpiCell
          label={t("kpi_velocity_30d")}
          value={data.kpis.velocityLast30d}
        />
        <KpiCell
          label={t("kpi_sentiment_7d")}
          value={
            data.kpis.sentiment7d == null
              ? "—"
              : `${Math.round(data.kpis.sentiment7d * 100)}%`
          }
          tone={
            data.kpis.sentiment7d == null
              ? "neutral"
              : data.kpis.sentiment7d >= 0.7
                ? "good"
                : data.kpis.sentiment7d >= 0.4
                  ? "neutral"
                  : "warn"
          }
        />
      </div>

      {/* S2/S4/S5 · privacy-check summary — the SHORTCUT to the
          Privacy tab. Shown only on the default tab (the tab strip
          carries the count everywhere else) and only while the tab is
          visible. Same Link mechanism the tabs use (`?tab=privacy`).
          S5 swapped the hover-only title tooltip for a tap-friendly
          info-tip (phones never see `title`) — see PrivacySummaryCard. */}
      {privacyTabVisible && data.activeTab === DEFAULT_REVIEW_TAB ? (
        <PrivacySummaryCard
          labels={{
            summary: t("privacy_summary", { count: data.privacyRiskCount }),
            cta: t("privacy_summary_cta"),
            infoButton: t("privacy_summary_info_button"),
            infoNote: t("privacy_summary_info"),
          }}
        />
      ) : null}

      <ReviewTabs
        activeTab={data.activeTab}
        counts={data.tabCounts}
        labels={tabsLabels}
        privacyCount={privacyTabVisible ? data.privacyRiskCount : 0}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 24,
          alignItems: "start",
        }}
        className="smb-reviews-grid"
      >
        <main>
          {data.reviews.length === 0 ? (
            <EmptyTab tab={data.activeTab} t={t} />
          ) : (
            <PaginatedReviewList
              reviews={data.reviews}
              labels={cardLabels}
              googleReviewsUrl={data.googleReviewsUrl}
              activeTab={data.activeTab}
              showMoreLabel={t("show_more")}
              showingLabel={t.raw("showing_label") as string}
            />
          )}
        </main>

        <aside
          aria-label={t("rail_aside_label")}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {data.pattern ? (
            <article
              style={{
                background: "rgba(212,165,116,.16)",
                border: "1px solid var(--color-gold)",
                borderRadius: 14,
                padding: "14px 16px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--color-berry)",
                  fontWeight: 600,
                }}
              >
                {t("pattern_eyebrow")}
              </p>
              <h3
                style={{
                  margin: "6px 0 6px",
                  fontFamily: "var(--font-serif)",
                  fontSize: 16,
                  lineHeight: 1.25,
                  letterSpacing: "-0.01em",
                  color: "var(--color-text)",
                }}
              >
                {data.pattern.headline}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--color-text-2)",
                }}
              >
                {data.pattern.body}
              </p>
            </article>
          ) : null}
          <RatingDistributionCard
            distribution={data.ratingDistribution}
            labels={ratingLabels}
          />
          <ServiceMentionsCard
            services={trends.services}
            labels={servicesLabels}
          />
          <MentionedNamesCard people={trends.topPeople} labels={namesLabels} />
          <ThemesCard themes={data.topThemes} labels={themesLabels} />
        </aside>
      </div>

      {/* R.6 · Trend graph (full-width, compact). */}
      <div style={{ marginTop: 24 }}>
        <ReviewTrendCard data={trends} labels={trendLabels} />
      </div>

      {/* R.5 · How you compare · local market MSI ranking. */}
      <div style={{ marginTop: 16 }}>
        <CompetitorBenchmarkCard
          data={ranking}
          category={ranking.focalCategory}
          city={ranking.focalCity}
          labels={compareLabels}
        />
      </div>
    </section>
  );
}

/**
 * Tiny KPI cell used in the reviews state bar. Server-rendered, no
 * info-tip drawer — Maria's reviews surface stays calm; the tip
 * pattern from the dashboard lives one click away in the help drawer.
 */
function KpiCell({
  label,
  value,
  suffix,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneColor =
    tone === "good"
      ? "var(--color-success)"
      : tone === "warn"
        ? "var(--color-gold)"
        : tone === "bad"
          ? "var(--color-alert)"
          : "var(--color-text)";
  return (
    <div
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "10px 14px",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-3)",
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: "4px 0 0",
          fontFamily: "var(--font-serif)",
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: toneColor,
          lineHeight: 1.1,
        }}
      >
        {value}
        {suffix ? (
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-text-3)",
              marginLeft: 2,
            }}
          >
            {suffix}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Active-tab empty state. Each tab gets its own copy so Maria knows
 * exactly what's empty and why ("Great news — no unanswered reviews"
 * vs "No replied reviews yet").
 */
function EmptyTab({ tab, t }: { tab: ReviewTab; t: (key: string) => string }) {
  const titleKey = `empty_${tab}_title` as const;
  const bodyKey = `empty_${tab}_body` as const;
  return (
    <div
      style={{
        background: "var(--color-bg-2)",
        border: "1px dashed var(--color-border)",
        borderRadius: 14,
        padding: "32px 24px",
        textAlign: "center",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontSize: 18,
          color: "var(--color-text)",
        }}
      >
        {t(titleKey)}
      </h2>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 14,
          lineHeight: 1.5,
          color: "var(--color-text-2)",
        }}
      >
        {t(bodyKey)}
      </p>
    </div>
  );
}
