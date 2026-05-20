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
 * (per `.claude/rules/seo.md` anti-patterns). When B.2 (`/for-agencies`),
 * B.3 (`/for-businesses`), B.4 (`/pricing`), and B.5 (`/biz/[slug]`) land,
 * add them to `PUBLIC_PATHS` (or to the dynamic block respectively).
 *
 * Per INC-2026-05-19-09: no `new Date()` anywhere. `lastModified` reads from
 * the `MARKETING_LAST_MODIFIED` constant in `lib/seo/canonical.ts` — the
 * autonomous loop bumps that string on each marketing-affecting deploy.
 *
 * Caching: `revalidate = 86_400` (24h). Marketing copy changes less than
 * weekly; the lastModified bump on deploy is the real freshness signal.
 *
 * Scaling: when biz profile pages (B.5) ship and we approach Google's
 * 50,000-URL-per-sitemap cap, split into `/sitemap-static.xml` +
 * `/sitemap-biz-[id].xml` via `app/sitemap.ts.config` (see Next 16 docs).
 */

import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { CANONICAL_ORIGIN, MARKETING_LAST_MODIFIED } from "@/lib/seo/canonical";
import { LOCALE_TO_BCP47, localizedPath } from "@/lib/seo/hreflang";

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
 * Only paths that exist on `main` today. Add new entries as B.2–B.5 ship.
 * Order is preserved in the emitted sitemap (homepage first, legal last).
 */
const PUBLIC_PATHS: readonly PublicPath[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/cookies", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

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

  return entries;
}
