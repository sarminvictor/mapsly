// services/meta-ad-library · public surface.
//
// Daily competitor ad scan via Meta's `ads_archive` Graph API endpoint.
// Free at the API tier (Meta does not charge per call); we flow every
// invocation through cost-counter ($0 unit cost) anyway so the "no live
// API in user request path" invariant and the CronRun trail apply
// uniformly across all adapters.
//
// See `./ads-archive.ts` for the schema, paging, caching, and validation
// surface.

export {
  adsArchiveSearch,
  adsArchiveSearchUncached,
  parseBand,
  AdsArchiveQuerySchema,
  AdsArchiveRowSchema,
  AdActiveStatus,
  META_ADS_ARCHIVE_UNIT_COST_USD,
  __setFetchForTesting,
  __setTokenForTesting,
  type AdsArchiveQuery,
  type AdsArchiveRow,
  type AdsArchiveResult,
} from "./ads-archive";
