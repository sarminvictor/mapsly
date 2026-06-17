/**
 * Landing-search module barrel · public /for-businesses hero autosuggest.
 *
 * The route handler imports `searchLandings` + types; the client component
 * imports types only (it talks to the route over fetch, not direct).
 */

export { searchLandings } from "./query";
export {
  EMPTY_LANDING_SEARCH,
  MAX_LANDING_MATCHES,
  MAX_LANDING_QUERY_LEN,
  type LandingMatch,
  type LandingSearchResponse,
} from "./types";
