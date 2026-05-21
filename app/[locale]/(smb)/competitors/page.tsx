/**
 * SMB competitors · `/(smb)/competitors` (locale-prefixed variants e.g.
 * `/es/competidores`, `/fr/concurrents` declared in `i18n/routing.ts`).
 *
 * Audience: Maria (single-business owner). Per
 * `.claude/rules/ui-ux-smb.md`:
 *
 *   - Hero: "You're #3 of 12" headline framed in plain English — no
 *     "MSI", no "3-pack"
 *   - Below: top 8 competitors in the same category + city with
 *     rating, reviews, Mapsly Score; her own row highlighted
 *   - Empty state when no other businesses are indexed in her area yet
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — default export is SYNC. Async body (auth + cached
 *     query) lives inside a Suspense boundary. This is what lets the
 *     route prerender a shell under `experimental.cacheComponents:
 *     true`.
 *   - **Pattern 1** — the cached `getSmbCompetitorsData()` has the
 *     NEXT_PHASE build-guard returning EMPTY so Vercel's build worker
 *     can prerender without opening a Neon WebSocket.
 *   - **Pattern 5** — no `export const dynamic = 'force-dynamic'`. The
 *     Suspense wrap is the canonical "this route reads request data"
 *     signal.
 *
 * Auth: page is authenticated. Anonymous visitors get
 * `unauthorized()` → `/signin`. Users with no claimed business get
 * the same onboarding empty state as the dashboard.
 *
 * Per `.claude/rules/copy-voice.md`:
 *
 *   - "Where you stand" beats "Market positioning"
 *   - Plain numbers, info-tip jargon, no acronyms
 *
 * Per `.claude/rules/i18n.md`:
 *
 *   - All copy in `messages/{locale}.json` under `smb.competitors.*`
 *   - en / es / fr-CA all populated; en-CA falls back to en
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { CompetitorRow } from "@/modules/smb-competitors/components";
import { getSmbCompetitorsData } from "@/modules/smb-competitors/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "smb.competitors.meta",
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
export default function SmbCompetitorsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<CompetitorsSkeleton />}>
      <CompetitorsBody params={params} />
    </Suspense>
  );
}

/**
 * Skeleton · matches the resolved page heights to avoid CLS once the
 * Suspense'd body resolves. Honors `prefers-reduced-motion` (no shimmer
 * / pulse animation — just static low-contrast blocks).
 */
function CompetitorsSkeleton() {
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
          height: 120,
          background: "var(--color-bg-2)",
          borderRadius: 16,
          marginBottom: 24,
        }}
      />
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
 * Async body · runs auth check + cached query inside the Suspense
 * boundary. Per cache-components Pattern 2.
 */
async function CompetitorsBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    // Next 16 auth interrupt — bubbles to the closest unauthorized.tsx
    // (or framework default). Per `.claude/rules/security.md`.
    unauthorized();
  }

  const t = await getTranslations("smb.competitors");
  const data = await getSmbCompetitorsData(session.user.id);

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

  const rowLabels = {
    youBadge: t("you_badge"),
    youAriaSuffix: t("you_aria_suffix"),
    scoreLabel: t("score_aria_label"),
    ratingLabel: t("rating_aria_label"),
    reviewsLabel: t("reviews_aria_label"),
    noDataDash: "—",
  };

  const hasRank = data.marketRank != null && data.marketTotal != null;
  const rankHeadline = hasRank
    ? t("rank_headline", {
        rank: data.marketRank!,
        total: data.marketTotal!,
      })
    : t("rank_pending");

  const noCity = !data.city;
  const noNeighbours =
    !noCity && data.competitors.filter((c) => !c.isOwn).length === 0;
  const hasList = data.competitors.length > 0;

  return (
    <section
      aria-labelledby="competitors-heading"
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
          id="competitors-heading"
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
            {t("subtitle", {
              category: data.category,
              city: data.city,
            })}
          </p>
        ) : null}
      </header>

      {/* Hero · "Where you stand" */}
      <section
        aria-labelledby="rank-heading"
        style={{
          padding: "22px 24px",
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          marginBottom: 24,
        }}
      >
        <h2
          id="rank-heading"
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-3)",
            fontWeight: 500,
          }}
        >
          {t("rank_label")}
        </h2>
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(24px, 3.5vw, 30px)",
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {rankHeadline}
        </p>
        {hasRank ? (
          <p
            style={{
              margin: "8px 0 0",
              color: "var(--color-text-2)",
              fontSize: 14,
            }}
          >
            {t("rank_help")}
          </p>
        ) : null}
      </section>

      {/* Comparison list */}
      <section
        aria-labelledby="list-heading"
        style={{ marginBottom: 24 }}
      >
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

        {noCity ? (
          <EmptyCard body={t("empty_no_city")} />
        ) : noNeighbours ? (
          <EmptyCard body={t("empty_no_neighbours")} />
        ) : hasList ? (
          <>
            {/* Visible column labels (also help screen-reader scanning) */}
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
              <span style={{ width: 28, flexShrink: 0 }} aria-hidden>
                #
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {t("col_business")}
              </span>
              <span
                style={{ width: 64, textAlign: "right", flexShrink: 0 }}
              >
                {t("col_rating")}
              </span>
              <span
                style={{ width: 56, textAlign: "right", flexShrink: 0 }}
              >
                {t("col_reviews")}
              </span>
              <span
                style={{ width: 56, textAlign: "right", flexShrink: 0 }}
              >
                {t("col_score")}
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
              {data.competitors.map((c, i) => (
                <CompetitorRow
                  key={c.id}
                  rank={i + 1}
                  name={c.name}
                  isOwn={c.isOwn}
                  rating={c.rating}
                  reviewCount={c.reviewCount}
                  mapslyScore={c.mapslyScore}
                  labels={rowLabels}
                />
              ))}
            </ul>
          </>
        ) : (
          <EmptyCard body={t("empty_no_neighbours")} />
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
 * pull in `AlertCard`'s richer icon+meta shape for what is essentially
 * one calm line of plain English.
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
