/**
 * SMB home · `/(smb)/home` (locale-prefixed variants e.g.
 * `/es/inicio`, `/fr/accueil` declared in `i18n/routing.ts`).
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
 *   - **Pattern 1** — the cached `getSmbHomeData()` has the
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
 *     `smb.home.*`. ES + FR follow as separate i18n tasks
 *     (see PLAN.md tag `i18n`).
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
  ScoreBreakdown,
  type PillarTileData,
  type PillarTileTone,
  type ScoreDimension,
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

  // Cross-portal guard · agency members get bounced to /lists so the
  // SMB portal is reserved for Maria + non-agency users (ADMIN passes
  // through). Per `lib/portal-guard.ts`.
  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.home");
  const data = await getSmbHomeData(session.user.id);

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

  // ── Scoring v2 · prefer the consolidated pillar score + market standing when
  // present; fall back to the legacy mapslyScore + 6-dim breakdown until the
  // pillar-score pass has run. ──
  const hasPillars = data.pillarScore != null;
  const heroScoreNum = hasPillars ? data.pillarScore : data.mapslyScore;
  const heroScoreText = heroScoreNum != null ? heroScoreNum.toFixed(1) : "—";

  const rankLabel =
    data.msiRank != null && data.msiTotal != null
      ? t("standing_rank", { rank: data.msiRank, total: data.msiTotal })
      : null;
  const topLabel =
    data.msiPercentile != null
      ? data.msiRank === 1
        ? t("standing_leader")
        : t("standing_top", {
            pct: Math.max(1, 100 - Math.round(data.msiPercentile)),
          })
      : null;
  const standingLine = [rankLabel, topLabel].filter(Boolean).join(" · ");

  // Local closure → uses literal i18n keys (no dynamic key, no t-passing).
  const stateLabel = (tone: PillarTileTone): string =>
    tone === "good"
      ? t("pillar_state_strong")
      : tone === "bad"
        ? t("pillar_state_weak")
        : t("pillar_state_ok");

  const adsTone: PillarTileTone =
    data.adsApplicable === false ? "warn" : pillarTone(data.adsPillar);

  const pillarTiles: PillarTileData[] = hasPillars
    ? [
        {
          id: "reputation",
          label: t("pillar_reputation"),
          href: "/reviews",
          score: data.reputationPillar,
          tone: pillarTone(data.reputationPillar),
          sublabel: stateLabel(pillarTone(data.reputationPillar)),
          openLabel: t("pillar_open", { label: t("pillar_reputation") }),
        },
        {
          id: "visibility",
          label: t("pillar_visibility"),
          href: "/search",
          score: data.visibilityPillar,
          tone: pillarTone(data.visibilityPillar),
          sublabel: stateLabel(pillarTone(data.visibilityPillar)),
          openLabel: t("pillar_open", { label: t("pillar_visibility") }),
        },
        {
          id: "profile",
          label: t("pillar_profile"),
          href: "/my-business",
          score: data.profilePillar,
          tone: pillarTone(data.profilePillar),
          sublabel: stateLabel(pillarTone(data.profilePillar)),
          openLabel: t("pillar_open", { label: t("pillar_profile") }),
        },
        {
          id: "website",
          label: t("pillar_website"),
          href: "/website",
          score: data.websitePillar,
          tone: pillarTone(data.websitePillar),
          sublabel: stateLabel(pillarTone(data.websitePillar)),
          openLabel: t("pillar_open", { label: t("pillar_website") }),
        },
        {
          id: "advertising",
          label: t("pillar_advertising"),
          href: "/ads",
          score: data.adsPillar,
          tone: adsTone,
          sublabel:
            data.adsApplicable === false
              ? t("pillar_ads_off")
              : stateLabel(adsTone),
          openLabel: t("pillar_open", { label: t("pillar_advertising") }),
        },
      ]
    : [];

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
      <SmbPageHeader
        userId={session.user.id}
        namespace="smb.home"
        titleId="dashboard-heading"
      />

      {/* Hero KPI · Mapsly Score — with market standing under it in v2. */}
      <div style={{ marginBottom: 24 }}>
        <KPITile
          variant="hero"
          label={t("kpi_mapsly_score_label")}
          value={heroScoreText}
          unit={`/${MAPSLY_SCORE_MAX}`}
          tone={mapslyScoreTone(heroScoreNum)}
          infoTip={t("kpi_mapsly_score_tip")}
          valueAriaLabel={
            heroScoreNum != null
              ? `${heroScoreText} out of ${MAPSLY_SCORE_MAX}`
              : undefined
          }
          sublabel={
            hasPillars && standingLine
              ? standingLine
              : heroScoreNum != null
                ? null
                : t("kpi_no_data_sublabel")
          }
        />
      </div>

      {/* 7 supporting KPI tiles — Maria's "what's happening at a glance".
          Auto-fit keeps the strip calm on mobile (2 cols) and dense on
          desktop (up to 4-5 cols). */}
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
          label={t("kpi_unanswered_label")}
          value={data.unansweredReviewCount ?? 0}
          tone={
            (data.unansweredReviewCount ?? 0) >= 5
              ? "bad"
              : (data.unansweredReviewCount ?? 0) > 0
                ? "warn"
                : "neutral"
          }
          infoTip={t("kpi_unanswered_tip")}
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
          value={data.velocityLast30d ?? data.reviewsLast30d ?? "—"}
          infoTip={t("kpi_velocity_tip")}
          sublabel={t("kpi_velocity_sublabel")}
        />
        <KPITile
          label={t("kpi_brand_label")}
          value={t(`kpi_brand_value_${data.brandHijackStatus}`)}
          tone={
            data.brandHijackStatus === "hit"
              ? "bad"
              : data.brandHijackStatus === "watch"
                ? "warn"
                : "good"
          }
          infoTip={t("kpi_brand_tip")}
        />
      </div>

      {/* Needs your attention — top alerts (capped at MAX_ALERTS = 4). */}
      {data.alerts.length > 0 ? (
        <section aria-labelledby="alerts-heading" style={{ marginBottom: 32 }}>
          <h2
            id="alerts-heading"
            style={{
              margin: "0 0 12px",
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("alerts_heading")}
          </h2>
          <div
            style={{
              display: "grid",
              gap: 10,
            }}
          >
            {data.alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                tone={alert.tone}
                icon={
                  <span aria-hidden style={{ fontWeight: 700 }}>
                    !
                  </span>
                }
                body={alert.body}
                meta={alert.meta}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Score breakdown — v2 navigable pillar tiles (a map of Maria's
          business with doors on it), or the legacy 6-dim bars until the
          pillar-score pass has run. */}
      {hasPillars ? (
        <section aria-labelledby="pillars-heading" style={{ marginBottom: 24 }}>
          <h2
            id="pillars-heading"
            style={{
              margin: "0 0 12px",
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("pillars_heading")}
          </h2>
          <PillarTiles tiles={pillarTiles} />
        </section>
      ) : (
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
      )}

      {/* Your top fixes — 3 highest-impact actions with quantified
          impact values. Falls back to the empty info card when Maria
          has nothing to fix today (rare — but it happens). */}
      <section aria-labelledby="fixes-heading" style={{ marginBottom: 32 }}>
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
      </section>

      {/* Talk to a Mapsly advisor — gentle prompt to book a free
          consultation. Always visible (no data dependency). Per the
          v0.8.x SMB portal restructure: "Consultation with Mapsly team
          on any improvements of their business related to digital
          presence and website improvements." */}
      <section
        aria-labelledby="consultation-heading"
        style={{
          padding: "20px 22px",
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 32,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 16,
          alignItems: "center",
        }}
      >
        <div>
          <h2
            id="consultation-heading"
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("consultation_heading")}
          </h2>
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--color-text-2)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {t("consultation_body")}
          </p>
        </div>
        <a
          href={`mailto:advisor@mapsly.ai?subject=${encodeURIComponent(
            t("consultation_email_subject", { name: data.name }),
          )}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            padding: "0 18px",
            background: "var(--color-coral)",
            color: "#fff",
            border: "1px solid var(--color-coral)",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {t("consultation_cta")}
        </a>
      </section>

      {/* This week in your market — competitor activity feed. Hidden
          when there's nothing to show (new business, quiet week). */}
      {data.marketActivity.length > 0 ? (
        <section aria-labelledby="market-heading" style={{ marginBottom: 24 }}>
          <h2
            id="market-heading"
            style={{
              margin: "0 0 12px",
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("market_heading")}
          </h2>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              background: "var(--color-bg-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            {data.marketActivity.map((event, idx) => (
              <li
                key={event.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderTop:
                    idx === 0 ? "none" : "1px solid var(--color-border)",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span
                    aria-hidden
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--color-bg-3)",
                      color: "var(--color-text-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {t(`market_source_${event.source}`)}
                  </span>
                  <span
                    style={{
                      color: "var(--color-text)",
                      fontSize: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    {event.body}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-text-3)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {formatRelativeShort(event.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

/**
 * Short relative-time formatter for the market-activity feed.
 * Server-rendered — uses a fixed-now anchor (`new Date()` at request
 * time) so it stays a string, not a live timer. Maria's surface
 * doesn't need sub-minute precision.
 */
function formatRelativeShort(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.max(1, Math.floor(diffMs / 60_000));
  return `${mins}m ago`;
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

/** Pillar score (0–10) → tile tone. Mirrors the hero thresholds. */
function pillarTone(score: number | null): PillarTileTone {
  if (score == null) return "neutral";
  if (score >= 7) return "good";
  if (score >= 4) return "warn";
  return "bad";
}
