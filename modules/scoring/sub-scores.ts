/**
 * Sub-score derivation · D.2
 *
 * Each dimension of the Mapsly Score is computed from a small set of raw
 * signals via these pure helpers. The output is always in [0, 1] and is
 * defensive about nullable / out-of-range inputs (NaN, negative, Infinity
 * all collapse to 0; values above the saturation collapse to 1).
 *
 * The composite function in `mapsly-score.ts` weights and sums these
 * sub-scores. The denormalized `BusinessSnapshot.{dim}Score` columns are
 * the cached output of these helpers — re-deriving once per weekly cron is
 * cheaper than joining raw tables on every dashboard read.
 *
 * See `prisma/schema.prisma` for the persistence shape and CLAUDE.md
 * §"Mapsly Score" for the dimension contract.
 */

import type {
  BrandPresenceInputs,
  CommunicationInputs,
  PricingTransparencyInputs,
  ProfileCompletenessInputs,
  ReputationInputs,
  TrustInputs,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Saturation thresholds — values at or above these contribute 1.0 to the
// underlying component. Calibration assumptions baked in here:
//
//   - 200 reviews ≈ established business with consistent foot traffic
//   - 12 reviews in 30 days ≈ healthy velocity for an SMB
//   - 10 years on Google ≈ "old enough that reputation is locked in"
//   - 6-hour median reply latency ≈ "responds within a business day"
//
// Calibration values come from the comparable-businesses dataset captured
// in C.0 dev seed data; adjust here (not in callers) if real-world drift
// is observed via the dashboard's score-distribution histogram.
// ─────────────────────────────────────────────────────────────────────────────
export const REVIEW_COUNT_SATURATION = 200;
export const VELOCITY_SATURATION = 12;
export const TRUST_AGE_SATURATION = 10;
export const REPLY_LATENCY_PERFECT_HOURS = 6;
export const REPLY_LATENCY_BAD_HOURS = 168; // 1 week
export const LIGHTHOUSE_PERFECT = 100;
export const PHOTOS_SATURATION = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Defensive helpers — every public function must accept null and odd inputs
// gracefully. Returning 0 for invalid input is safer than NaN propagating
// into the composite and silently corrupting Maria's dashboard.
// ─────────────────────────────────────────────────────────────────────────────

/** Clamp x to [0, 1]. NaN / Infinity collapse to 0. */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Coerce nullable / NaN / negative / Infinity numeric to a finite
 * non-negative number, default 0. Negative inputs collapse to 0 (callers
 * relying on this for `rating=-5` → 0 should know this is intentional,
 * not a bug; raw signal pipelines should never emit negatives but the
 * defensive collapse keeps the composite math safe when they do).
 */
function num(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x) || x < 0) return 0;
  return x;
}

/** Coerce nullable boolean to a 0/1 number. */
function bool(x: boolean | null | undefined): number {
  return x === true ? 1 : 0;
}

