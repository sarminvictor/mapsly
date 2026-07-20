/**
 * Hand-rolled sitemap XML builder · consumed by `app/sitemap.xml/route.ts`.
 *
 * WHY NOT `app/sitemap.ts` (the metadata-route convention): under
 * `cacheComponents`, metadata routes are ALWAYS statically prerendered at
 * build — Next's exporter bypasses the static-gen bailout for them — so the
 * INC-27 NEXT_PHASE guard's empty result was baked into the shipped
 * /sitemap.xml (0 of the /biz URLs ever appeared; INC-2026-07-20-66). A
 * route handler marked request-time via `await connection()` regenerates
 * per request and can set CDN caching headers, which metadata routes can't.
 *
 * Everything here is a pure function of its inputs — no DB, no
 * `new Date()` (INC-09). URL construction reuses the canonical helpers
 * (`localizedPath`, `bizLocalizedPath`) so the en-CA casing fix (v0.19.36)
 * keeps a single home — hand-building locale prefixes here would recreate
 * that bug.
 *
 * Output shape mirrors what the metadata route emitted (verified against
 * the live 36-URL sitemap 2026-07-20): one `<url>` per (path, locale) pair,
 * each carrying the full `xhtml:link` alternate set (4 locales + x-default)
 * per Google's multilingual-sitemap guidance. The golden test in
 * `__tests__/sitemap-xml.test.ts` locks the static `<loc>` set.
 */

import { routing } from "@/i18n/routing";
import { bizLocalizedPath } from "@/modules/biz-profile/json-ld";

import { CANONICAL_ORIGIN, MARKETING_LAST_MODIFIED } from "./canonical";
import { LOCALE_TO_BCP47, localizedPath } from "./hreflang";

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface SitemapUrlEntry {
  /** Absolute URL of this entry. */
  loc: string;
  /** ISO-8601 timestamp (stored date formatted — never `new Date()`). */
  lastmod: string;
  changefreq: ChangeFrequency;
  priority: number;
  /** Full alternate set incl. self + x-default, absolute hrefs, emit order. */
  alternates: readonly { hreflang: string; href: string }[];
}

/** Structural input for biz entries (matches `BizSitemapEntry`). */
export interface BizSitemapInput {
  slug: string;
  lastModified: Date;
}

/* ------------------------------------------------------------------------ */
/* Static marketing paths (moved verbatim from the old app/sitemap.ts)       */
/* ------------------------------------------------------------------------ */

interface PublicPath {
  /** Logical (English) pathname from `i18n/routing.ts` pathnames. */
  path: string;
  /** Sitemap priority hint to crawlers · 0.0–1.0. */
  priority: number;
  /** Cadence hint to crawlers. */
  changeFrequency: ChangeFrequency;
}

/**
 * Static-path table. Add a row when a new marketing-surface route ships.
 * `/biz/[slug]` is enumerated dynamically via `buildBizEntries`.
 */
const PUBLIC_PATHS: readonly PublicPath[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  // The SMB landing: indexable and unlinked from nav + footer, so the sitemap
  // is the ONLY way Google discovers it. `/for-agencies` is deliberately absent
  // — it is byte-identical to `/` and canonicalises there, so submitting it
  // would just ask Google to crawl a URL we tell it to ignore.
  { path: "/for-businesses", priority: 0.8, changeFrequency: "weekly" },
  // WP6-7 · comparison pages (high-intent evaluator SEO surface).
  {
    path: "/compare/mapsly-vs-apollo",
    priority: 0.7,
    changeFrequency: "monthly",
  },
  {
    path: "/compare/mapsly-vs-gohighlevel",
    priority: 0.7,
    changeFrequency: "monthly",
  },
  {
    path: "/compare/mapsly-vs-leadswift-d7",
    priority: 0.7,
    changeFrequency: "monthly",
  },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/cookies", priority: 0.3, changeFrequency: "yearly" },
  { path: "/refunds", priority: 0.3, changeFrequency: "yearly" },
];

/* ------------------------------------------------------------------------ */
/* Builders                                                                  */
/* ------------------------------------------------------------------------ */

/** XML-escape every interpolated value — slugs/paths are URL-safe today, but
 *  escaping unconditionally is what keeps that assumption harmless. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Alternate set for one logical path: 4 locales + x-default, absolute. */
function staticAlternates(
  logicalPath: string,
): { hreflang: string; href: string }[] {
  const out = routing.locales.map((locale) => ({
    hreflang: LOCALE_TO_BCP47[locale],
    href: `${CANONICAL_ORIGIN}${localizedPath(logicalPath, locale)}`,
  }));
  out.push({
    hreflang: "x-default",
    href: `${CANONICAL_ORIGIN}${localizedPath(logicalPath, routing.defaultLocale)}`,
  });
  return out;
}

/** Alternate set for one biz slug: 4 locales + x-default, absolute. */
function bizAlternates(slug: string): { hreflang: string; href: string }[] {
  const out = routing.locales.map((locale) => ({
    hreflang: LOCALE_TO_BCP47[locale],
    href: `${CANONICAL_ORIGIN}${bizLocalizedPath(slug, locale)}`,
  }));
  out.push({
    hreflang: "x-default",
    href: `${CANONICAL_ORIGIN}${bizLocalizedPath(slug, routing.defaultLocale)}`,
  });
  return out;
}

/** The 36 static marketing entries (9 paths × 4 locales). */
export function buildStaticEntries(): SitemapUrlEntry[] {
  const entries: SitemapUrlEntry[] = [];
  for (const entry of PUBLIC_PATHS) {
    const alternates = staticAlternates(entry.path);
    for (const locale of routing.locales) {
      entries.push({
        loc: `${CANONICAL_ORIGIN}${localizedPath(entry.path, locale)}`,
        lastmod: MARKETING_LAST_MODIFIED,
        changefreq: entry.changeFrequency,
        priority: entry.priority,
        alternates,
      });
    }
  }
  return entries;
}

/** One entry per (gated business × locale) · 4 entries per business. */
export function buildBizEntries(
  biz: readonly BizSitemapInput[],
): SitemapUrlEntry[] {
  const entries: SitemapUrlEntry[] = [];
  for (const b of biz) {
    const alternates = bizAlternates(b.slug);
    const lastmod = b.lastModified.toISOString();
    for (const locale of routing.locales) {
      entries.push({
        loc: `${CANONICAL_ORIGIN}${bizLocalizedPath(b.slug, locale)}`,
        lastmod,
        changefreq: "weekly",
        priority: 0.6,
        alternates,
      });
    }
  }
  return entries;
}

/** Serialise entries into a complete urlset document. */
export function buildSitemapXml(entries: readonly SitemapUrlEntry[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];
  for (const e of entries) {
    lines.push("<url>");
    lines.push(`<loc>${xmlEscape(e.loc)}</loc>`);
    for (const alt of e.alternates) {
      lines.push(
        `<xhtml:link rel="alternate" hreflang="${xmlEscape(alt.hreflang)}" href="${xmlEscape(alt.href)}" />`,
      );
    }
    lines.push(`<lastmod>${xmlEscape(e.lastmod)}</lastmod>`);
    lines.push(`<changefreq>${e.changefreq}</changefreq>`);
    lines.push(`<priority>${String(e.priority)}</priority>`);
    lines.push("</url>");
  }
  lines.push("</urlset>");
  return lines.join("\n");
}
