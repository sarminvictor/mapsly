/**
 * Scoring v2 · pillar engine (pure)
 *
 * Derives the 5 page-aligned pillars (Reputation / Visibility / Profile /
 * Website / Advertising), each 0–10, and rolls them up into the consolidated
 * Mapsly Score (master, 0–10). Pure functions · no I/O · safe to call anywhere.
 *
 * MARKET-RELATIVE: most signals are graded by their percentile within the
 * business's local `CellReference` (the cell's distribution of that signal)
 * rather than a hardcoded threshold. When no cell reference is available (brand
 * new cell, thin sample) each signal degrades to an absolute heuristic so the
 * pillar still produces a sensible number.
 *
 * Signal typing (see scoring-v2 plan):
 *   - Hygiene (absolute): phone, website, hours, claimed, booking CTA, schema…
 *   - Relative (percentile vs cell): reviews, velocity, photos, share-of-voice,
 *     speed, ad spend…
 *   - Blend (floor + relative): rating, speed.
 *   - Defensive: brand-hijack.
 *
 * Invariants (tested in __tests__/pillars.test.ts):
 *   1. PILLAR_WEIGHTS sum to exactly 1.0 (asserted at module load).
 *   2. Every pillar + master is finite and in [0, 10] for ANY input, including
 *      all-null signals and a null cell reference.
 *   3. Sum of breakdown contributions equals master.
 *   4. The SAME business scores higher in a weaker cell than a stronger one
 *      (market-relativity holds).
 *   5. A non-advertiser is NOT penalized on Advertising when the cell's
 *      ad prevalence is low (the no-penalty floor).
 *
 * See:
 *   - modules/scoring/pillar-types.ts — shapes + the 5-pillar vocabulary
 *   - .claude/memory/scoring-v2-market-relative.md — the decided direction
 */

import { clamp01 } from "./sub-scores";
import {
  type Breakpoints,
  type CellReference,
  PILLARS,
  type Pillar,
  type PillarResult,
  type PillarSignals,
} from "./pillar-types";

export const PILLAR_SCORE_MIN = 0;
export const PILLAR_SCORE_MAX = 10;

/**
 * Pillar weights · MUST SUM TO 1.0 (asserted at module load + in tests).
 *
 * Rationale — weight = impact on who wins customers in the local market:
 *   - Reputation 0.30 — the dominant local factor: the final decision-maker,
 *     the strongest ranking signal Maria directly controls, and it compounds.
 *   - Visibility 0.25 — discovery. "If they can't find you nothing else
 *     matters", but it's largely DRIVEN by the others, so just under reputation
 *     to avoid double-counting.
 *   - Profile 0.15 — foundational but low-differentiation once complete.
 *   - Website 0.15 — conversion + secondary ranking.
 *   - Advertising 0.15 — a first-class, fast, controllable lever (NOT optional);
 *     market-relative so a non-advertiser is only "behind" when rivals advertise.
 *
 * Per-industry tuning (paid-heavy categories → Ads up) is a later phase.
 */
export const PILLAR_WEIGHTS: Readonly<Record<Pillar, number>> = Object.freeze({
  reputation: 0.3,
  visibility: 0.25,
  profile: 0.15,
  website: 0.15,
  advertising: 0.15,
});

