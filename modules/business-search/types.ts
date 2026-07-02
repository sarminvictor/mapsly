/**
 * Business-search · types for the global ⌘K quick-lookup (F.11).
 *
 * The agency portal's top-bar ⌘K shortcut opens a fuzzy search across the
 * Business index. Result rows are intentionally lean — the page that the
 * user lands on (prospect detail) renders the full picture; the picker
 * only needs enough to disambiguate "did I find the right one?".
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 conventions, even
 * though the search API is a route handler (uncached, no build-phase
 * issue), keeping the EMPTY-shape constant here lets the API route
 * return a stable shape on validation failure / errors without
 * scattering the shape across files.
 */

/**
 * A single matched business surfaced by the ⌘K search.
 *
 * Fields are the minimum the picker needs to render + navigate:
 *   - `id` — Business cuid, used as the route param `[businessId]`
 *   - `slug` — included so a future "open in new tab" affordance can
 *     prefer the slug form if we expose one later
 *   - `name` — the display label
 *   - `city` / `category` — disambiguators rendered as the secondary
 *     line (two spas with the same name in different cities)
 *   - `website` — optional, surfaced when the typed query matched the
 *     site host (so Tom knows we found the right brand by URL)
 */
export interface BusinessMatch {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  category: string;
  website: string | null;
  /**
   * The agency's most-recent ACTIVE discovery whose cells contain this
   * business (matched on `Business.cellKey`), or null when the agency hasn't
   * researched a market this business belongs to. Drives ⌘K's deep-link:
   * present → `/discover/[discoveryId]?lead=<id>` opens the drawer straight on
   * the evidence; null → the bare Discover flow (WP4-7).
   */
  discoveryId: string | null;
}

/**
 * Response envelope for `/api/agency/search?q=...`. Lean by design —
 * the picker renders the first 8 rows and never paginates (if Tom
 * needs more, he types more characters).
 */
export interface BusinessSearchResponse {
  query: string;
  matches: BusinessMatch[];
}

/**
 * Empty response · used for too-short queries, validation failures,
 * and Prisma errors (we degrade to "no matches" rather than 500).
 */
export const EMPTY_SEARCH_RESPONSE: BusinessSearchResponse = {
  query: "",
  matches: [],
};

/**
 * Max matches returned per query. Picked so the dropdown fits one
 * screen at the default 380px-min viewport without scrolling — Tom's
 * eye scans top-to-bottom, and a sub-second arrow-key cycle through 8
 * rows is faster than re-querying with a more specific term.
 */
export const MAX_MATCHES = 8;

/**
 * Hard cap on the query string · matches the Zod schema in the route
 * handler. Anything longer is almost certainly junk pasted by accident.
 */
export const MAX_QUERY_LEN = 80;
