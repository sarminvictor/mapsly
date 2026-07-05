// services/dom-fetcher · public surface.
//
// The Apify-backed "Cloudflare-busting DOM fetcher" adapter. Renders a real
// browser through a residential proxy, clears Cloudflare, and returns the DOM
// for one or many URLs. Every downstream parse (contacts, tech, services, AI)
// runs over that single fetched DOM. Source actor: apify-actors/dom-fetcher/.
//
// All calls run via services/apify/client.ts which enforces the "no live API in
// user path" invariant and bills the run's metered Apify usage to the open
// CronRun.

export {
  fetchDoms,
  fetchDomsForCell,
  fetchLighthouse,
  DomFetchInputSchema,
  DOM_FETCHER_ACTOR_ID,
  CHUNK_SIZE,
  SINGLE_URL_MEMORY_MB,
  BATCH_MEMORY_MB,
  type DomFetchInput,
  type DomResult,
  type FetchDomsResult,
  type FetchDomsForCellOptions,
  type ActorLighthouse,
  type FetchLighthouseResult,
  type FetchLighthouseOptions,
} from "./fetcher";

export {
  freeFetchDom,
  isBlockedResponse,
  type FreeFetchResult,
  type FreeFetchOptions,
} from "./free-fetch";

export {
  classifyDomFetch,
  domFetchReachedContent,
  domFetchIsRetryable,
  DOM_EMPTY_BYTE_THRESHOLD,
  type DomFetchOutcome,
  type DomFetchOutcomeInput,
} from "./outcome";

export {
  DOM_CHUNK_SIZE,
  DOM_MEMORY_MB,
  DOM_MAX_CONCURRENCY,
  CONTACTS_FRESHNESS_DAYS,
  LIGHTHOUSE_FRESHNESS_DAYS,
  WALLED_LIGHTHOUSE_LIMIT,
  DOM_RUN_COST_CEILING_USD,
  LIGHTHOUSE_RUN_COST_CEILING_USD,
} from "./scale";
