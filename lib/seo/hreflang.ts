/**
 * hreflang + canonical helpers · drive every public page's `alternates` block.
 *
 * Per `.claude/rules/seo.md` and `.claude/rules/i18n.md`, every public page
 * must declare:
 *   - a canonical URL on the production origin
 *   - hreflang `<link>`s for every supported locale + an `x-default`
 *
 * Doing this inline per-page (B.1 + privacy/terms/cookies do today) is
 * error-prone: a typo in one locale's URL silently drops it from Google's
 * regional index. Centralising the logic means every page calls a single
 * helper and the routing is the source of truth.
 *
 * Mapsly serves four locales (en-US default, es-US, en-CA, fr-CA). Pathnames
 * are translated per `i18n/routing.ts` (e.g. `/for-agencies` → `/para-agencias`
 * in Spanish). hreflang values are the BCP-47 region-tagged forms search
 * engines expect.
 *
 * Per INC-2026-05-19-09, no `new Date()` / `Date.now()` / `Math.random()` is
 * used anywhere here — every output is a pure function of inputs + routing.
 */

import { routing, type Locale } from "@/i18n/routing";
import { CANONICAL_ORIGIN } from "./canonical";

/* ------------------------------------------------------------------------ */
/* Locale mapping tables                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Routing locale → BCP-47 region tag used in hreflang attributes.
 *
 * Our routing slugs are short (`en`, `es`, `fr`) for nicer URLs. Search
 * engines prefer the full region tag so US English is distinguished from UK
 * English, etc. The mapping is explicit + exhaustive (no fallback) so adding
 * a new locale to `routing.locales` without updating this map is a build-time
 * TypeScript error.
 */
export const LOCALE_TO_BCP47: Record<Locale, string> = {
  en: "en-US",
  es: "es-US",
  "en-CA": "en-CA",
  fr: "fr-CA",
};

/**
 * Routing locale → URL slug (the segment that appears in the URL path).
 *
 * Default locale resolves to empty string (no prefix per `localePrefix:
 * "as-needed"`). The `en-CA` routing slug is lowercased to `en-ca` for URLs
 * because that's what `next-intl` emits + what existing pages in the repo
 * already use (see `app/[locale]/(marketing)/page.tsx` LOCALE_TO_PATH).
 */
export const LOCALE_TO_URL_SLUG: Record<Locale, string> = {
  en: "",
  es: "es",
  "en-CA": "en-ca",
  fr: "fr",
};

/** Iteration-friendly list mirroring `routing.locales`. */
export const ALL_LOCALES: readonly Locale[] = routing.locales;

/* ------------------------------------------------------------------------ */
/* Pathname resolution                                                       */
/* ------------------------------------------------------------------------ */

type PathnameValue = string | Partial<Record<Locale, string>>;

/**
 * For a logical (English) pathname, return the locale-specific URL fragment.
 *
 *   resolveTranslatedPath("/for-agencies", "en")    → "/for-agencies"
 *   resolveTranslatedPath("/for-agencies", "es")    → "/para-agencias"
 *   resolveTranslatedPath("/for-agencies", "en-CA") → "/for-agencies"
 *   resolveTranslatedPath("/for-agencies", "fr")    → "/pour-agences"
 *   resolveTranslatedPath("/", "en")                → "/"
 *
 * If the pathname is not in `routing.pathnames`, falls back to the input
 * (treats it as untranslated). Useful for one-off paths like `/biz/[slug]`
 * that have no translation table.
 */
export function resolveTranslatedPath(
  logicalPath: string,
  locale: Locale,
): string {
  const config = (routing.pathnames as Record<string, PathnameValue>)[
    logicalPath
  ];
  if (config == null) return logicalPath;
  if (typeof config === "string") return config;
  return config[locale] ?? logicalPath;
}

/**
 * Build the locale-prefixed URL path for a logical pathname.
 *
 *   localizedPath("/", "en")              → "/"
 *   localizedPath("/", "es")              → "/es"
 *   localizedPath("/", "en-CA")           → "/en-ca"
 *   localizedPath("/", "fr")              → "/fr"
 *   localizedPath("/for-agencies", "en")  → "/for-agencies"
 *   localizedPath("/for-agencies", "es")  → "/es/para-agencias"
 *   localizedPath("/for-agencies", "fr")  → "/fr/pour-agences"
 */
export function localizedPath(logicalPath: string, locale: Locale): string {
  const translated = resolveTranslatedPath(logicalPath, locale);
  const slug = LOCALE_TO_URL_SLUG[locale];
  if (!slug) return translated;
  if (translated === "/") return `/${slug}`;
  return `/${slug}${translated}`;
}

/* ------------------------------------------------------------------------ */
/* hreflang record builder                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Build the `alternates.languages` record for a Next.js `Metadata.alternates`
 * block. Includes one entry per locale (keyed by BCP-47 region tag) plus the
 * `x-default` entry pointing at the default locale.
 *
 *   buildHreflang("/")
 *     → {
 *         "en-US":     "/",
 *         "es-US":     "/es",
 *         "en-CA":     "/en-ca",
 *         "fr-CA":     "/fr",
 *         "x-default": "/",
 *       }
 *
 * Output values are relative paths (no origin). Next.js's Metadata API
 * canonicalises these against `metadataBase` at render. Keeping them relative
 * means the same output is correct in dev / preview / production.
 */
export function buildHreflang(logicalPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const locale of routing.locales) {
    result[LOCALE_TO_BCP47[locale]] = localizedPath(logicalPath, locale);
  }
  result["x-default"] = localizedPath(logicalPath, routing.defaultLocale);
  return result;
}

/* ------------------------------------------------------------------------ */
/* Full alternates block                                                     */
/* ------------------------------------------------------------------------ */

export interface AlternatesBlock {
  canonical: string;
  languages: Record<string, string>;
}

/**
 * Build a full `alternates` block for `Metadata`. The canonical URL is
 * absolute (origin-prefixed); hreflang entries are relative paths.
 *
 *   buildAlternates("/for-agencies", "en")
 *     → {
 *         canonical: "https://mapsly.ai/for-agencies",
 *         languages: {
 *           "en-US":     "/for-agencies",
 *           "es-US":     "/es/para-agencias",
 *           ...
 *           "x-default": "/for-agencies",
 *         },
 *       }
 */
export function buildAlternates(
  logicalPath: string,
  locale: Locale,
): AlternatesBlock {
  return {
    canonical: `${CANONICAL_ORIGIN}${localizedPath(logicalPath, locale)}`,
    languages: buildHreflang(logicalPath),
  };
}
