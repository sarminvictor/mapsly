import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";

import { routing } from "@/i18n/routing";
import { LOCALE_TO_BCP47 } from "@/lib/seo/hreflang";
import {
  buildMetaDescription,
  formatCategory,
  formatLocation,
  formatRatingLine,
  formatWebsiteDisplay,
} from "@/modules/biz-profile/format";
import {
  bizCanonicalUrl,
  bizLocalizedPath,
  buildLocalBusinessSchema,
} from "@/modules/biz-profile/json-ld";
import { getBusinessBySlug } from "@/modules/biz-profile/queries";
import { passesBizIndexGate } from "@/modules/biz-profile/seo-gate";

/**
 * Public business profile · `/biz/[slug]` (locale-prefixed equivalents
 * `/es/biz/[slug]`, `/en-ca/biz/[slug]`, `/fr/biz/[slug]`).
 *
 * Audience: dual — the business owner (SMB) checking their own listing AND
 * a prospective customer landing from Google search. Voice per
 * `.claude/rules/copy-voice.md` shared rules (warm + outcome-first), no
 * Agency jargon, no MSI/CTR/3-pack acronyms.
 *
 * Cache + perf:
 *   - Page is rendered from a `'use cache'` Prisma query (see
 *     `modules/biz-profile/queries.ts`). `cacheLife('hours')` matches the
 *     C.8 daily + C.9 weekly refresh cadence; tag-revalidation on snapshot
 *     write keeps stale content out of search results.
 *   - Per `.claude/rules/cache-components.md` Pattern 1, the query has a
 *     NEXT_PHASE build-guard returning EMPTY so Vercel's build worker can
 *     prerender the shell without opening a Neon WebSocket.
 *   - All section markup is inline server-component JSX — zero client JS,
 *     no hydration cost. Mobile-first responsive via inline styles + media
 *     queries inside the layout's CSS tokens.
 *
 * SEO:
 *   - `generateMetadata` builds title + description + canonical + hreflang
 *     + OG using `buildMetaDescription` (single source of truth).
 *   - LocalBusiness JSON-LD via `buildLocalBusinessSchema` (Schema.org
 *     LocalBusiness root type, with PostalAddress, GeoCoordinates,
 *     AggregateRating sub-objects).
 *   - Sitemap entry emitted by `app/sitemap.xml/route.ts` via
 *     `listBizSitemapEntries` — but ONLY for businesses that pass
 *     `passesBizIndexGate`. Gate-failing pages render normally yet declare
 *     `noindex, follow` (INC-2026-07-20-66): thin template pages are the
 *     post-March-2024 scaled-content deindex profile, while the claim
 *     funnel + outreach links still need the URLs to resolve.
 *
 * notFound() handling:
 *   - If the slug doesn't match an active business, the query returns
 *     EMPTY_BIZ_PROFILE (id === ""). The page dispatches
 *     `notFound()` so Next renders the closest `not-found.tsx` (or its
 *     default 404).
 *   - Same shape returned during build-phase prerender — so build-time
 *     params don't try to read real DB and still produce sane output.
 */

interface RouteParams {
  locale: string;
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const data = await getBusinessBySlug(slug);

  // Build-phase or unknown slug — keep robots noindex so 404 shells don't
  // leak into search results. Vercel still 200s the page if generateMetadata
  // returns successfully; the page body will notFound().
  if (data.id === "") {
    return {
      title: "Business not found · Mapsly",
      robots: { index: false, follow: false },
    };
  }

  const canonical = bizCanonicalUrl(slug, locale);
  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[LOCALE_TO_BCP47[l]] = bizLocalizedPath(slug, l);
  }
  languages["x-default"] = bizLocalizedPath(slug, routing.defaultLocale);

  const description = buildMetaDescription(data);
  const title = `${data.name} · ${formatCategory(data.category)}${
    data.city ? ` in ${data.city}` : ""
  } — Mapsly`;

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      type: "website",
      siteName: "Mapsly",
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    // Index only pages with real proprietary signal (same predicate the
    // sitemap query applies — the two must never diverge, see seo-gate.ts).
    // `follow: true` either way: sparse pages keep passing link equity and
    // keep serving the claim-funnel / outreach entry points.
    robots: passesBizIndexGate(data)
      ? { index: true, follow: true }
      : { index: false, follow: true },
  };
}

