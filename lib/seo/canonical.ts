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

/** Production origin · used in canonical URLs + structured data. */
export const CANONICAL_ORIGIN = "https://mapsly.ai";

/**
 * Frozen ISO timestamp used as `lastModified` in `app/sitemap.ts` and as
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