// Self-check: weights must sum to 1.0 (within floating-point tolerance).
{
  const total = PILLARS.reduce((acc, p) => acc + PILLAR_WEIGHTS[p], 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(
      `[pillars] PILLAR_WEIGHTS must sum to 1.0; got ${total}. ` +
        `Edit modules/scoring/pillars.ts and rebalance.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Defensive helpers — pure, null-tolerant. NaN / Infinity / negative collapse
// to safe values so a corrupt upstream signal never produces a NaN pillar.
// ─────────────────────────────────────────────────────────────────────────────

/** Finite, non-negative number, else 0. */
function safeNum(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x) || x < 0) return 0;
  return x;
}

/** Nullable boolean → 0/1. */
function b(x: boolean | null | undefined): number {
  return x === true ? 1 : 0;
}

/** value / ceiling, clamped to [0, 1]. The absolute-fallback shape. */
function saturate(value: number | null | undefined, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return clamp01(safeNum(value) / ceiling);
}

/** Clamp a 0–10 pillar/master score; NaN / Infinity → 0. */
function clampScore(x: number): number {
  if (!Number.isFinite(x)) return PILLAR_SCORE_MIN;
  if (x < PILLAR_SCORE_MIN) return PILLAR_SCORE_MIN;
  if (x > PILLAR_SCORE_MAX) return PILLAR_SCORE_MAX;
  return x;
}

/** A breakpoint set is usable only if it's a real, monotone-ish spread. */
function isUsableBp(bp: Breakpoints | undefined): bp is Breakpoints {
  return (
    bp != null &&
    Number.isFinite(bp.p10) &&
    Number.isFinite(bp.p90) &&
    bp.p90 > bp.p10
  );
}

/**
 * Map a value to its 0–1 percentile within a cell distribution via piecewise-
 * linear interpolation across the 5 knots (cumulative positions 0.10…0.90).
 * Below p10 scales toward 0; above p90 caps at 0.95 (never overconfident 1.0).
 * Higher-is-better signals only — invert at the call site if ever needed.
 */
export function percentileRank(value: number, bp: Breakpoints): number {
  const knots: ReadonlyArray<readonly [number, number]> = [
    [0.1, bp.p10],
    [0.25, bp.p25],
    [0.5, bp.p50],
    [0.75, bp.p75],
    [0.9, bp.p90],
  ];
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  const v = safeNum(value);
  if (v <= first[1]) {
    if (first[1] <= 0) return 0.05;
    return clamp01((v / first[1]) * first[0]);
  }
  if (v >= last[1]) return 0.95;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i]!;
    const c = knots[i + 1]!;
    if (v >= a[1] && v <= c[1]) {
      const span = c[1] - a[1];
      const t = span <= 0 ? 0 : (v - a[1]) / span;
      return clamp01(a[0] + t * (c[0] - a[0]));
    }
  }
  return 0.5;
}

/** Percentile vs cell when a usable distribution exists, else absolute fallback. */
function relOrAbs(
  value: number | null | undefined,
  bp: Breakpoints | undefined,
  absFallback: (v: number) => number,
): number {
  const v = safeNum(value);
  if (isUsableBp(bp)) return percentileRank(v, bp);
  return clamp01(absFallback(v));
}

/** A search rank (1 = best) → 0–1 score; null / >ceiling / ≤0 → 0 (absent). */
function rankToScore(rank: number | null | undefined, ceiling = 20): number {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return 0;
  if (rank > ceiling) return 0;
  return clamp01((ceiling + 1 - rank) / ceiling);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pillars · each returns 0–10
// ─────────────────────────────────────────────────────────────────────────────

/**
 * REPUTATION · rating (blend) 40 · responsiveness (hygiene) 25 · volume (rel)
 * 20 · velocity (rel) 15. Rating blends an absolute floor (below 4★ is bad
 * anywhere) with the cell-relative position above it.
 */
export function computeReputationPillar(
  s: PillarSignals,
  cell: CellReference | null,
): number {
  const rating = safeNum(s.rating);
  const ratingAbs = clamp01((rating - 3) / 2); // 3★ → 0, 5★ → 1
  const ratingRel = isUsableBp(cell?.rating)
    ? percentileRank(rating, cell.rating)
    : ratingAbs;
  const ratingScore = clamp01(ratingAbs * 0.5 + ratingRel * 0.5);

  const responsiveness = clamp01(safeNum(s.replyRate)); // hygiene — just reply
  const volume = relOrAbs(s.reviewCount, cell?.reviewCount, (v) =>
    saturate(v, 200),
  );
  const velocity = relOrAbs(s.velocityLast30d, cell?.velocity, (v) =>
    saturate(v, 12),
  );

  const p01 = clamp01(
    ratingScore * 0.4 + responsiveness * 0.25 + volume * 0.2 + velocity * 0.15,
  );
  return p01 * PILLAR_SCORE_MAX;
}

/**
 * VISIBILITY · Maps presence 45 · share-of-demand (rel) 30 · organic 25.
 * Ranks are inherently relative already, so they stay absolute (rank → score);
 * share-of-voice carries the cell-relative blend.
 */
export function computeVisibilityPillar(
  s: PillarSignals,
  cell: CellReference | null,
): number {
  const maps = rankToScore(s.localPackRank, 20);
  const organic = rankToScore(s.organicRankBest, 20);
  const sov = relOrAbs(s.shareOfVoice, cell?.shareOfVoice, (v) =>
    clamp01(v / 60),
  ); // 60% share-of-voice ≈ market leader
  const p01 = clamp01(maps * 0.45 + sov * 0.3 + organic * 0.25);
  return p01 * PILLAR_SCORE_MAX;
}

/**
 * PROFILE · contact+hours basics (hygiene) 35 · verification (hygiene) 25 ·
 * photos (rel) 20 · categories 20. Mostly absolute table-stakes; photos are the
 * cell-relative "richness" topping.
 */
export function computeProfilePillar(
  s: PillarSignals,
  cell: CellReference | null,
): number {
  const basics = (b(s.hasPhone) + b(s.hasWebsite) + b(s.hasHours)) / 3;
  const verification = b(s.isClaimed); // claimed ≈ verified in current data
  const photos = relOrAbs(s.photoCount, cell?.photoCount, (v) =>
    saturate(v, 15),
  );
  const categories = clamp01(safeNum(s.categoryCount) / 3); // 1 = under-tuned, 3+ = tuned
  const p01 = clamp01(
    basics * 0.35 + verification * 0.25 + photos * 0.2 + categories * 0.2,
  );
  return p01 * PILLAR_SCORE_MAX;
}

/**
 * WEBSITE · conversion-readiness (hygiene) 35 · speed (blend) 35 ·
 * findability (hygiene) 30. Speed blends Google's absolute CWV target with the
 * cell-relative position.
 */
export function computeWebsitePillar(
  s: PillarSignals,
  cell: CellReference | null,
): number {
  const conversion = (b(s.hasBookingCta) + b(s.hasPhoneAboveFold)) / 2;

  const perf = safeNum(s.lighthousePerformance);
  const speedAbs = clamp01(perf / 100);
  const speedRel = isUsableBp(cell?.lighthousePerformance)
    ? percentileRank(perf, cell.lighthousePerformance)
    : speedAbs;
  const speed = clamp01(speedAbs * 0.5 + speedRel * 0.5);

  const seo = clamp01(safeNum(s.lighthouseSeo) / 100);
  const findability = clamp01((b(s.hasSchema) + b(s.napConsistent) + seo) / 3);

  const p01 = clamp01(conversion * 0.35 + speed * 0.35 + findability * 0.3);
  return p01 * PILLAR_SCORE_MAX;
}

/**
 * ADVERTISING · paid presence (rel, floored) 45 · brand protection (defensive)
 * 30 · coverage (rel) 25. Returns `applicable` (is the business advertising) as
 * a display flag — it does NOT change the weight.
 *
 * The no-penalty floor: presence and coverage are floored by `1 − adPrevalence`,
 * so in a cell where few rivals advertise, NOT advertising scores high (fine);
 * in a cell where many do, not advertising scores low (a real, honest gap).
 */
export function computeAdvertisingPillar(
  s: PillarSignals,
  cell: CellReference | null,
): { readonly score: number; readonly applicable: boolean } {
  const advertising = s.hasActiveAds === true;
  // Floor = "how OK is it to not advertise here". Known low-ad cell → high
  // floor (fine). Known high-ad cell → low floor (real gap). UNKNOWN market
  // (no cell data) → neutral 0.5, so we neither reward nor punish on no evidence.
  const adPrevKnown = cell != null && cell.adPrevalence != null;
  const adPrev = clamp01(safeNum(cell?.adPrevalence));
  const floor = adPrevKnown ? clamp01(1 - adPrev) : 0.5;

  const yourPresence = advertising
    ? Math.max(0.6, saturate(s.metaAdCount, 5))
    : 0;
  const presence = Math.max(yourPresence, floor);

  const brandProtection = s.brandHijack === true ? 0 : 1; // defensive (universal)

  const coverage = advertising
    ? relOrAbs(s.estMonthlyAdSpend, cell?.estMonthlyAdSpend, (v) =>
        saturate(v, 2000),
      )
    : floor;

  const p01 = clamp01(
    presence * 0.45 + brandProtection * 0.3 + coverage * 0.25,
  );
  return { score: p01 * PILLAR_SCORE_MAX, applicable: advertising };
}

/**
 * Compute all 5 pillars + the consolidated master from a business's signals and
 * its cell reference (null = grade against absolute fallbacks). Returns the
 * per-pillar breakdown whose contributions sum to the master.
 */
/** True if at least one of the values is present (not null/undefined). */
function anyPresent(
  ...vals: ReadonlyArray<number | boolean | null | undefined>
): boolean {
  return vals.some((v) => v != null);
}

/**
 * Compute all 5 pillars + the consolidated master. A pillar with NO input
 * signals is "unmeasured" → its score is `null` ("Not measured yet", not a
 * misleading 0) and it's excluded from the master, which re-normalizes over the
 * MEASURED pillars only. `master` is null when nothing is measured at all.
 * Breakdown contributions (re-normalized) sum to the master.
 */
export function computePillars(
  s: PillarSignals,
  cell: CellReference | null,
): PillarResult {
  const ads = computeAdvertisingPillar(s, cell);
  const raw: Record<Pillar, number> = {
    reputation: clampScore(computeReputationPillar(s, cell)),
    visibility: clampScore(computeVisibilityPillar(s, cell)),
    profile: clampScore(computeProfilePillar(s, cell)),
    website: clampScore(computeWebsitePillar(s, cell)),
    advertising: clampScore(ads.score),
  };
  const measured: Record<Pillar, boolean> = {
    reputation: anyPresent(
      s.rating,
      s.reviewCount,
      s.replyRate,
      s.velocityLast30d,
    ),
    visibility: anyPresent(
      s.localPackRank,
      s.organicRankBest,
      s.shareOfVoice,
      s.keywordsRanked,
    ),
    profile: anyPresent(
      s.hasPhone,
      s.hasWebsite,
      s.hasHours,
      s.isClaimed,
      s.photoCount,
      s.categoryCount,
    ),
    website: anyPresent(
      s.lighthousePerformance,
      s.lighthouseSeo,
      s.lcpSeconds,
      s.hasSchema,
      s.hasBookingCta,
      s.hasPhoneAboveFold,
      s.napConsistent,
    ),
    advertising: anyPresent(
      s.hasActiveAds,
      s.metaAdCount,
      s.estMonthlyAdSpend,
      s.brandHijack,
    ),
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const p of PILLARS) {
    if (measured[p]) {
      weightedSum += raw[p] * PILLAR_WEIGHTS[p];
      weightTotal += PILLAR_WEIGHTS[p];
    }
  }
  const master = weightTotal > 0 ? clampScore(weightedSum / weightTotal) : null;

  const scores: Record<Pillar, number | null> = {
    reputation: measured.reputation ? raw.reputation : null,
    visibility: measured.visibility ? raw.visibility : null,
    profile: measured.profile ? raw.profile : null,
    website: measured.website ? raw.website : null,
    advertising: measured.advertising ? raw.advertising : null,
  };
  const breakdown = PILLARS.map((p) => {
    const weight = PILLAR_WEIGHTS[p];
    const contribution =
      measured[p] && weightTotal > 0 ? (raw[p] * weight) / weightTotal : 0;
    return Object.freeze({ pillar: p, score: scores[p], weight, contribution });
  });

  return {
    reputation: scores.reputation,
    visibility: scores.visibility,
    profile: scores.profile,
    website: scores.website,
    advertising: scores.advertising,
    master,
    adsApplicable: ads.applicable,
    breakdown: Object.freeze(breakdown),
  };
}

/**
 * Inverse rank percentile · 90 means "top 10% of the cell". `rank` is 1-indexed
 * (1 = best). Matches the `msi_percentile` signal contract + the v2 headline
 * ("#5 of 38 · top 22%"). total ≤ 1 → 100 (a cell of one is its own leader).
 */
export function msiPercentile(rank: number, total: number): number {
  if (!Number.isFinite(rank) || !Number.isFinite(total) || total <= 1) {
    return total === 1 ? 100 : 0;
  }
  const clampedRank = Math.min(Math.max(rank, 1), total);
  return Math.round(((total - clampedRank) / (total - 1)) * 100);
}
