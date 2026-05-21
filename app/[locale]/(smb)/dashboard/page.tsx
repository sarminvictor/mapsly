/**
 * SMB dashboard · `/(smb)/dashboard` (locale-prefixed variants e.g.
 * `/es/panel`, `/fr/tableau` already declared in `i18n/routing.ts`).
 *
 * Audience: Maria (the single-business owner). Per
 * `.claude/rules/ui-ux-smb.md`:
 *
 *   - Hero KPI (Mapsly Score 0-10) above the fold
 *   - 5 supporting KPI tiles (rating, reviews, reply rate, market rank,
 *     velocity) — all in plain English, no jargon, info-tips for nuance
 *   - Score breakdown across the 6 sub-dimensions
 *   - Single CTA per screen (top 3 fixes is the next iteration — kept
 *     scaffolded out here so subsequent tasks can layer it in cleanly)
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — the default export is SYNC. Async body (auth +
 *     cached query) lives inside a Suspense boundary. This is what lets
 *     the route prerender a shell under `experimental.cacheComponents:
 *     true`.
 *   - **Pattern 1** — the cached `getSmbDashboardData()` has the
 *     NEXT_PHASE build-guard returning EMPTY so Vercel's build worker
 *     can prerender without opening a Neon WebSocket.
 *   - **Pattern 5** — no `export const dynamic = 'force-dynamic'`. The
 *     Suspense wrap is the canonical "this route reads request data"
 *     signal.
 *
 * Auth: the page is authenticated. Anonymous visitors get redirected to
 * `/signin` via `unauthorized()` (Next 16 auth interrupts). Users with no
 * claimed business get the onboarding empty state (Maria's first visit).
 *
 * Per `.claude/rules/copy-voice.md`:
 *
 *   - Warm, plain English. "Your spa this week" beats "Your performance
 *     dashboard".
 *   - Numbers, not jargon. Info-tips explain anything that needs it.
 *   - One primary action per screen.
 *
 * Per `.claude/rules/i18n.md`:
 *
 *   - No hardcoded English. All copy in `messages/en.json` under
 *     `smb.dashboard.*`. ES + FR follow as separate i18n tasks
 *     (see PLAN.md tag `i18n`).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import {
  AlertCard,
  KPITile,
  ScoreBreakdown,
  type ScoreDimension,
} from "@/modules/smb-dashboard/components";
import { getSmbDashboardData } from "@/modules/smb-dashboard/queries";
import { MAPSLY_SCORE_MAX } from "@/modules/scoring";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "smb.dashboard.meta" });
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
export default function SmbDashboardPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardBody params={params} />
    </Suspense>
  );
}

/**
 * Skeleton · matches the resolved dashboard heights to avoid CLS once
 * the Suspense'd body resolves. Honors `prefers-reduced-motion` (no
 * shimmer / pulse animation — just static low-contrast blocks).
 */
function DashboardSkeleton() {
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
          width: 220,
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
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
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
    </section>
  );
}

/**
 * Async body · runs auth check + cached query inside the Suspense
 * boundary. The page-level outer export stays sync so cacheComponents
 * doesn't trip on the auth await.
 */
