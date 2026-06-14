/**
 * SMB weekly overview · `/(smb)/home` (locale variants e.g. `/es/inicio`,
 * `/fr/accueil` declared in `i18n/routing.ts`).
 *
 * Maria's single front door — consolidates what used to be the dashboard +
 * the separate "how you compare" page into one scannable surface:
 *
 *   1. Hero · Mapsly Score + market standing (rank + weekly movement)
 *   2. Section scores · 5 navigable pillar tiles (Reviews/Search/Ads/Website/Profile)
 *   3. Quick wins · the highest-leverage fixes across every section (right rail)
 *   4. Where you stand · interactive market competitor table (sort + paginate)
 *   5. This week · filterable "what changed" market-events feed
 *
 * Detail KPIs (reply rate, LCP, CPC, …) live on the section pages — this page
 * stays summary + comparison, never duplicating them.
 *
 * Per `.claude/rules/cache-components.md`: Pattern 2 (sync export + Suspense'd
 * async body) and Pattern 1 (the cached query NEXT_PHASE-guards to EMPTY).
 *
 * Per `.claude/rules/ui-ux-smb.md`: warm, plain English, mobile-first, the
 * fixes rail gives Maria one clear "what to do next".
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requirePortal } from "@/lib/portal-guard";
import {
  AlertCard,
  FixCard,
  KPITile,
  PillarTiles,
  MarketLeaderboardTable,
  MarketChangesFeed,
  type PillarTileData,
  type PillarTileTone,
  type MarketLeaderboardLabels,
  type MarketChangesFeedLabels,
} from "@/modules/smb-home/components";
import { SmbPageHeader } from "@/components/smb/SmbPageHeader";
import { getSmbHomeData } from "@/modules/smb-home/queries";
import { MAPSLY_SCORE_MAX } from "@/modules/scoring";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "smb.home.meta" });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

/** Sync shell + Suspense'd async body (cache-components Pattern 2). */
export default function SmbOverviewPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewBody params={params} />
    </Suspense>
  );
}

function OverviewSkeleton() {
  return (
    <section
      aria-hidden
      style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 20px 64px" }}
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
          height: 150,
          background: "var(--color-bg-2)",
          borderRadius: 16,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
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
      <div
        style={{
          height: 320,
          background: "var(--color-bg-2)",
          borderRadius: 14,
        }}
      />
    </section>
  );
}

