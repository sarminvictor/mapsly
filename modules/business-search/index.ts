/**
 * Business-search module barrel · agency ⌘K quick-lookup (F.11).
 *
 * Keep the public surface lean — the route handler imports
 * `searchBusinesses` + types; the client component imports types only
 * (it talks to the route handler over fetch, not direct).
 */

export { searchBusinesses, normalizeWebsiteToken } from "./query";
export {
  EMPTY_SEARCH_RESPONSE,
  MAX_MATCHES,
  MAX_QUERY_LEN,
  type BusinessMatch,
  type BusinessSearchResponse,
} from "./types";
