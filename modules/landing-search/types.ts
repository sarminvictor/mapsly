/**
 * Landing-search · types for the PUBLIC /for-businesses hero autosuggest.
 *
 * A business owner types their name; we surface the ones we've already
 * analyzed (have an active `LandingPage`) and link straight to that
 * personalized landing (`/l/{slug}-{token}`). Result rows are intentionally
 * lean — just enough to disambiguate + navigate. No auth, no PII.
 */

/** One matched business that HAS an active landing page. */
export interface LandingMatch {
  /** Business display name. */
  name: string;
  /** City for disambiguation (two spas, same name, different city). */
  city: string | null;
  /**
   * Full path to the personalized landing: `/l/{slug}-{token}`.
   * Lives OUTSIDE the `[locale]` tree (middleware bypass) — navigate with a
   * plain anchor / `window.location`, never the next-intl `Link`.
   */
  landingPath: string;
}

/** Response envelope for `GET /api/marketing/landing-search?q=...`. */
export interface LandingSearchResponse {
  matches: LandingMatch[];
}

/** Empty response · too-short queries, validation failures, Prisma errors. */
export const EMPTY_LANDING_SEARCH: LandingSearchResponse = { matches: [] };

/** Max rows per query — fits one screen of the hero dropdown at 380px. */
export const MAX_LANDING_MATCHES = 6;

/** Hard cap on the query string (matches the route's Zod schema). */
export const MAX_LANDING_QUERY_LEN = 80;