async function OverviewBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.home");
  const data = await getSmbHomeData(session.user.id);

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

  // ── Hero · Mapsly Score + standing + weekly movement ──
  const hasScore = data.mapslyScore != null;
  const heroScoreText = hasScore ? data.mapslyScore!.toFixed(1) : "—";

  const standing =
    data.rank != null && data.total != null
      ? data.rank === 1
        ? t("standing_leader")
        : t("standing_rank", { rank: data.rank, total: data.total })
      : null;
  const deltaLine =
    data.rankDelta == null
      ? t("delta_new")
      : data.rankDelta > 0
        ? t("delta_up", { n: data.rankDelta })
        : data.rankDelta < 0
          ? t("delta_down", { n: Math.abs(data.rankDelta) })
          : t("delta_same");
  const heroSub =
    hasScore && standing ? `${standing} · ${deltaLine}` : t("standing_pending");

  // ── Section scores · 5 navigable pillar tiles ──
  const stateLabel = (s: number | null): string =>
    s == null
      ? t("pillar_state_unmeasured")
      : s >= 7
        ? t("pillar_state_strong")
        : s < 4
          ? t("pillar_state_weak")
          : t("pillar_state_ok");

  const adsTone: PillarTileTone =
    data.adsApplicable === false ? "warn" : pillarTone(data.ads);

  const pillarTiles: PillarTileData[] = [
    {
      id: "reputation",
      label: t("pillar_reputation"),
      href: "/reviews",
      score: data.reputation,
      tone: pillarTone(data.reputation),
      sublabel: stateLabel(data.reputation),
      openLabel: t("pillar_open", { label: t("pillar_reputation") }),
    },
    {
      id: "visibility",
      label: t("pillar_visibility"),
      href: "/search",
      score: data.visibility,
      tone: pillarTone(data.visibility),
      sublabel: stateLabel(data.visibility),
      openLabel: t("pillar_open", { label: t("pillar_visibility") }),
    },
    {
      id: "advertising",
      label: t("pillar_advertising"),
      href: "/ads",
      score: data.ads,
      tone: adsTone,
      sublabel:
        data.adsApplicable === false
          ? t("pillar_ads_off")
          : stateLabel(data.ads),
      openLabel: t("pillar_open", { label: t("pillar_advertising") }),
    },
    {
      id: "website",
      label: t("pillar_website"),
      href: "/website",
      score: data.website,
      tone: pillarTone(data.website),
      sublabel: stateLabel(data.website),
      openLabel: t("pillar_open", { label: t("pillar_website") }),
    },
    {
      id: "profile",
      label: t("pillar_profile"),
      href: "/my-business",
      score: data.profile,
      tone: pillarTone(data.profile),
      sublabel: stateLabel(data.profile),
      openLabel: t("pillar_open", { label: t("pillar_profile") }),
    },
  ];

  const tableLabels: MarketLeaderboardLabels = {
    heading: t("table_heading"),
    subtitle: t("table_subtitle", {
      category: data.category || "—",
      city: data.city ?? "—",
    }),
    colRank: t("col_rank"),
    colDelta: t("col_delta"),
    colBusiness: t("col_business"),
    colMapsly: t("col_mapsly"),
    colReputation: t("col_reputation"),
    colVisibility: t("col_visibility"),
    colAds: t("col_ads"),
    colWebsite: t("col_website"),
    colProfile: t("col_profile"),
    youBadge: t("you_badge"),
    deltaNew: t("delta_new_short"),
    deltaHelp: t("col_delta_help"),
    empty: t("table_empty"),
    // Templated strings filled client-side — pass the placeholder literal as
    // the ICU param so next-intl keeps "{column}"/"{page}"/"{total}" intact.
    sortAria: t("sort_aria", { column: "{column}" }),
    pageOfTotal: t("page_of_total", { page: "{page}", total: "{total}" }),
    prev: t("prev"),
    next: t("next"),
    notRanked: t("dash"),
  };

  const feedLabels: MarketChangesFeedLabels = {
    heading: t("feed_heading"),
    subtitle: t("feed_subtitle"),
    filterAllTypes: t("feed_all"),
    typeRating: t("feed_type_rating"),
    typeReviews: t("feed_type_reviews"),
    typeAds: t("feed_type_ads"),
    typeSearch: t("feed_type_search"),
    typePhotos: t("feed_type_photos"),
    typeWebsite: t("feed_type_website"),
    typeServices: t("feed_type_services"),
    scopeAll: t("feed_scope_all"),
    scopeMe: t("feed_scope_me"),
    companyAll: t("feed_company_all"),
    sortLabel: t("feed_sort_label"),
    sortRecent: t("feed_sort_recent"),
    sortType: t("feed_sort_type"),
    sortCompany: t("feed_sort_company"),
    empty: t("feed_empty"),
    // Relative time is computed client-side — keep the "{n}" placeholder.
    agoDays: t("ago_days", { n: "{n}" }),
    agoHours: t("ago_hours", { n: "{n}" }),
    agoNow: t("ago_now"),
    // Pagination · reuse the existing smb.home pager strings.
    pageOfTotal: t("page_of_total"),
    prev: t("prev"),
    next: t("next"),
  };

  return (
    <section
      aria-labelledby="overview-heading"
      style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 20px 64px" }}
    >
      <SmbPageHeader
        userId={session.user.id}
        namespace="smb.home"
        titleId="overview-heading"
      />

      {/* Hero · Mapsly Score + standing */}
      <div style={{ marginBottom: 24 }}>
        <KPITile
          variant="hero"
          label={t("score_label")}
          value={heroScoreText}
          unit={`/${MAPSLY_SCORE_MAX}`}
          tone={mapslyScoreTone(data.mapslyScore)}
          infoTip={t("score_tip")}
          valueAriaLabel={
            hasScore ? `${heroScoreText} out of ${MAPSLY_SCORE_MAX}` : undefined
          }
          sublabel={heroSub}
        />
      </div>

      {/* Section scores · pillar tiles */}
      <section aria-labelledby="pillars-heading" style={{ marginBottom: 28 }}>
        <h2 id="pillars-heading" style={sectionHeadingStyle}>
          {t("pillars_heading")}
        </h2>
        <PillarTiles tiles={pillarTiles} />
      </section>

      {/* Main (table + feed) · Rail (quick wins) */}
      <div className="smb-ov-grid">
        <div className="smb-ov-main">
          <MarketLeaderboardTable
            rows={data.competitors}
            labels={tableLabels}
          />
          <MarketChangesFeed events={data.events} labels={feedLabels} />
        </div>

        <aside className="smb-ov-rail" aria-labelledby="fixes-heading">
          <h2 id="fixes-heading" style={sectionHeadingStyle}>
            {t("fixes_heading")}
          </h2>
          {data.topFixes.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {data.topFixes.map((fix) => (
                <FixCard
                  key={fix.rank}
                  rank={fix.rank}
                  action={fix.action}
                  meta={fix.meta}
                  impact={fix.impact}
                  impactSub={fix.impactSub}
                  tone={fix.tone}
                />
              ))}
            </div>
          ) : (
            <AlertCard
              tone="good"
              icon={
                <span aria-hidden style={{ fontWeight: 700 }}>
                  ✓
                </span>
              }
              body={t("fixes_empty_body")}
              meta={t("fixes_empty_meta")}
            />
          )}
        </aside>
      </div>
    </section>
  );
}

const sectionHeadingStyle = {
  margin: "0 0 12px",
  fontFamily: "var(--font-serif)",
  fontSize: 18,
  letterSpacing: "-0.01em",
  color: "var(--color-text)",
} as const;

/** Hero score tone: green ≥7, gold 4–7, coral ≤4. */
function mapslyScoreTone(
  score: number | null,
): "neutral" | "good" | "warn" | "bad" | "coral" {
  if (score == null) return "neutral";
  if (score >= 7) return "good";
  if (score >= 4) return "warn";
  return "coral";
}

/** Pillar score (0–10) → tile tone. */
function pillarTone(score: number | null): PillarTileTone {
  if (score == null) return "neutral";
  if (score >= 7) return "good";
  if (score >= 4) return "warn";
  return "bad";
}
