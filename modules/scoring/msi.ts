/**
 * Market Share Index (MSI) · D.3
 *
 * MSI is Mapsly's within-metro ranking signal. Where the Mapsly Score
 * (D.2) tells you HOW GOOD a business is on absolute terms, the MSI tells
 * you WHERE IT RANKS in its local market — `#3 of 47 med-spas in Miami`.
 *
 * Maria's dashboard shows `MSI rank` as one of her hero KPIs (E.1). Tom's
 * Hunter (F.2) filters on it ("show me #1-#3 spas across 50 metros, that's
 * who's winning"). The agency-side market-position chart (F.7) renders
 * the distribution of MSI ranks per metro.
 *
 * The MSI score is a thin adjustment of the Mapsly Score:
 *
 *     msiScore = mapslyScore               // base 0-10
 *              + reviewVolumeBonus(rc)     // 0-MSI_VOLUME_BONUS
 *              + adVisibilityBonus(active) // 0 | MSI_AD_BONUS
 *
 * The adjustments push msiScore above 10 — that's fine because MSI is
 * never displayed as a raw number; we render the **rank** ("#3") not the
 * score. The score exists only to produce a stable order.
 *
 * Why volume + ads tip the ranking on top of the headline score:
 *   - **Review volume** is a market-share proxy. Two businesses can both
 *     hold a 4.8 rating; the one with 480 reviews has captured more of
 *     the local mind-share than the one with 48. Log-saturated at
 *     `MSI_VOLUME_SATURATION` so a small chain doesn't dominate a metro
 *     forever — once you're past 500 reviews the volume signal flattens.
 *   - **Ad visibility** is a present-tense intent-to-spend signal. A
 *     business with active Meta/Google ads is investing in customer
 *     acquisition NOW. They're harder for a prospect to displace and
 *     therefore "outrank" peers with the same score who aren't actively
 *     marketing. The bonus is small (0.3) so it never flips a 7.0
 *     business above an 8.0 business — it only resolves ties.
 *
 * Ranking is descending msiScore. Stable tie-break by `businessId` ASC so
 * rank assignments are deterministic across reruns (important for
 * incremental snapshot-writes — two adjacent businesses with the same
 * score shouldn't swap places every cron run).
 *
 * Pure function · no I/O · safe to call from anywhere. The weekly
 * snapshot-write cron (C.9) groups businesses by `(country, province,
 * city)` metro key, calls `rankByMsiInMetro` per group, and persists the
 * results to `BusinessSnapshot.msiRank` / `msiTotal`.
 *
 * Invariants tested:
 *   1. Empty input -> empty Map.
 *   2. Single business -> rank 1 of 1.
 *   3. Ordering matches msiScore descending.
 *   4. Ties broken deterministically by businessId ASC.
 *   5. Every business in input appears exactly once in output.
 *   6. `msiTotal` is identical across every entry in a single call.
 *   7. NaN / Infinity / negative mapslyScore -> contributes 0 (defensive).
 *   8. Negative reviewCount -> treated as 0.
 *
 * See:
 *   - CLAUDE.md "MSI" — product contract (visible in PRD as the metro
 *     leaderboard signal)
 *   - .claude/rules/signal-engineering.md — signal vocabulary
 *   - .claude/rules/testing.md "Signal scoring" — formula coverage
 *   - prisma/schema.prisma `BusinessSnapshot.{msiRank,msiTotal}`
 */

import { MAPSLY_SCORE_MAX, MAPSLY_SCORE_MIN } from "./mapsly-score";

// ----------------------------------------------------------------------------
// Constants · tuneable
// ----------------------------------------------------------------------------

/**
 * Review count at which the volume bonus saturates. Past this, more
 * reviews don't increase MSI position. Calibrated to 500 because typical
 * "category leader" businesses in a metro sit between 200-800 reviews;
 * 500 is the median. Saturating earlier would let a small-but-fast-growing
 * business get pinned beneath legacy incumbents; saturating later means
 * incumbents who've stopped growing keep an undeserved edge.
 */
export const MSI_VOLUME_SATURATION = 500;

