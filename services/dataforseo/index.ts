// services/dataforseo · public surface.
//
// Six Live-tier adapters covering every DataForSEO endpoint Mapsly uses:
//
//   - maps-search       · /v3/business_data/business_listings/search/live
//   - serp-organic      · /v3/serp/google/organic/live/advanced
//   - serp-local-pack   · /v3/serp/google/maps/live/advanced
//   - reviews           · /v3/business_data/google/reviews/live
//   - keyword-volume    · /v3/keywords_data/google_ads/search_volume/live
//   - lighthouse        · /v3/on_page/lighthouse/live/json
//
// All adapters share `./client.ts` for transport (auth, retry, timeout,
// envelope unwrap). All adapters wrap the inner call with `withCostCounter`
// + `kvCache` so the "no live API in user path" invariant and the 24h
// dedup window apply uniformly.
//
// Standard-queue (task_post + task_get) is the 10× cheaper alternative —
// not yet implemented. Tracked as a follow-up. See `./pricing.ts`.

export {
  dataforSeoPost,
  DataForSeoError,
  __setFetchForTesting,
  __setCredentialsForTesting,
  __setSleepForTesting,
  type DataForSeoEnvelope,
  type DataForSeoPostOptions,
} from "./client";

export { DATAFORSEO_UNIT_COST_USD, type DataForSeoOperation } from "./pricing";

export {
  mapsSearch,
  mapsSearchUncached,
  MapsSearchQuerySchema,
  MapsBusinessRowSchema,
  type MapsSearchQuery,
  type MapsBusinessRow,
  type MapsSearchResult,
} from "./maps-search";

export {
  serpOrganic,
  serpOrganicUncached,
  SerpOrganicQuerySchema,
  SerpOrganicItemSchema,
  type SerpOrganicQuery,
  type SerpOrganicItem,
  type SerpOrganicResult,
} from "./serp-organic";

export {
  serpLocalPack,
  serpLocalPackUncached,
  SerpLocalPackQuerySchema,
  SerpMapsItemSchema,
  type SerpLocalPackQuery,
  type SerpMapsItem,
  type SerpLocalPackResult,
} from "./serp-local-pack";

export {
  reviewsPull,
  reviewsPullUncached,
  ReviewsQuerySchema,
  ReviewItemSchema,
  type ReviewsQuery,
  type ReviewItem,
  type ReviewsPullResult,
} from "./reviews";

export {
  reviewsTaskPost,
  reviewsTaskGet,
  buildReviewsPingbackUrl,
  ReviewsTaskPostQuerySchema,
  type ReviewsTaskPostQuery,
  type ReviewsTaskGetResult,
} from "./reviews-task";

export {
  keywordVolume,
  keywordVolumeUncached,
  KeywordVolumeQuerySchema,
  KeywordVolumeRowSchema,
  type KeywordVolumeQuery,
  type KeywordVolumeRow,
  type KeywordVolumeResult,
} from "./keyword-volume";

export {
  lighthouseAudit,
  lighthouseAuditUncached,
  LighthouseQuerySchema,
  type LighthouseQuery,
  type LighthouseAuditResult,
} from "./lighthouse";
