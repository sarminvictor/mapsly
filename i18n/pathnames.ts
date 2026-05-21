// Canonical per-locale URL derivation · single source of truth for
// alternates.languages and per-locale canonical URLs.
//
// Marketing pages used to hardcode a `LOCALE_TO_PATH` map per file. That's
// the kind of duplication that drifts: add a route translation in
// `routing.ts` and every page metadata block also has to be hand-edited or
// hreflang silently lies. This file derives the mapping from `routing.ts`
// once so every page just calls `getLocaleAlternates("/for-agencies")` and
// gets a Metadata-shaped object back.
//
// Per `.claude/rules/seo.md`: alternates.languages keys are BCP-47 region
// codes (en-US / es-US / en-CA / fr-CA), NOT next-intl's internal locale
// codes (en / es / en-CA / fr). The mapping is fixed here.

import { routing, type Locale } from "./routing";

/**
 * Map next-intl locale → BCP-47 region code used in `<html lang>` and
 * `alternates.languages`. Per `.claude/rules/i18n.md` table.
 *
 * Frozen at module load so a typo in a caller (e.g. "es-MX") fails fast.
 */
export const LOCALE_TO_BCP47: Readonly<Record<Locale, string>> = Object.freeze({
  en: "en-US",
  es: "es-US",
  "en-CA": "en-CA",
  fr: "fr-CA",
});

/**
 * The canonical pathnames (keys) declared in `routing.pathnames`. Routes
 * not in this set have no translations — passing them to `getLocalizedPath`
 * or `getLocaleAlternates` falls back to the canonical path for every
 * locale (graceful, but flagged by the test suite as a missing route).
 */
export type CanonicalPathname = keyof typeof routing.pathnames;

type PathnameConfig = string | Record<string, string>;

const pathnameConfigs = routing.pathnames as Record<string, PathnameConfig>;

function resolveLocalePathSegment(
  canonicalPath: string,
  locale: Locale,
): string {
  const config = pathnameConfigs[canonicalPath];
  if (config === undefined) {
    // Defensive: callers should only pass keys that exist in routing.
    // Returning the raw canonical keeps the URL sensible if someone passes
    // an unmapped path. The test suite asserts every page-passed path
    // is mapped, so this branch only fires for unregistered routes.
    return canonicalPath;
  }
  if (typeof config === "string") return config;
  return config[locale] ?? config[routing.defaultLocale] ?? canonicalPath;
}

/**
 * Build the locale-prefixed URL for a canonical pathname.
 *
 * Honors `routing.localePrefix === "as-needed"`:
 * - Default locale (`en`) gets no prefix.
 * - All other locales get `/{lowercased-locale-code}` prepended.
 *
 * The root path `/` is special: prefixed locales get `/{locale}` (no
 * trailing path), not `/{locale}/`.
 */
export function getLocalizedPath(
  canonicalPath: string,
  locale: Locale,
): string {
  const segment = resolveLocalePathSegment(canonicalPath, locale);
  const isDefault = locale === routing.defaultLocale;
  const isAsNeeded = routing.localePrefix === "as-needed";

  // The default locale never gets prefixed (with "as-needed"). For other
  // strategies (always / never), see the next-intl docs — we don't ship
  // either, but the branch documents intent.
  if (isDefault && isAsNeeded) return segment;

  const prefix = `/${locale.toLowerCase()}`;
  if (segment === "/") return prefix;
  return `${prefix}${segment}`;
}

/**
 * Build the `alternates.languages` value for Next's Metadata API.
 *
 * Keys are BCP-47 region codes; values are the locale-prefixed paths.
 * `x-default` points at the default-locale path so search engines have a
 * fallback for unrecognized locales (per `.claude/rules/seo.md`).
 */
export function getLocaleAlternates(
  canonicalPath: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of routing.locales) {
    const bcp47 = LOCALE_TO_BCP47[locale];
    out[bcp47] = getLocalizedPath(canonicalPath, locale);
  }
  out["x-default"] = getLocalizedPath(canonicalPath, routing.defaultLocale);
  return out;
}

/**
 * Build a `Record<Locale, string>` mapping every locale to its prefixed
 * path. Useful when the caller wants to look up by internal locale code
 * (not BCP-47) — e.g. picking the current locale's path for the canonical
 * + OpenGraph url fields.
 */
export function getPathsByLocale(
  canonicalPath: string,
): Record<Locale, string> {
  const out = {} as Record<Locale, string>;
  for (const locale of routing.locales) {
    out[locale] = getLocalizedPath(canonicalPath, locale);
  }
  return out;
}