async function BizProfileBody({ params }: { params: Promise<RouteParams> }) {
  // Mark this route dynamic at request time. Per
  // `.claude/rules/cache-components.md` Pattern 5, `/biz/[slug]` cannot
  // statically prerender (the slug is not enumerable via
  // generateStaticParams — there are 500+ businesses and the set grows
  // weekly via cron). `await connection()` is the canonical "this route
  // reads request-time data" signal under cacheComponents PPR — without
  // it, Next tries to prerender the [slug] placeholder shell and trips
  // E_BLOCKING_ROUTE before the cached query even runs.
  await connection();

  const { locale, slug } = await params;
  // Locale gating is the middleware's job; if we got here the locale is valid.
  // Skip setRequestLocale — this route renders zero translated strings
  // (business content is per-record, not per-locale).

  const data = await getBusinessBySlug(slug);
  if (data.id === "") notFound();

  const canonical = bizCanonicalUrl(slug, locale);
  const schema = buildLocalBusinessSchema(data, canonical);
  const categoryLabel = formatCategory(data.category);
  const locationLine = formatLocation(data);
  const ratingLine = formatRatingLine(data);
  const websiteDisplay = formatWebsiteDisplay(data.website);

  // Score tile renders only when we have a snapshot — most launch-window
  // businesses have no snapshot yet so the section is hidden gracefully.
  const hasScore = data.mapslyScore != null;
  const scoreText = hasScore ? data.mapslyScore!.toFixed(1) : null;

  return (
    <article
      aria-labelledby="biz-name"
      style={{
        padding: "48px 24px 64px",
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        {/* Hero */}
        <header
          style={{
            marginBottom: 40,
            paddingBottom: 32,
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              border: "1px solid var(--color-border)",
              borderRadius: 999,
              background: "var(--color-bg-2)",
              color: "var(--color-text-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            {categoryLabel}
            {data.isClaimed ? " · Claimed" : ""}
          </div>
          <h1
            id="biz-name"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(32px, 5vw, 48px)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: 0,
              color: "var(--color-text)",
            }}
          >
            {data.name}
          </h1>
          {locationLine ? (
            <p
              style={{
                margin: "12px 0 0",
                color: "var(--color-text-2)",
                fontSize: 16,
                fontWeight: 500,
              }}
            >
              {locationLine}
            </p>
          ) : null}
          {ratingLine ? (
            <p
              aria-label={
                data.rating != null && data.reviewCount != null
                  ? `${data.rating.toFixed(1)} out of 5 stars from ${
                      data.reviewCount
                    } reviews`
                  : undefined
              }
              style={{
                margin: "8px 0 0",
                color: "var(--color-text-2)",
                fontSize: 15,
              }}
            >
              {ratingLine}
            </p>
          ) : null}
        </header>

        {/* Mapsly Score tile (only when present) */}
        {hasScore ? (
          <section
            aria-labelledby="biz-score-heading"
            style={{
              marginBottom: 40,
              padding: "28px 24px",
              borderRadius: 16,
              background: "var(--color-bg-2)",
              border: "1px solid var(--color-border)",
            }}
          >
            <h2
              id="biz-score-heading"
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                color: "var(--color-text-3)",
              }}
            >
              Mapsly Score
            </h2>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                marginTop: 8,
              }}
            >
              <span
                aria-label={`Mapsly Score ${scoreText} out of 10`}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 56,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: "var(--color-coral)",
                }}
              >
                {scoreText}
              </span>
              <span
                aria-hidden
                style={{
                  fontSize: 18,
                  color: "var(--color-text-3)",
                }}
              >
                / 10
              </span>
            </div>
            {data.msiRank != null && data.msiTotal != null ? (
              <p
                style={{
                  margin: "12px 0 0",
                  color: "var(--color-text-2)",
                  fontSize: 15,
                }}
              >
                Ranks <strong>#{data.msiRank}</strong> of {data.msiTotal}{" "}
                {categoryLabel.toLowerCase()}s
                {data.city ? ` in ${data.city}` : ""}.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Contact + location facts */}
        <section
          aria-labelledby="biz-details-heading"
          style={{ marginBottom: 40 }}
        >
          <h2
            id="biz-details-heading"
            style={{
              margin: "0 0 12px",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              color: "var(--color-text-3)",
            }}
          >
            Details
          </h2>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "min-content 1fr",
              columnGap: 16,
              rowGap: 8,
              margin: 0,
              fontSize: 15,
              color: "var(--color-text)",
            }}
          >
            {data.address ? (
              <>
                <dt
                  style={{
                    color: "var(--color-text-3)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  Address
                </dt>
                <dd style={{ margin: 0 }}>{data.address}</dd>
              </>
            ) : null}
            {data.phone ? (
              <>
                <dt
                  style={{
                    color: "var(--color-text-3)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  Phone
                </dt>
                <dd style={{ margin: 0 }}>
                  <a
                    href={`tel:${data.phone.replace(/[^+0-9]/g, "")}`}
                    style={{
                      color: "var(--color-coral)",
                      textDecoration: "none",
                    }}
                  >
                    {data.phone}
                  </a>
                </dd>
              </>
            ) : null}
            {data.website && websiteDisplay ? (
              <>
                <dt
                  style={{
                    color: "var(--color-text-3)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  Website
                </dt>
                <dd style={{ margin: 0 }}>
                  <a
                    href={data.website}
                    rel="noopener nofollow"
                    target="_blank"
                    style={{
                      color: "var(--color-coral)",
                      textDecoration: "none",
                    }}
                  >
                    {websiteDisplay}
                  </a>
                </dd>
              </>
            ) : null}
            {data.photosCount != null && data.photosCount > 0 ? (
              <>
                <dt
                  style={{
                    color: "var(--color-text-3)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  Photos
                </dt>
                <dd style={{ margin: 0 }}>{data.photosCount}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {/* Pitch · "powered by Mapsly" + claim CTA for the owner */}
        <section
          aria-labelledby="biz-cta-heading"
          style={{
            padding: "24px",
            borderRadius: 16,
            border: "1px solid var(--color-border)",
            background:
              "linear-gradient(180deg, var(--color-bg-2) 0%, var(--color-bg) 100%)",
          }}
        >
          <h2
            id="biz-cta-heading"
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: 24,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            Is this your business?
          </h2>
          <p
            style={{
              margin: "12px 0 16px",
              color: "var(--color-text-2)",
              fontSize: 15,
              lineHeight: 1.5,
            }}
          >
            See who&apos;s choosing the {categoryLabel.toLowerCase()} down the
            street, what your reviews really say, and the three fixes that
            actually move the needle this week.
          </p>
          <Link
            href="/for-businesses"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 22px",
              borderRadius: 10,
              background: "var(--color-coral)",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            See your free reality check →
          </Link>
        </section>
      </div>

      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </article>
  );
}

/**
 * Public default export · sync shell that wraps the async body in a
 * Suspense boundary. Per `.claude/rules/cache-components.md` Pattern 2,
 * pages doing DB reads MUST wrap the async work in <Suspense> so Next's
 * Partial Pre-Rendering can prerender the shell and defer the body to
 * runtime. The fallback is null because the marketing layout already
 * provides chrome (header, footer); the article itself appears in one
 * paint once the cached query resolves.
 */
export default function BusinessProfilePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  return (
    <Suspense fallback={null}>
      <BizProfileBody params={params} />
    </Suspense>
  );
}
