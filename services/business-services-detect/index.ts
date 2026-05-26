/** Business-services detection · public API. */

export {
  suggestServicesFromGoogleCategories,
  type SuggestedService,
} from "./from-google";

export { detectFromPlaceTopics } from "./from-place-topics";

export { detectFromDescription } from "./from-description";

export {
  scrapeServicesFromWebsite,
  type ServicePageScrapeResult,
} from "./from-service-pages";

export {
  detectAndPersistServices,
  type DetectInput,
  type DetectResult,
} from "./detect-services";

export {
  MED_SPA_TAXONOMY,
  pickTaxonomyForCategories,
} from "./taxonomy-med-spa";

export type {
  ServiceCandidate,
  ServiceTaxonomyEntry,
  ServiceSourceHint,
} from "./types";
