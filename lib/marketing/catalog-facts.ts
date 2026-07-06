/**
 * Marketing catalog facts · curated, aspirational figures for public/hero copy.
 *
 * These are NOT live DB counts. They describe the *intended* scale of the
 * Mapsly catalog and are safe to render in marketing surfaces (hero stats,
 * landing pages) without a request-path DB read (no-live-API) — and without
 * over-promising a realized count the DB can't yet back.
 */

/**
 * Local businesses mapped on Google, per the curated marketing catalog.
 *
 * Aspirational marketing figure — the target catalog size, NOT a live count of
 * `Business` rows. Do NOT wire this to a live DB count: the catalog isn't fully
 * realized, and hero stats must not hit the DB on the request path.
 */
export const INDEXED_BUSINESSES = 2_100_000;
