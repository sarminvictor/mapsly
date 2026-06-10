/**
 * Public sitemap · `https://mapsly.ai/sitemap.xml`
 *
 * Strategy: enumerate every shipped public marketing path × every routing
 * locale, emit one entry per (path, locale) pair with `alternates.languages`
 * pointing at the other locale variants. This is the per-Google-docs preferred
 * shape for multilingual sitemaps — every URL declares its hreflang siblings
 * so Google can pick the right locale per searcher.
 *
 * Routes are gated on "shipped today" so the sitemap never contains 404s
 * (per `.claude/rules/seo.md` anti-patterns).
 *
 * B.5 addition · public business profile pages at `/biz/[slug]`. Same URL
 * path for every locale (slug is locale-agnostic); the locale prefix
 * varies. `listBizSitemapEntries` enumerates active businesses bounded
 * at 5000 (well under Google's 50,000-URL-per-sitemap cap). When the
 * index grows past 50k, split into `/sitemap-static.xml` +
 * `/sitemap-biz-[id].xml` via `app/sitemap.ts.config` (see Next 16 docs).
 *
 * Per INC-2026-05-19-09: no `new Date()` anywhere. `lastModified` for static
 * paths reads from `MARKETING_LAST_MODIFIED`; for biz profiles it's the
 * latest snapshot date (or business.updatedAt fallback) returned by the
 * cached query.
 *
 * Caching: `revalidate = 86_400` (24h). Marketing copy changes less than
 * weekly; biz profiles update on cron-driven snapshot writes via tagged
 * revalidate. The 24h sitemap refresh is plenty.
 */

import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { CANONICAL_ORIGIN, MARKETING_LAST_MODIFIED } from "@/lib/seo/canonical";
import { LOCALE_TO_BCP47, localizedPath } from "@/lib/seo/hreflang";
import { bizLocalizedPath } from "@/modules/biz-profile/json-ld";
import { listBizSitemapEntries } from "@/modules/biz-profile/queries";

export const revalidate = 86_400; // 24h · marketing-deploy cadence

interface PublicPath {
  /** Logical (English) pathname from `i18n/routing.ts` pathnames. */
  path: string;
  /** Sitemap priority hint to crawlers · 0.0–1.0. */
  priority: number;
  /** Cadence hint to crawlers. */
  changeFrequency: NonNullable<
    MetadataRoute.Sitemap[number]["changeFrequency"]
  >;
}

/**
 * Static-path table. Add a row when a new marketing-surface route ships.
 * `/biz/[slug]` is enumerated dynamically below.
 */
const PUBLIC_PATHS: readonly PublicPath[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/cookies", priority: 0.3, changeFrequency: "yearly" },
  { path: "/refunds", priority: 0.3, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // --- Static marketing pages ---
  for (const entry of PUBLIC_PATHS) {
    // Pre-compute every locale's absolute URL so the inner loop can build
    // each entry's `alternates.languages` block by referencing siblings.
    const urlsByBcp47: Record<string, string> = {};
    for (const locale of routing.locales) {
      urlsByBcp47[LOCALE_TO_BCP47[locale]] =
        `${CANONICAL_ORIGIN}${localizedPath(entry.path, locale)}`;
    }
    // x-default points at the default-locale URL.
    urlsByBcp47["x-default"] =
      `${CANONICAL_ORIGIN}${localizedPath(entry.path, routing.defaultLocale)}`;

    for (const locale of routing.locales) {
      entries.push({
        url: urlsByBcp47[LOCALE_TO_BCP47[locale]]!,
        lastModified: MARKETING_LAST_MODIFIED,
        changeFrequency: entry.changeFrequency,
        priority: entry.priority,
        alternates: { languages: urlsByBcp47 },
      });
    }
  }

  // --- Public business profiles · /biz/[slug] ---
  const bizEntries = await listBizSitemapEntries(5000);
  for (const biz of bizEntries) {
    const urlsByBcp47: Record<string, string> = {};
    for (const locale of routing.locales) {
      urlsByBcp47[LOCALE_TO_BCP47[locale]] =
        `${CANONICAL_ORIGIN}${bizLocalizedPath(biz.slug, locale)}`;
    }
    urlsByBcp47["x-default"] =
      `${CANONICAL_ORIGIN}${bizLocalizedPath(biz.slug, routing.defaultLocale)}`;

    for (const locale of routing.locales) {
      entries.push({
        url: urlsByBcp47[LOCALE_TO_BCP47[locale]]!,
        lastModified: biz.lastModified,
        changeFrequency: "weekly",
        priority: 0.6,
        alternates: { languages: urlsByBcp47 },
      });
    }
  }

  return entries;
}