/** Convert raw score / saturation to a [0, 1] contribution. */
function saturate(value: number | null | undefined, ceiling: number): number {
  return clamp01(num(value) / ceiling);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REPUTATION · 25% weight
//    rating (0–5) · review count · recent velocity
//
// Component blend:
//   - rating normalized 0–1                       60%
//   - review count saturated at 200               25%
//   - recent velocity (last 30d) saturated at 12  15%
// ─────────────────────────────────────────────────────────────────────────────
export function deriveReputationScore(inputs: ReputationInputs): number {
  const ratingNorm = clamp01(num(inputs.rating) / 5);
  const countNorm = saturate(inputs.reviewCount, REVIEW_COUNT_SATURATION);
  const velocityNorm = saturate(inputs.velocityLast30d, VELOCITY_SATURATION);
  return clamp01(ratingNorm * 0.6 + countNorm * 0.25 + velocityNorm * 0.15);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMMUNICATION · 15% weight
//    reply rate (0–1) · median reply latency hours
//
// Component blend:
//   - reply rate                          70%
//   - reply latency (lower is better)     30%
//     · ≤ 6h  → 1.0
//     · 168h+ → 0.0 (1 week or worse)
//     · linear in between
// ─────────────────────────────────────────────────────────────────────────────
export function deriveCommunicationScore(inputs: CommunicationInputs): number {
  const replyRate = clamp01(num(inputs.replyRate));
  const latencyHours = num(inputs.avgReplyLatencyHours);
  const latencyScore =
    inputs.avgReplyLatencyHours == null
      ? 0
      : latencyHours <= REPLY_LATENCY_PERFECT_HOURS
        ? 1
        : latencyHours >= REPLY_LATENCY_BAD_HOURS
          ? 0
          : 1 -
            (latencyHours - REPLY_LATENCY_PERFECT_HOURS) /
              (REPLY_LATENCY_BAD_HOURS - REPLY_LATENCY_PERFECT_HOURS);
  return clamp01(replyRate * 0.7 + clamp01(latencyScore) * 0.3);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PROFILE COMPLETENESS · 15% weight
//    has phone · has website · has hours · photos · has category · Q&A
//
// Each yes/no flag = 1/6 of the score; photosCount is a saturating curve.
// Boolean flags weighted 5/6 in aggregate; photos contribute 1/6.
// ─────────────────────────────────────────────────────────────────────────────
export function deriveProfileCompletenessScore(
  inputs: ProfileCompletenessInputs,
): number {
  const flags =
    bool(inputs.hasPhone) +
    bool(inputs.hasWebsite) +
    bool(inputs.hasHours) +
    bool(inputs.hasCategory) +
    bool(inputs.hasQandA);
  const photosNorm = saturate(inputs.photosCount, PHOTOS_SATURATION);
  // 5 boolean flags share 5/6; photos own 1/6.
  return clamp01((flags / 5) * (5 / 6) + photosNorm * (1 / 6));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TRUST · 15% weight
//    verified · claimed · business age · profile photo · recent reply
//
// Component blend:
//   - verified (Google "Verified" badge)    25%
//   - claimed (owner-claimed listing)       20%
//   - business age (saturates at 10 years)  20%
//   - has profile photo                     15%
//   - has recent owner reply (last 90 days) 20%
// ─────────────────────────────────────────────────────────────────────────────
export function deriveTrustScore(inputs: TrustInputs): number {
  const verified = bool(inputs.verified);
  const claimed = bool(inputs.claimed);
  const ageNorm = saturate(inputs.businessAgeYears, TRUST_AGE_SATURATION);
  const profilePhoto = bool(inputs.hasProfilePhoto);
  const recentReply = bool(inputs.hasRecentReply);
  return clamp01(
    verified * 0.25 +
      claimed * 0.2 +
      ageNorm * 0.2 +
      profilePhoto * 0.15 +
      recentReply * 0.2,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PRICING TRANSPARENCY · 10% weight
//    pricing page · services list · GBP services attribute
//
// Three boolean flags; equal weight 1/3 each.
// ─────────────────────────────────────────────────────────────────────────────
export function derivePricingTransparencyScore(
  inputs: PricingTransparencyInputs,
): number {
  const flags =
    bool(inputs.hasPricingPage) +
    bool(inputs.hasServicesList) +
    bool(inputs.hasGbpServices);
  return clamp01(flags / 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. BRAND PRESENCE · 20% weight
//    Lighthouse performance + SEO · schema · ads · social
//
// Component blend:
//   - Lighthouse Performance (0–100)  30%
//   - Lighthouse SEO         (0–100)  20%
//   - LocalBusiness schema           20%
//   - Active ads (Meta or Google)    15%
//   - Social links from GBP          15%
// ─────────────────────────────────────────────────────────────────────────────
export function deriveBrandPresenceScore(inputs: BrandPresenceInputs): number {
  const perfNorm = clamp01(
    num(inputs.lighthousePerformance) / LIGHTHOUSE_PERFECT,
  );
  const seoNorm = clamp01(num(inputs.lighthouseSeo) / LIGHTHOUSE_PERFECT);
  const schema = bool(inputs.hasSchema);
  const ads = bool(inputs.hasActiveAds);
  const social = bool(inputs.hasSocialLinks);
  return clamp01(
    perfNorm * 0.3 + seoNorm * 0.2 + schema * 0.2 + ads * 0.15 + social * 0.15,
  );
}
