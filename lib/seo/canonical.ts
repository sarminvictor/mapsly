/**
 * Canonical origin + shared SEO constants.
 *
 * Why a constants file rather than inline literals: every public page has to
 * agree on the same canonical origin AND the same "last modified" date for
 * sitemap entries. Centralising both means one place to update when the
 * domain changes or when a marketing-wide refresh ships.
 *
 * Per INC-2026-05-19-09 (cacheComponents PPR forbids `new Date()` in server
 * components / metadata routes), the `MARKETING_LAST_MODIFIED` constant is a
 * frozen ISO string the autonomous loop updates on each marketing-affecting
 * merge. Do NOT replace with `new Date()` — that breaks the static prerender.
 *
 * If you need a live timestamp for some non-marketing surface, read it from a
 * client component or a dynamic source like `cookies()` / `headers()`.
 */

/**
 * Production origin · used in canonical URLs + structured data.
 *
 * MUST be the host that actually answers 200. Production serves `www`; the
 * apex 307s to it (`curl -sI https://mapsly.ai/` → 307 → https://www.mapsly.ai/),
 * and `lib/url/mapsly-public-url.ts` already force-rewrites apex→www for the
 * same reason. Pointing canonicals/hreflang/sitemap at the apex aimed every
 * SEO signal we emit at a redirecting URL — Google Search Central requires the
 * canonical to be the final, non-redirecting URL. Fixed 2026-07-15.
 *
 * Override per-environment with NEXT_PUBLIC_SITE_URL (no trailing slash).
 */
export const CANONICAL_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mapsly.ai";

/**
 * Frozen ISO timestamp used as `lastmod` in `lib/seo/sitemap-xml.ts` (the
 * static-entry builder behind `app/sitemap.xml/route.ts`) and as
 * `datePublished` / `dateModified` in structured data where a stable, static
 * date is acceptable.
 *
 * Bump on every marketing-affecting deploy. The autonomous loop updates this
 * value when shipping a task that touches a public route (B.1, B.2, B.3, B.4,
 * B.5, B.7, B.8). Manual bumps are fine for copy-only changes too.
 */
export const MARKETING_LAST_MODIFIED = "2026-05-20T00:00:00.000Z";

/**
 * Build an absolute URL on the canonical origin.
 *   absoluteUrl("/for-agencies") → "https://mapsly.ai/for-agencies"
 *   absoluteUrl("/")             → "https://mapsly.ai/"
 *
 * Always pass a leading-slash path. Throws on missing leading slash so we
 * never accidentally double-slash or strip the origin.
 */
export function absoluteUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(
      `absoluteUrl: path must start with '/'; received: ${JSON.stringify(path)}`,
    );
  }
  return `${CANONICAL_ORIGIN}${path}`;
}
