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

export {
  adVisibilityBonus,
  computeMsiScore,
  MSI_AD_BONUS,
  MSI_SCORE_MAX,
  MSI_VOLUME_BONUS,
  MSI_VOLUME_SATURATION,
  rankByMsiInMetro,
  rankByMsiInMetros,
  reviewVolumeBonus,
  type MsiInput,
  type MsiResult,
} from "./msi";

export {
  computeMatchScore,
  computeMatchScoreFromSnapshot,
  MATCH_SCORE_MAX,
  MATCH_SCORE_MIN,
  NEUTRAL_MAPSLY_SCORE,
  QUALITY_FLOOR,
  QUALITY_LIFT,
  rankByMatchScore,
  type MatchScoreBreakdown,
  type MatchScoreContribution,
  type MatchScoreInput,
  type RankByMatchScoreOptions,
  type RankedMatch,
} from "./match-score";
