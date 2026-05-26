/**
 * SMB "How you compare" · `/(smb)/how-you-compare`.
 *
 * Unified replacement for the prior `/competitors` + `/market` pages.
 * Same data, one Maria-facing answer to "where do I stand, and what's
 * threatening me." Replaces two separate destinations with one.
 *
 * Sections, in order (per the SMB portal restructure v0.8.x):
 *
 *   1. Hero          · rank + Mapsly Score + gap to leader
 *   2. Top ranked    · top 12 in your category + city
 *   3. Head-to-head  · 7 dimensions vs the highest-scoring competitor
 *   4. Medians       · where the middle of the market is
 *   5. What needs    · priority-ordered threat rail
 *      your attention
 *   6. On a hot      · 3 fastest-growing competitors
 *      streak
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2: SYNC default export + Suspense'd async body.
 *   - Pattern 1: composed query in `modules/smb-how-you-compare/queries.ts`
 *     inherits both source modules' NEXT_PHASE + EMPTY guards.
 *
 * Per `.claude/rules/security.md`:
 *   - `auth()` at the top of the inner body; `unauthorized()` interrupt.
 *
 * Per `.claude/rules/i18n.md`:
 *   - All copy in `messages/en.json` under `smb.how_you_compare.*`. Other
 *     locales fall back to en via the request-config deep-merge in
 *     `i18n/request.ts`.
 *
 * Old routes (`/competitors`, `/market`) remain accessible — bookmarks
 * don't break. They'll be formally retired in a later cleanup pass.
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
  getSmbHowYouCompareData,
  type SmbHowYouCompareData,
  type HeadToHeadDimension,
  type SmbCompetitorThreat,
  type MarketRankingRow,
  type MarketMedians,
  type MarketMover,
} from "@/modules/smb-how-you-compare";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "smb.how_you_compare.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

export default function SmbHowYouComparePage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<HowYouCompareSkeleton />}>
      <HowYouCompareBody params={params} />
    </Suspense>
  );
}

function HowYouCompareSkeleton() {
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
          width: 280,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          height: 140,
          background: "var(--color-bg-2)",
          borderRadius: 16,
          marginBottom: 16,
        }}
      />
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 200,
            background: "var(--color-bg-2)",
            borderRadius: 16,
            marginBottom: 16,
          }}
        />
      ))}
    </section>
  );
}

async function HowYouCompareBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.how_you_compare");
  const data = await getSmbHowYouCompareData(session.user.id);

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

  return (
    <section
      aria-labelledby="hyc-heading"
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <Header data={data} t={t} />
      <HeroSection data={data} t={t} />
      <TopRankedSection
        rows={data.topRanked}
        t={t}
        ownName={data.businessName}
      />
      <HeadToHeadSection
        rows={data.headToHead}
        leaderName={data.leaderName}
        t={t}
      />
      <MediansSection medians={data.medians} t={t} />
      <ThreatsSection threats={data.threats} t={t} />
      <MoversSection movers={data.movers} t={t} />

      <p style={footnoteStyle()}>{t("footer_help")}</p>
    </section>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

function Header({ data, t }: { data: SmbHowYouCompareData; t: TranslateFn }) {
  return (
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
        id="hyc-heading"
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
      {data.city ? (
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--color-text-2)",
            fontSize: 14,
          }}
        >
          {t("subtitle", { category: data.category, city: data.city })}
        </p>
      ) : null}
    </header>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function HeroSection({
  data,
  t,
}: {
  data: SmbHowYouCompareData;
  t: TranslateFn;
}) {
  const hasRank = data.marketRank != null && data.marketTotal != null;
  const rankHeadline = hasRank
    ? t("rank_headline", {
        rank: data.marketRank!,
        total: data.marketTotal!,
      })
    : t("rank_pending");

  return (
    <section
      aria-labelledby="hyc-hero-heading"
      style={{
        ...cardStyle(),
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 24,
        alignItems: "center",
      }}
    >
      <div>
        <h2 id="hyc-hero-heading" style={eyebrowStyle()}>
          {t("rank_label")}
        </h2>
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(22px, 3.5vw, 28px)",
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {rankHeadline}
        </p>
        {data.gapToLeader != null && data.gapToLeader > 0 ? (
          <p style={{ margin: "8px 0 0", ...bodyTextStyle() }}>
            {t("gap_to_leader", {
              gap: data.gapToLeader.toFixed(1),
            })}
          </p>
        ) : null}
      </div>

      <div style={{ textAlign: "right", flex: "0 0 auto" }}>
        <div style={eyebrowStyle()}>{t("score_label")}</div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(36px, 6vw, 52px)",
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: "var(--color-coral)",
            marginTop: 4,
          }}
        >
          {data.ownMapslyScore != null ? data.ownMapslyScore.toFixed(1) : "—"}
        </div>
        <div style={{ ...bodyTextStyle(), marginTop: 2, fontSize: 12 }}>
          {t("score_max")}
        </div>
      </div>
    </section>
  );
}

// ─── Top ranked ───────────────────────────────────────────────────────────

function TopRankedSection({
  rows,
  t,
  ownName,
}: {
  rows: MarketRankingRow[];
  t: TranslateFn;
  ownName: string;
}) {
  if (rows.length === 0) {
    return (
      <Section title={t("top_heading")}>
        <EmptyCard body={t("top_empty")} />
      </Section>
    );
  }

  return (
    <Section title={t("top_heading")}>
      <ul style={listStyle()}>
        {rows.map((row) => (
          <RankingRow
            key={row.id}
            row={row}
            t={t}
            highlight={row.name === ownName}
          />
        ))}
      </ul>
    </Section>
  );
}

function RankingRow({
  row,
  t,
  highlight,
}: {
  row: MarketRankingRow;
  t: TranslateFn;
  highlight: boolean;
}) {
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "32px minmax(0, 1fr) auto auto auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 12px",
        background: highlight ? "rgba(195, 85, 58, 0.06)" : "var(--color-bg)",
        border: highlight
          ? "1px solid rgba(195, 85, 58, 0.35)"
          : "1px solid var(--color-border)",
        borderRadius: 10,
        fontSize: 14,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-3)",
          fontSize: 12,
        }}
      >
        #{row.rank}
      </span>
      <span
        style={{
          color: "var(--color-text)",
          fontWeight: highlight ? 600 : 400,
          wordBreak: "break-word",
        }}
      >
        {row.name}
        {row.isOwn ? (
          <span
            style={{
              marginLeft: 8,
              padding: "1px 8px",
              borderRadius: 999,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              background: "var(--color-coral)",
              color: "#fff",
            }}
          >
            {t("you_badge")}
          </span>
        ) : null}
      </span>
      <span style={cellMutedStyle()}>
        ★ {row.rating != null ? row.rating.toFixed(1) : "—"}
      </span>
      <span style={cellMutedStyle()}>
        {row.reviewCount != null ? row.reviewCount : "—"}
      </span>
      <span
        style={{
          color: "var(--color-coral)",
          fontWeight: 600,
          fontFamily: "var(--font-mono)",
        }}
      >
        {row.mapslyScore != null ? row.mapslyScore.toFixed(1) : "—"}
      </span>
    </li>
  );
}

// ─── Head-to-head ──────────────────────────────────────────────────────────

function HeadToHeadSection({
  rows,
  leaderName,
  t,
}: {
  rows: HeadToHeadDimension[];
  leaderName: string | null;
  t: TranslateFn;
}) {
  if (rows.length === 0 || !leaderName) return null;

  return (
    <Section title={t("h2h_heading", { leader: leaderName })}>
      <ul style={{ ...listStyle(), gap: 12 }}>
        {rows.map((row) => (
          <li key={row.key} style={h2hRowStyle()}>
            <div style={h2hLabelStyle()}>{t(`h2h_${row.key}`)}</div>
            <div style={h2hBarShellStyle()}>
              <div
                style={{
                  ...h2hBarFillStyle(),
                  width: `${Math.round(row.ownShare * 100)}%`,
                }}
                aria-hidden
              />
            </div>
            <div style={h2hValuesStyle()}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-coral)",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {row.ownValue}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-3)",
                  fontSize: 12,
                }}
              >
                {t("h2h_vs", { value: row.leaderValue })}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ─── Medians ───────────────────────────────────────────────────────────────

function MediansSection({
  medians,
  t,
}: {
  medians: MarketMedians;
  t: TranslateFn;
}) {
  if (medians.total === 0) return null;

  const cards: Array<{ key: string; value: string }> = [
    {
      key: "rating",
      value: medians.rating != null ? medians.rating.toFixed(1) : "—",
    },
    {
      key: "reviews",
      value: medians.reviewCount != null ? `${medians.reviewCount}` : "—",
    },
    {
      key: "reply_rate",
      value:
        medians.replyRate != null
          ? `${Math.round(medians.replyRate * 100)}%`
          : "—",
    },
    {
      key: "photos",
      value: medians.photosCount != null ? `${medians.photosCount}` : "—",
    },
    {
      key: "velocity",
      value:
        medians.velocityLast30d != null ? `${medians.velocityLast30d}` : "—",
    },
  ];

  return (
    <Section
      title={t("medians_heading", { total: medians.total })}
      subtitle={t("medians_subtitle")}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.key}
            style={{
              padding: "14px 14px 16px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
            }}
          >
            <div style={eyebrowStyle()}>{t(`median_${c.key}`)}</div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "var(--font-serif)",
                fontSize: 22,
                color: "var(--color-text)",
              }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Threats ───────────────────────────────────────────────────────────────

function ThreatsSection({
  threats,
  t,
}: {
  threats: SmbCompetitorThreat[];
  t: TranslateFn;
}) {
  if (threats.length === 0) return null;

  return (
    <Section title={t("threats_heading")}>
      <ul style={{ ...listStyle(), gap: 10 }}>
        {threats.map((threat) => (
          <li key={threat.id} style={threatRowStyle(threat.tier)}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: threatTierColor(threat.tier),
                marginBottom: 4,
              }}
            >
              {t(`threats_tier_${threat.tier}`)}
            </div>
            <div
              style={{
                color: "var(--color-text)",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {threat.body}
            </div>
            {threat.meta ? (
              <div
                style={{
                  marginTop: 4,
                  color: "var(--color-text-3)",
                  fontSize: 12,
                }}
              >
                {threat.meta}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ─── Movers ────────────────────────────────────────────────────────────────

function MoversSection({
  movers,
  t,
}: {
  movers: MarketMover[];
  t: TranslateFn;
}) {
  if (movers.length === 0) return null;

  return (
    <Section title={t("movers_heading")}>
      <ul style={{ ...listStyle(), gap: 8 }}>
        {movers.map((m) => (
          <li
            key={m.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
            }}
          >
            <span style={{ color: "var(--color-text)", fontSize: 14 }}>
              {m.name}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--color-coral)",
                fontWeight: 600,
              }}
            >
              {t("mover_value", { count: m.velocityLast30d })}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ─── Shared subcomponents + styles ─────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontSize: 18,
          letterSpacing: "-0.01em",
          color: "var(--color-text)",
        }}
      >
        {title}
      </h2>
      {subtitle ? (
        <p
          style={{
            margin: "4px 0 14px",
            color: "var(--color-text-2)",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {subtitle}
        </p>
      ) : (
        <div style={{ height: 12 }} />
      )}
      {children}
    </section>
  );
}

function EmptyCard({ body }: { body: string }) {
  return (
    <div
      style={{
        padding: "20px 18px",
        background: "var(--color-bg)",
        border: "1px dashed var(--color-border)",
        borderRadius: 12,
        color: "var(--color-text-2)",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {body}
    </div>
  );
}

type TranslateFn = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function cardStyle(): React.CSSProperties {
  return {
    padding: "22px 22px 24px",
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 16,
    marginBottom: 24,
  };
}

function eyebrowStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--color-text-3)",
    fontWeight: 500,
    margin: 0,
  };
}

function bodyTextStyle(): React.CSSProperties {
  return {
    color: "var(--color-text-2)",
    fontSize: 14,
    lineHeight: 1.5,
    margin: 0,
  };
}

function listStyle(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 0,
    margin: 0,
    listStyle: "none",
  };
}

function cellMutedStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    color: "var(--color-text-2)",
    fontSize: 13,
  };
}

function h2hRowStyle(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 140px) minmax(0, 1fr) minmax(0, 140px)",
    gap: 12,
    alignItems: "center",
    padding: "8px 0",
  };
}

function h2hLabelStyle(): React.CSSProperties {
  return {
    color: "var(--color-text)",
    fontSize: 13,
    fontWeight: 500,
  };
}

function h2hBarShellStyle(): React.CSSProperties {
  return {
    position: "relative",
    height: 8,
    background: "var(--color-bg-3)",
    borderRadius: 999,
    overflow: "hidden",
  };
}

function h2hBarFillStyle(): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    background: "var(--color-coral)",
    borderRadius: 999,
  };
}

function h2hValuesStyle(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
  };
}

function threatTierColor(tier: SmbCompetitorThreat["tier"]): string {
  if (tier === "high") return "var(--color-coral)";
  if (tier === "rising") return "var(--color-text-2)";
  return "var(--color-text-3)";
}

function threatRowStyle(
  tier: SmbCompetitorThreat["tier"],
): React.CSSProperties {
  const borderColor =
    tier === "high" ? "rgba(195, 85, 58, 0.35)" : "var(--color-border)";
  return {
    padding: "12px 14px 14px",
    background: "var(--color-bg)",
    border: `1px solid ${borderColor}`,
    borderRadius: 12,
  };
}

function footnoteStyle(): React.CSSProperties {
  return {
    margin: "16px 0 0",
    color: "var(--color-text-3)",
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: "center",
  };
}
