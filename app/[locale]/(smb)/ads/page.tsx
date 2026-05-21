/**
 * SMB ads · `/(smb)/ads` (locale-prefixed variants e.g. `/es/anuncios`,
 * `/fr/publicites` declared in `i18n/routing.ts`).
 *
 * Audience: Maria (single-business owner). Per
 * `.claude/rules/ui-ux-smb.md`:
 *
 *   - Header: "Ads running in your category" — plain English, no
 *     "Meta Ad Library", no "creative units"
 *   - Two KPI tiles: active ads counted + ads off your services
 *   - 14-lane grid keyed on the matched keyword; off-service lanes
 *     get a coral border + explicit chip text
 *   - Onboarding empty state when no business linked
 *   - Calm "no ads spotted" state when business is linked but ads
 *     aren't surfaced yet
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — default export is SYNC. Async body lives inside a
 *     Suspense boundary so the route shell prerenders under
 *     `experimental.cacheComponents: true`.
 *   - **Pattern 1** — the cached `getSmbAdsData()` has the NEXT_PHASE
 *     build-guard returning EMPTY so Vercel's build worker can
 *     prerender without opening a Neon WebSocket (INC-27).
 *
 * Auth: page is authenticated. Anonymous visitors get
 * `unauthorized()` → `/signin`. Users with no claimed business get the
 * onboarding empty state.
 *
 * Per `.claude/rules/copy-voice.md`:
 *
 *   - "Ads running in your category" beats "Ad creative inventory"
 *   - "Ads off your services" beats "Off-keyword ad units"
 *
 * Per `.claude/rules/i18n.md`:
 *
 *   - All copy in `messages/{locale}.json` under `smb.ads.*`
 *   - en baseline ships now; es / fr-CA / en-CA follow in the next
 *     i18n task per the rule's English-first workflow
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { AlertCard, KPITile } from "@/modules/smb-dashboard/components";
import { AdLane, ParadoxAlert } from "@/modules/smb-ads/components";
import { getSmbAdsData } from "@/modules/smb-ads/queries";
import { MAX_LANES, detectParadoxTier } from "@/modules/smb-ads/types";

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

/**
 * Skeleton · matches the resolved page heights to avoid CLS once the
 * Suspense'd body resolves. Static low-contrast blocks; no shimmer.
 */
function AdsSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <div
        style={{
          height: 28,
          width: 260,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            height: 100,
            background: "var(--color-bg-2)",
            borderRadius: 14,
          }}
        />
        <div
          style={{
            height: 100,
            background: "var(--color-bg-2)",
            borderRadius: 14,
          }}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 220,
              background: "var(--color-bg-2)",
              borderRadius: 14,
            }}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Async body · runs auth check + cached query inside the Suspense
 * boundary.
 */
async function AdsBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const t = await getTranslations("smb.ads");
  const data = await getSmbAdsData(session.user.id);

  // No business linked yet — Maria's first visit. Warm onboarding voice
  // mirroring the dashboard / competitors empty states.
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

  const laneLabels = {
    offKeywordChip: t("lane_off_keyword_chip"),
    offKeywordAria: t("lane_off_keyword_aria"),
    unmatchedLabel: t("lane_unmatched_label"),
    adsCount: (n: number) => t("lane_ads_count", { count: n }),
    noCreative: t("lane_no_creative"),
    platformMeta: t("lane_platform_meta"),
    platformGoogle: t("lane_platform_google"),
    linkAria: t("lane_external_link_aria"),
    moreCount: (n: number) => t("lane_more_count", { count: n }),
    statusOpen: t("lane_status_open"),
    statusYouAbsent: t("lane_status_you_absent"),
    statusPresent: t("lane_status_present"),
    statusCrowded: t("lane_status_crowded"),
    competitorsLine: (count: number, names: string[]): string => {
      if (count === 0) return t("lane_competitors_none");
      if (names.length === 0)
        return t("lane_competitors_count_only", { count });
      const joined = names.join(", ");
      return count > names.length
        ? t("lane_competitors_more", {
            names: joined,
            extra: count - names.length,
          })
        : t("lane_competitors_named", { names: joined });
    },
    yourAdTag: t("lane_your_ad_tag"),
  };

  const hasLanes = data.lanes.length > 0;
  const showOffKeywordAlert = data.offKeywordCount > 5;
  const paradoxTier = detectParadoxTier({
    totalActiveAds: data.totalActiveAds,
    lanesCovered: data.lanesCovered,
    totalLanes: Math.max(data.lanes.length, Math.min(MAX_LANES, 14)),
  });

  // Friendly warning-bell icon (inline SVG) reused for the AlertCard.
  // 14px, currentColor — AlertCard skin tints it via its tone chip.
  const warnIcon = (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );

  return (
    <section
      aria-labelledby="ads-heading"
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "32px 20px 64px",
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
          id="ads-heading"
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
            fontSize: 14,
          }}
        >
          {t("subtitle_with_business", { name: data.name })}
        </p>
      </header>

      {/* KPI strip · 4 tiles · auto-fit so mobile stacks 2x2 and desktop
          shows the row. Maria's surfaces stay calm even at 4 KPIs —
          each one carries an info-tip in plain English. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <KPITile
          label={t("kpi_active")}
          value={data.totalActiveAds}
          infoTip={t("kpi_active_help")}
        />
        <KPITile
          label={t("kpi_lanes_covered")}
          value={`${data.lanesCovered} / ${data.lanes.length}`}
          tone={
            data.lanesCovered === 0 && data.totalActiveAds > 0
              ? "warn"
              : "neutral"
          }
          infoTip={t("kpi_lanes_covered_help")}
        />
        <KPITile
          label={t("kpi_open_lanes")}
          value={data.openLanes}
          tone={data.openLanes > 0 ? "good" : "neutral"}
          infoTip={t("kpi_open_lanes_help")}
        />
        <KPITile
          label={t("kpi_competitor_count")}
          value={data.competitorCount}
          infoTip={t("kpi_competitor_count_help")}
        />
      </div>

      {paradoxTier ? (
        <ParadoxAlert
          tier={paradoxTier}
          labels={{
            eyebrow:
              paradoxTier === "high"
                ? t("paradox_eyebrow_high")
                : t("paradox_eyebrow_medium"),
            headline: t("paradox_headline", {
              totalActiveAds: data.totalActiveAds,
              lanesCovered: data.lanesCovered,
              totalLanes: Math.max(data.lanes.length, 1),
            }),
            body: t("paradox_body"),
            cta: t("paradox_cta"),
          }}
        />
      ) : null}

      {showOffKeywordAlert ? (
        <div style={{ marginBottom: 24 }}>
          <AlertCard
            tone="warn"
            icon={warnIcon}
            body={t("alert_many_off_keyword")}
            meta={t("alert_many_off_keyword_meta", {
              count: data.offKeywordCount,
            })}
          />
        </div>
      ) : null}

      {hasLanes ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {data.lanes.map((lane) => (
            <AdLane
              key={lane.keyword}
              keyword={lane.keyword}
              ads={lane.ads}
              isOffKeyword={lane.isOffKeyword}
              status={lane.status}
              competitorCount={lane.competitorCount}
              topCompetitors={lane.topCompetitors}
              labels={laneLabels}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: "22px 24px",
            background: "var(--color-bg-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            marginBottom: 24,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: 20,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("no_ads_title")}
          </h2>
          <p
            style={{
              margin: "10px 0 0",
              color: "var(--color-text-2)",
              fontSize: 15,
              lineHeight: 1.5,
            }}
          >
            {t("no_ads_body")}
          </p>
        </div>
      )}

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
