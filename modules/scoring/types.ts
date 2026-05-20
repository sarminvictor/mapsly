/**
 * Scoring module · type definitions
 *
 * D.2 · Mapsly Score is a 6-dimensional weighted composite. Each sub-score
 * is a 0–1 normalized value; the composite is a 0–10 number stored on
 * `BusinessSnapshot.mapslyScore` (see `prisma/schema.prisma`).
 *
 * The dimension keys match the denormalized columns on `BusinessSnapshot`
 * (reputationScore, communicationScore, profileCompletenessScore,
 * trustScore, pricingTransparencyScore, brandPresenceScore) so the
 * composite can be re-computed from a single row without joining other
 * tables.
 *
 * See:
 *   - CLAUDE.md §"Mapsly Score" — 6-dim composite contract
 *   - .claude/rules/testing.md §"Signal scoring" — 100% formula coverage
 *   - .claude/rules/signal-engineering.md — signal vocabulary
 *   - prisma/schema.prisma `BusinessSnapshot` — persisted columns
 */

/**
 * The six dimensions of the Mapsly Score. Order matters for UI rendering
 * (Maria's dashboard ScoreBreakdown component reads this array).
 *
 * Weights live in `mapsly-score.ts`; this file owns the vocabulary only.
 */
export const MAPSLY_SCORE_DIMENSIONS = [
  "reputation",
  "communication",
  "profileCompleteness",
  "trust",
  "pricingTransparency",
  "brandPresence",
] as const;

export type MapslyScoreDimension = (typeof MAPSLY_SCORE_DIMENSIONS)[number];

/**
 * Pre-normalized 0–1 sub-scores per dimension. The shape the composite
 * function actually consumes.
 *
 * Persisted directly on `BusinessSnapshot.{dimension}Score` columns so
 * trend queries don't need to re-derive from raw signals.
 */
export interface MapslyScoreSubScores {
  /** Rating × volume × recent-velocity composite. */
  readonly reputation: number;
  /** Owner reply rate × response latency. */
  readonly communication: number;
  /** GBP profile fields filled (phone, hours, photos, schema). */
  readonly profileCompleteness: number;
  /** Verified + claimed + age + profile-photo signals. */
  readonly trust: number;
  /** Pricing/services visibility on website + GBP. */
  readonly pricingTransparency: number;
  /** Website quality + ads + social + schema. */
  readonly brandPresence: number;
}

/**
 * Raw signals used to derive the reputation sub-score.
 * All fields nullable — missing fields contribute 0 to their component.
 */
export interface ReputationInputs {
  /** Google rating 0–5. */
  readonly rating: number | null;
  /** Total review count (saturates at REVIEW_COUNT_SATURATION). */
  readonly reviewCount: number | null;
  /** Reviews in the last 30 days (saturates at VELOCITY_SATURATION). */
  readonly velocityLast30d: number | null;
}

export interface CommunicationInputs {
  /** Fraction 0–1 of last-20 reviews with an owner response. */
  readonly replyRate: number | null;
  /** Median hours between review posted and owner reply. */
  readonly avgReplyLatencyHours: number | null;
}

export interface ProfileCompletenessInputs {
  readonly hasPhone: boolean | null;
  readonly hasWebsite: boolean | null;
  readonly hasHours: boolean | null;
  readonly photosCount: number | null;
  /** Has a recognizable category label in GBP. */
  readonly hasCategory: boolean | null;
  /** Has a Q&A section with at least one Q. */
  readonly hasQandA: boolean | null;
}

export interface TrustInputs {
  readonly verified: boolean | null;
  readonly claimed: boolean | null;
  /** Years since first indexed (0–10+ saturates at TRUST_AGE_SATURATION). */
  readonly businessAgeYears: number | null;
  readonly hasProfilePhoto: boolean | null;
  /** Has at least one owner reply in the last 90 days. */
  readonly hasRecentReply: boolean | null;
}

export interface PricingTransparencyInputs {
  /** Pricing page on website found. */
  readonly hasPricingPage: boolean | null;
  /** Services or menu list on website found. */
  readonly hasServicesList: boolean | null;
  /** GBP "Services" attribute populated. */
  readonly hasGbpServices: boolean | null;
}

export interface BrandPresenceInputs {
  /** Lighthouse Performance score 0–100. */
  readonly lighthousePerformance: number | null;
  /** Lighthouse SEO score 0–100. */
  readonly lighthouseSeo: number | null;
  /** LocalBusiness schema.org JSON-LD found. */
  readonly hasSchema: boolean | null;
  /** Currently running Meta or Google ads. */
  readonly hasActiveAds: boolean | null;
  /** At least one social profile linked from GBP. */
  readonly hasSocialLinks: boolean | null;
}
