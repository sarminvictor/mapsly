/**
 * Schema.org JSON-LD generators · stable shapes for every public surface.
 *
 * Why generators (not inline literals): every public page rolls its own
 * structured data today (the B.1 landing inlines Organization). Centralising
 * the schemas means:
 *   - one place to fix when validator.schema.org flags a missing required
 *     field
 *   - one place to add Schema.org property additions (e.g. `sameAs` profiles)
 *   - typed input → less chance of stale fields drifting
 *   - testable: a Vitest unit asserts the shape that ships to Google
 *
 * All generators are PURE — no DB calls, no `new Date()`, no random IDs.
 * They return plain JSON-serializable objects. Inline with:
 *
 *   <script type="application/ld+json" dangerouslySetInnerHTML={{
 *     __html: JSON.stringify(organizationSchema())
 *   }} />
 *
 * Per INC-2026-05-19-09, no time-dependent calls anywhere in this file.
 */

import { CANONICAL_ORIGIN } from "./canonical";

/* ------------------------------------------------------------------------ */
/* Organization                                                              */
/* ------------------------------------------------------------------------ */

export interface OrganizationSchemaOptions {
  /** Override the default description (e.g. for a localised marketing page). */
  description?: string;
  /** Additional social / profile URLs for `sameAs`. */
  sameAs?: readonly string[];
}

/**
 * Top-level Organization schema · binds the Mapsly brand for Google sitelinks
 * and Knowledge Graph eligibility. Ship on the homepage (B.1) at minimum.
 *
 * Reference: https://developers.google.com/search/docs/appearance/structured-data/logo
 */
export function organizationSchema(
  options: OrganizationSchemaOptions = {},
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Mapsly",
    url: CANONICAL_ORIGIN,
    description:
      options.description ??
      "Local business intelligence platform. SMB owners see hidden problems; agencies see ready-to-switch prospects.",
    sameAs: options.sameAs ?? [],
  };
}

/* ------------------------------------------------------------------------ */
/* WebSite (with optional SearchAction)                                      */
/* ------------------------------------------------------------------------ */

export interface WebSiteSchemaOptions {
  /** Site name (defaults to "Mapsly"). */
  name?: string;
  /**
   * Sitelinks search URL template · if provided, declares a SearchAction so
   * Google may show a search box in results. Pattern uses
   * `{search_term_string}` as the placeholder. Omit if no public search is
   * available yet.
   */
  searchUrlTemplate?: string;
}

/**
 * WebSite schema · used on the homepage to declare the site name for Google
 * and optionally a SearchAction for sitelinks search-box eligibility.
 *
 * Reference: https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox
 */
export function websiteSchema(
  options: WebSiteSchemaOptions = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: options.name ?? "Mapsly",
    url: CANONICAL_ORIGIN,
  };
  if (options.searchUrlTemplate) {
    base.potentialAction = {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: options.searchUrlTemplate,
      },
      "query-input": "required name=search_term_string",
    };
  }
  return base;
}

/* ------------------------------------------------------------------------ */
/* BreadcrumbList                                                            */
/* ------------------------------------------------------------------------ */

export interface BreadcrumbItem {
  /** Visible name of the breadcrumb (e.g. "For Agencies"). */
  name: string;
  /** Absolute URL or path of the breadcrumb's destination. */
  url: string;
}

/**
 * BreadcrumbList schema · helps Google show the breadcrumb trail in SERP.
 * Ship on every nested public page (e.g. `/biz/[slug]` once B.5 lands).
 *
 * Positions are 1-indexed per Schema.org spec. The first item should usually
 * be "Home" pointing at the canonical origin.
 *
 * Reference: https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
 */
export function breadcrumbSchema(
  items: readonly BreadcrumbItem[],
): Record<string, unknown> {
  if (items.length === 0) {
    throw new Error("breadcrumbSchema: items must be non-empty");
  }
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http")
        ? item.url
        : `${CANONICAL_ORIGIN}${item.url}`,
    })),
  };
}

/* ------------------------------------------------------------------------ */
/* FAQPage                                                                   */
/* ------------------------------------------------------------------------ */

export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * FAQPage schema · eligible for FAQ rich snippets in SERP. Ship on any page
 * with ≥ 3 Q&A entries (the B.1 landing's FAQ component is the primary user).
 *
 * Reference: https://developers.google.com/search/docs/appearance/structured-data/faqpage
 */
export function faqSchema(
  items: readonly FAQItem[],
): Record<string, unknown> {
  if (items.length === 0) {
    throw new Error("faqSchema: items must be non-empty");
  }
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

/* ------------------------------------------------------------------------ */
/* Helper · stringify for inline <script>                                    */
/* ------------------------------------------------------------------------ */

/**
 * JSON.stringify with the conservative settings we want for inline JSON-LD
 * (no pretty-print, no replacer that might mutate output). Wrap the result
 * with `dangerouslySetInnerHTML`. Centralised so any future hardening (e.g.
 * escaping `</script>` sequences) lands in one spot.
 */
export function jsonLdString(schema: Record<string, unknown>): string {
  // Escape closing-script sequences to defuse the only known XSS vector for
  // inline JSON-LD: a string field containing `</script>` would prematurely
  // close the wrapping <script> tag. The replacement keeps the JSON valid.
  return JSON.stringify(schema).replace(/<\/script/gi, "<\\/script");
}