/**
 * Maximum bonus added to mapslyScore from review volume. Small relative
 * to the 10-point base score so volume only resolves ties between
 * comparable businesses, doesn't flip rankings between clearly different
 * tiers (a 7.0 with 1000 reviews must NOT outrank an 8.0 with 50).
 */
export const MSI_VOLUME_BONUS = 0.5;

/**
 * Bonus added to mapslyScore if the business is currently running ads
 * (Meta or Google). Smaller than the volume bonus because ad signals are
 * binary (running vs not) and 0.3 is enough to resolve ties without
 * flipping major tiers.
 */
export const MSI_AD_BONUS = 0.3;

/**
 * Theoretical maximum msiScore (perfect Mapsly Score + max volume +
 * active ads). Exposed for tests + documentation; never used as a UI
 * bound because MSI is rendered as rank, not score.
 */
export const MSI_SCORE_MAX =
  MAPSLY_SCORE_MAX + MSI_VOLUME_BONUS + MSI_AD_BONUS;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * Input shape per business for MSI ranking. Sourced from the same row
 * the snapshot-write cron has in hand — `BusinessSnapshot` columns plus
 * the parent `Business.googlePlaceId` / `hasActiveAds` look-aside derived
 * from `AdLibraryEntry`.
 *
 * `businessId` doubles as the deterministic tie-break key, so it MUST be
 * unique within the call. The cron groups by metro key before calling,
 * so within-call uniqueness is naturally satisfied.
 */
export interface MsiInput {
  /** Unique business id. Used as the final tie-break key (ASC). */
  readonly businessId: string;
  /** 0-10 Mapsly Score from D.2. NaN / Infinity / negative -> 0. */
  readonly mapslyScore: number | null;
  /** Total review count (Business.reviewCount). Negative -> 0. */
  readonly reviewCount: number | null;
  /** Has at least one currently-active ad in Meta or Google libraries. */
  readonly hasActiveAds: boolean | null;
}

/**
 * Output shape per business. Mirrors the `BusinessSnapshot.msiRank` /
 * `msiTotal` columns the cron will persist.
 */
export interface MsiResult {
  readonly businessId: string;
  /** Composite ranking score (mapsly + bonuses). 0-MSI_SCORE_MAX. */
  readonly msiScore: number;
  /** 1-indexed rank within this call's input set. */
  readonly msiRank: number;
  /** Total businesses ranked in this call (same value for every entry). */
  readonly msiTotal: number;
}

// ----------------------------------------------------------------------------
// Helpers · pure, defensive
// ----------------------------------------------------------------------------

/**
 * Coerce a `number | null | undefined` to a non-negative finite number.
 * NaN / Infinity / negative / null -> 0. This is the defensive boundary
 * for upstream data that may be missing or corrupt.
 *
 * Intentionally not exported — internal to the MSI module so a future
 * change to its semantics doesn't ripple through the rest of `scoring/`.
 */
function safeNonNegative(value: number | null | undefined): number {
  if (value == null) return 0;
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return value;
}

/**
 * Compute the volume bonus contributed by a business's review count.
 *
 * Log-shaped so the first reviews matter more than the 500th. Saturates
 * at `MSI_VOLUME_SATURATION` to cap dominance of legacy incumbents.
 *
 * The shape uses `log1p(rc) / log1p(MSI_VOLUME_SATURATION)` because:
 *   - `log1p` handles `rc = 0` cleanly (returns 0).
 *   - Normalized by `log1p(SATURATION)` so `bonus(SATURATION)` approx MSI_VOLUME_BONUS.
 *   - Clamped above saturation so legacy 5000-review businesses don't
 *     exceed the cap.
 */
export function reviewVolumeBonus(reviewCount: number | null): number {
  const rc = safeNonNegative(reviewCount);
  if (rc === 0) return 0;
  const denom = Math.log1p(MSI_VOLUME_SATURATION);
  // denom > 0 since MSI_VOLUME_SATURATION > 0.
  const raw = Math.log1p(rc) / denom;
  const clamped = raw > 1 ? 1 : raw;
  return clamped * MSI_VOLUME_BONUS;
}

/**
 * Binary bonus: present if the business has currently-running ads.
 */
export function adVisibilityBonus(hasActiveAds: boolean | null): number {
  return hasActiveAds === true ? MSI_AD_BONUS : 0;
}

