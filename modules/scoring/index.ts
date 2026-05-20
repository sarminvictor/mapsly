/**
 * Scoring module · public surface
 *
 * Import from here, not from internal files. Hunter UI (D.4), Match Score
 * (D.5), the SMB dashboard's ScoreBreakdown (E.1), and the weekly
 * snapshot-write cron (C.9) all import from this barrel.
 */

export type {
  BrandPresenceInputs,
  CommunicationInputs,
  MapslyScoreDimension,
  MapslyScoreSubScores,
  PricingTransparencyInputs,
  ProfileCompletenessInputs,
  ReputationInputs,
  TrustInputs,
} from "./types";

export { MAPSLY_SCORE_DIMENSIONS } from "./types";

export {
  clamp01,
  deriveBrandPresenceScore,
  deriveCommunicationScore,
  derivePricingTransparencyScore,
  deriveProfileCompletenessScore,
  deriveReputationScore,
  deriveTrustScore,
  LIGHTHOUSE_PERFECT,
  PHOTOS_SATURATION,
  REPLY_LATENCY_BAD_HOURS,
  REPLY_LATENCY_PERFECT_HOURS,
  REVIEW_COUNT_SATURATION,
  TRUST_AGE_SATURATION,
  VELOCITY_SATURATION,
} from "./sub-scores";

export {
  computeMapslyScore,
  computeMapslyScoreBreakdown,
  computeMapslyScoreFromSnapshot,
  MAPSLY_SCORE_MAX,
  MAPSLY_SCORE_MIN,
  MAPSLY_SCORE_WEIGHTS,
  type MapslyScoreBreakdown,
  type MapslyScoreDimensionBreakdown,
  type SnapshotLikeSubScores,
} from "./mapsly-score";
