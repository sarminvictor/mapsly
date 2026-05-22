/**
 * SMB market reality · `/(smb)/market`.
 *
 * Audience: Maria. Answers her single biggest question — "where do I
 * stand in my market?" Hero rank · Top-12 ranked rows with Maria
 * highlighted · market medians block ("how most spas in your area
 * do") · movers ("who's on a hot streak").
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - "Where you stand" beats "MSI rank"
 *   - "How most spas in your area do" beats "median across the slice"
 *   - Maria's row highlighted with the coral accent; no acronyms
 *
 * Per `.claude/rules/cache-components.md` Patterns 1 + 2:
 *   - Default export is SYNC; async body in Suspense
 *   - Cached query short-circuits at NEXT_PHASE
 *
 * Spatial map intentionally NOT in v1 — needs a map lib + addresses
 * per business. Follow-up task.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { requirePortal } from "@/lib/portal-guard";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSmbMarketData } from "@/modules/smb-market/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "smb.market.meta" });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

export default function SmbMarketPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<MarketSkeleton />}>
      <MarketBody params={params} />
    </Suspense>
  );
}

function MarketSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 920,
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
          height: 140,
          background: "var(--color-bg-2)",
          borderRadius: 16,
          marginBottom: 22,
        }}
      />
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 8,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            style={{
              height: 48,
              background: "var(--color-bg-2)",
              borderRadius: 10,
            }}
          />
        ))}
      </ul>
    </section>
  );
}

async function MarketBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  // Cross-portal guard · agency members get bounced to /lists so the
  // SMB portal is reserved for Maria + non-agency users (ADMIN passes
  // through). Per `lib/portal-guard.ts`.
  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.market");
  const data = await getSmbMarketData(session.user.id);

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

  const hasRank = data.ownRank != null && data.marketTotal != null;
  const fmtPct = (v: number | null) =>
    v == null ? "—" : `${Math.round(v * 100)}%`;
  const fmtNum = (v: number | null) =>
    v == null ? "—" : Number.isInteger(v) ? `${v}` : v.toFixed(1);

  return (
    <section
      aria-labelledby="market-heading"
      style={{
        maxWidth: 920,
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
          id="market-heading"
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
            {t("subtitle", { city: data.city })}
          </p>
        ) : null}
      </header>

      {/* Hero rank · the headline number */}
      <section
        aria-labelledby="rank-heading"
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: "22px 24px",
          marginBottom: 22,
          display: "flex",
          alignItems: "center",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <p
            id="rank-heading"
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-3)",
            }}
          >
            {t("rank_label")}
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontFamily: "var(--font-serif)",
              fontSize: 48,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              color: "var(--color-coral)",
              fontWeight: 600,
            }}
          >
            {hasRank
              ? t("rank_value", {
                  rank: data.ownRank!,
                  total: data.marketTotal!,
                })
              : "—"}
          </p>
          <p
            style={{
              margin: "10px 0 0",
              color: "var(--color-text-2)",
              fontSize: 14,
              lineHeight: 1.5,
              maxWidth: 460,
            }}
          >
            {data.gapToLeader != null
              ? t("rank_gap", { gap: data.gapToLeader.toFixed(1) })
              : t("rank_no_data")}
          </p>
        </div>
        <div
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: "12px 16px",
            minWidth: 160,
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
            {t("score_label")}
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--font-serif)",
              fontSize: 26,
              fontWeight: 600,
              color: "var(--color-text)",
            }}
          >
            {data.ownMapslyScore != null ? data.ownMapslyScore.toFixed(1) : "—"}
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--color-text-3)",
                marginLeft: 2,
              }}
            >
              /10
            </span>
          </p>
        </div>
      </section>

      {/* Top-12 ranking · Maria highlighted */}
      <section aria-labelledby="top12-heading" style={{ marginBottom: 22 }}>
        <h2
          id="top12-heading"
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {t("top12_heading")}
        </h2>
        {data.topRanked.length === 0 ? (
          <EmptyCard body={t("top12_empty")} />
        ) : (
          <ol
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
            {data.topRanked.map((row, idx) => (
              <li
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px minmax(0, 1fr) 70px 70px 70px",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderTop:
                    idx === 0 ? "none" : "1px solid var(--color-border)",
                  background: row.isOwn ? "rgba(195,85,58,.08)" : "transparent",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-text-3)",
                    fontWeight: 600,
                  }}
                >
                  #{row.rank}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--color-text)",
                    fontWeight: row.isOwn ? 700 : 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.isOwn ? `${row.name} · ${t("you_tag")}` : row.name}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--color-text-2)",
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                >
                  {fmtNum(row.mapslyScore)}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--color-text-2)",
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                >
                  {row.rating != null ? row.rating.toFixed(1) + "★" : "—"}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--color-text-2)",
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                >
                  {row.reviewCount ?? "—"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Market medians */}
      <section aria-labelledby="medians-heading" style={{ marginBottom: 22 }}>
        <h2
          id="medians-heading"
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {t("medians_heading", { total: data.medians.total })}
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          <MedianCell
            label={t("median_rating")}
            value={
              data.medians.rating != null ? data.medians.rating.toFixed(1) : "—"
            }
          />
          <MedianCell
            label={t("median_reviews")}
            value={
              data.medians.reviewCount != null
                ? `${Math.round(data.medians.reviewCount)}`
                : "—"
            }
          />
          <MedianCell
            label={t("median_reply_rate")}
            value={fmtPct(data.medians.replyRate)}
          />
          <MedianCell
            label={t("median_photos")}
            value={
              data.medians.photosCount != null
                ? `${Math.round(data.medians.photosCount)}`
                : "—"
            }
          />
          <MedianCell
            label={t("median_velocity")}
            value={
              data.medians.velocityLast30d != null
                ? `${Math.round(data.medians.velocityLast30d)}`
                : "—"
            }
          />
        </div>
      </section>

      {/* Hot-streak movers */}
      {data.movers.length > 0 ? (
        <section aria-labelledby="movers-heading">
          <h2
            id="movers-heading"
            style={{
              margin: "0 0 12px",
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("movers_heading")}
          </h2>
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 10,
            }}
          >
            {data.movers.map((m, i) => (
              <li
                key={m.id}
                style={{
                  background: "var(--color-bg-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  padding: "12px 16px",
                  display: "grid",
                  gridTemplateColumns: "32px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-coral)",
                    fontWeight: 600,
                  }}
                >
                  #{i + 1}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--color-text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--color-success)",
                    fontWeight: 600,
                  }}
                >
                  {t("mover_value", { count: m.velocityLast30d })}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p
        style={{
          margin: "24px 0 0",
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

function MedianCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "12px 14px",
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
          color: "var(--color-text)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyCard({ body }: { body: string }) {
  return (
    <div
      style={{
        background: "var(--color-bg-2)",
        border: "1px dashed var(--color-border)",
        borderRadius: 12,
        padding: "18px 20px",
        color: "var(--color-text-2)",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {body}
    </div>
  );
}
