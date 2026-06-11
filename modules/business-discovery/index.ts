/**
 * Business discovery · public API.
 *
 * Imports come from here, never the individual files, so we can
 * restructure internals without touching callers.
 */

export {
  KNOWN_CATEGORIES,
  PHASE_1_LAUNCH_CITIES,
  getKnownCategory,
  type KnownCategory,
  type LaunchCity,
  type LaunchPhase,
} from "./known-categories";

export {
  mapsRowToPersist,
  persistBusinessRow,
  mintUniqueSlug,
  slugify,
  type PersistShape,
  type PersistOutcome,
  type BusinessSourceValue,
} from "./persist";

export { geocodeLocation, type GeocodeResult } from "./geocode";

export { pingValidateLocation, type PingValidateResult } from "./ping-validate";

export { runDiscoveryForLocation, type DiscoveryRunSummary } from "./run";

export {
  DFS_PAGE_SIZE,
  MAX_DISCOVERY_LIMIT,
  DEFAULT_DISCOVERY_LIMIT,
  clampLimit,
  nextPageLimit,
  estimateDiscoveryCostUsd,
} from "./pagination";

export {
  boundingBoxForCell,
  cellMembershipWhere,
  type BoundingBox,
  type CellGeometry,
} from "./cell-membership";