/**
 * Compute the composite MSI score for a single business. Pure, safe for
 * any input including null / NaN / Infinity / negative.
 *
 * The base score is clamped to the same `[0, MAPSLY_SCORE_MAX]` range as
 * Mapsly Score before bonuses are applied — a corrupt upstream value
 * (e.g. NaN) cannot leak into the ranking and produce a NaN msiScore.
 */
export function computeMsiScore(input: MsiInput): number {
  const baseRaw = input.mapslyScore;
  let base: number;
  if (baseRaw == null || !Number.isFinite(baseRaw)) {
    base = MAPSLY_SCORE_MIN;
  } else if (baseRaw < MAPSLY_SCORE_MIN) {
    base = MAPSLY_SCORE_MIN;
  } else if (baseRaw > MAPSLY_SCORE_MAX) {
    base = MAPSLY_SCORE_MAX;
  } else {
    base = baseRaw;
  }
  return (
    base +
    reviewVolumeBonus(input.reviewCount) +
    adVisibilityBonus(input.hasActiveAds)
  );
}

// ----------------------------------------------------------------------------
// Public · rank a metro's worth of businesses
// ----------------------------------------------------------------------------

/**
 * Rank the given businesses by MSI score within a single metro.
 *
 * Caller is responsible for grouping by metro key (the snapshot-write
 * cron groups by `(country, province, city)` before calling).
 *
 * Sort order: msiScore DESC, then businessId ASC as a stable tiebreak.
 * Determinism matters here — two adjacent businesses with identical
 * msiScore must keep the same relative rank across reruns, otherwise
 * `BusinessSnapshot.msiRank` flips every weekly cron and breaks trend
 * graphs.
 *
 * Returns `Map<businessId, MsiResult>` so callers can look up rank for
 * a specific business without re-scanning the array. Use `Array.from`
 * if you need the ordered list.
 *
 * Time: O(n log n) from the sort.
 * Space: O(n).
 */
export function rankByMsiInMetro(
  businesses: readonly MsiInput[],
): Map<string, MsiResult> {
  const total = businesses.length;
  const result = new Map<string, MsiResult>();
  if (total === 0) return result;

  // Pre-compute msiScore once so the comparator is cheap + side-effect-free.
  const scored = businesses.map((b) => ({
    businessId: b.businessId,
    msiScore: computeMsiScore(b),
  }));

  scored.sort((a, b) => {
    if (b.msiScore !== a.msiScore) return b.msiScore - a.msiScore;
    // Deterministic tiebreak — ASC by id so the lower-id business gets
    // the better rank when scores are exactly equal.
    if (a.businessId < b.businessId) return -1;
    if (a.businessId > b.businessId) return 1;
    return 0;
  });

  for (let i = 0; i < scored.length; i++) {
    const s = scored[i]!;
    result.set(s.businessId, {
      businessId: s.businessId,
      msiScore: s.msiScore,
      msiRank: i + 1,
      msiTotal: total,
    });
  }

  return result;
}

/**
 * Convenience: rank businesses across multiple metros in one call.
 *
 * `getMetroKey` produces the partition key — typically
 * `b => `${b.country}|${b.province}|${b.city}``. Businesses missing a
 * metro key (e.g. `null` city) are put in a synthetic `__unknown__`
 * bucket and ranked among themselves; this is conservative — a business
 * with no city shouldn't accidentally outrank a real metro leader, and
 * we don't want to silently drop it from the index.
 *
 * The output preserves the same Map shape as `rankByMsiInMetro` — keys
 * are global businessIds. Caller does not need to know about the metro
 * partitioning.
 */
export function rankByMsiInMetros<T extends MsiInput>(
  businesses: readonly T[],
  getMetroKey: (input: T) => string | null,
): Map<string, MsiResult> {
  const buckets = new Map<string, T[]>();
  for (const b of businesses) {
    const key = getMetroKey(b) ?? "__unknown__";
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(b);
  }

  const combined = new Map<string, MsiResult>();
  for (const bucket of buckets.values()) {
    const ranked = rankByMsiInMetro(bucket);
    for (const [bid, result] of ranked) {
      combined.set(bid, result);
    }
  }
  return combined;
}