async function DashboardBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    // Next 16 auth interrupt — bubbles to the closest unauthorized.tsx
    // (or framework default). Per `.claude/rules/security.md`.
    unauthorized();
  }

  const t = await getTranslations("smb.dashboard");
  const data = await getSmbDashboardData(session.user.id);

  // No business yet — Maria's first visit. Show onboarding-style empty
  // state with a single CTA. Per `.claude/rules/ui-ux-smb.md` "empty
  // states explain why + what to do".
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

  // Has a business — render the full dashboard.
  const hasScore = data.mapslyScore != null;
  const scoreText = hasScore ? data.mapslyScore!.toFixed(1) : "—";
  const replyRateText =
    data.replyRate != null ? `${Math.round(data.replyRate * 100)}%` : "—";
  const rankText =
    data.msiRank != null && data.msiTotal != null
      ? `${data.msiRank}/${data.msiTotal}`
      : "—";

  // 6-dim score breakdown. Sub-scores arrive as 0–1 floats; the
  // ScoreBreakdown component normalizes against `max` so we pass each
  // value * 100 against max=100 for a familiar 0-100 surface.
  const dimensions: ScoreDimension[] = [
    {
      id: "reputation",
      name: t("dim_reputation"),
      value: pctOrZero(data.reputationScore),
      infoTip: t("dim_reputation_tip"),
    },
    {
      id: "communication",
      name: t("dim_communication"),
      value: pctOrZero(data.communicationScore),
      infoTip: t("dim_communication_tip"),
    },
    {
      id: "profileCompleteness",
      name: t("dim_profile"),
      value: pctOrZero(data.profileCompletenessScore),
      infoTip: t("dim_profile_tip"),
    },
    {
      id: "trust",
      name: t("dim_trust"),
      value: pctOrZero(data.trustScore),
      infoTip: t("dim_trust_tip"),
    },
    {
      id: "pricingTransparency",
      name: t("dim_pricing"),
      value: pctOrZero(data.pricingTransparencyScore),
      infoTip: t("dim_pricing_tip"),
    },
    {
      id: "brandPresence",
      name: t("dim_brand"),
      value: pctOrZero(data.brandPresenceScore),
      infoTip: t("dim_brand_tip"),
    },
  ];

  return (
    <section
      aria-labelledby="dashboard-heading"
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
          id="dashboard-heading"
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
            {data.category}
            {data.city ? ` · ${data.city}` : ""}
            {data.province ? `, ${data.province}` : ""}
          </p>
        ) : null}
      </header>

      {/* Hero KPI · Mapsly Score */}
      <div style={{ marginBottom: 24 }}>
        <KPITile
          variant="hero"
          label={t("kpi_mapsly_score_label")}
          value={scoreText}
          unit={`/${MAPSLY_SCORE_MAX}`}
          tone={mapslyScoreTone(data.mapslyScore)}
          infoTip={t("kpi_mapsly_score_tip")}
          valueAriaLabel={
            hasScore ? `${scoreText} out of ${MAPSLY_SCORE_MAX}` : undefined
          }
          sublabel={hasScore ? null : t("kpi_no_data_sublabel")}
        />
      </div>

      {/* 5 supporting KPI tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <KPITile
          label={t("kpi_rating_label")}
          value={data.rating != null ? data.rating.toFixed(1) : "—"}
          unit="/5"
          infoTip={t("kpi_rating_tip")}
        />
        <KPITile
          label={t("kpi_reviews_label")}
          value={data.reviewCount ?? "—"}
          infoTip={t("kpi_reviews_tip")}
        />
        <KPITile
          label={t("kpi_reply_rate_label")}
          value={replyRateText}
          tone={replyRateTone(data.replyRate)}
          infoTip={t("kpi_reply_rate_tip")}
        />
        <KPITile
          label={t("kpi_rank_label")}
          value={rankText}
          infoTip={t("kpi_rank_tip")}
        />
        <KPITile
          label={t("kpi_velocity_label")}
          value={data.velocityLast30d ?? "—"}
          infoTip={t("kpi_velocity_tip")}
          sublabel={t("kpi_velocity_sublabel")}
        />
      </div>

      {/* Score breakdown · 6 sub-dimensions */}
      <section
        aria-labelledby="score-breakdown-heading"
        style={{
          padding: "20px 22px",
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 24,
        }}
      >
        <h2
          id="score-breakdown-heading"
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {t("breakdown_heading")}
        </h2>
        <ScoreBreakdown
          dimensions={dimensions}
          caption={hasScore ? null : t("breakdown_no_data_caption")}
        />
      </section>

      {/* Top fixes placeholder — wired in a follow-up phase (6.1).
          Keeps the section in document order so screen-readers see the
          intended structure even before the data flows. */}
      <section aria-labelledby="fixes-heading" style={{ marginBottom: 24 }}>
        <h2
          id="fixes-heading"
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {t("fixes_heading")}
        </h2>
        <AlertCard
          tone="info"
          icon={<span aria-hidden>i</span>}
          body={t("fixes_empty_body")}
          meta={t("fixes_empty_meta")}
        />
      </section>
    </section>
  );
}

/** 0–1 sub-score → 0–100 integer for the ScoreBreakdown bar. */
function pctOrZero(v: number | null): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v * 100)));
}

/** Hero score tone: green ≥7, gold 4-7, coral ≤4. Matches palette tokens. */
function mapslyScoreTone(
  score: number | null,
): "neutral" | "good" | "warn" | "bad" | "coral" {
  if (score == null) return "neutral";
  if (score >= 7) return "good";
  if (score >= 4) return "warn";
  return "coral";
}

/** Reply rate tone: green ≥0.6, gold 0.25-0.6, red <0.25. Matches the
 * "Most spas reply to 89%" benchmark from copy-voice examples. */
function replyRateTone(
  rate: number | null,
): "neutral" | "good" | "warn" | "bad" {
  if (rate == null) return "neutral";
  if (rate >= 0.6) return "good";
  if (rate >= 0.25) return "warn";
  return "bad";
}
