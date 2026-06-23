// modules/agency-portal/discover/signals.ts · pure read-model for the Discovery
// "Signals" view (Phase 9). Each Discovery business becomes one SignalRow that
// carries a few comparative signals (value + vs-cell percentile + a distribution
// band so <VsCellBar> can render it) plus its flagged expert findings (evidence
// chips). Kept PURE (no DB, no React) so the mapping is unit-testable — the repo
// tests logic, not rendered DOM.
//
// The cell distribution band (p10/p25/p50/p75/p90) is computed from the loaded
// cohort itself: the businesses in the Discovery's cells ARE the cell, so their
// own reviewCount distribution is a real, honest comparison set. When the cohort
// is too small (< 4) we cannot draw a meaningful distribution, so the bar is
// omitted and the row degrades to the raw value (graceful per the build rule).

/** Minimum cohort size before a percentile distribution is meaningful. */
export const MIN_COHORT_FOR_DISTRIBUTION = 4;

/** A business as loaded for the signals view (plain, serializable). */
export interface SignalBusinessInput {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  reviewCount: number | null;
  rating: number | null;
}

/** A flagged expert finding surfaced as an evidence chip. */
export interface SignalFindingInput {
  businessId: string;
  signalKey: string;
  confidence: string;
  explanation: string;
  group: string;
}

/** The distribution band <VsCellBar> needs (omitted when not computable). */
export interface CellBand {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** One comparative signal on a row, ready for <VsCellBar> (band may be null). */
export interface ComparativeSignal {
  key: string;
  /** Human label, e.g. "Reviews". */
  label: string;
  value: number;
  unit: string;
  percentile: number;
  /** Null → no distribution; the UI hides the bar and shows the raw value. */
  band: CellBand | null;
}

/** One evidence chip derived from a flagged PlaybookFinding. */
export interface FindingChip {
  signalKey: string;
  confidence: string;
  explanation: string;
  group: string;
}

/** A fully-mapped row for the SignalsTable. */
export interface SignalRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  signals: ComparativeSignal[];
  findings: FindingChip[];
}

/**
 * Linear-interpolated percentile of `value` within a sorted ascending sample.
 * Returns 0–100. An empty sample → 0. A single distinct value → 50 (centered).
 */
export function percentileOf(sortedAsc: number[], value: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  // count of samples strictly below + half of those equal (mid-rank) — robust to ties.
  let below = 0;
  let equal = 0;
  for (const s of sortedAsc) {
    if (s < value) below += 1;
    else if (s === value) equal += 1;
  }
  const pct = ((below + equal / 2) / n) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** The value at quantile `q` (0–1) of a sorted ascending sample (nearest-rank). */
export function quantile(sortedAsc: number[], q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const idx = Math.round((n - 1) * Math.max(0, Math.min(1, q)));
  return sortedAsc[idx];
}

/**
 * Compute the cell distribution band from a sample, or null when the cohort is
 * too small for a meaningful spread (degrade gracefully — hide the bar).
 */
export function cellBand(sample: number[]): CellBand | null {
  const valid = sample.filter((v) => Number.isFinite(v));
  if (valid.length < MIN_COHORT_FOR_DISTRIBUTION) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  return {
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
  };
}

/**
 * Map the loaded Discovery cohort + flagged findings into SignalRow[]. Pure.
 *
 *   - The reviews-vs-cell signal compares each business's reviewCount against
 *     the cohort's reviewCount distribution. When the cohort is too small the
 *     band is null and the UI hides the bar (graceful degradation).
 *   - Findings are grouped per business; only flagged ones are passed in (the
 *     caller filters status="flagged"), surfaced as evidence chips.
 */
export function buildSignalRows(
  businesses: SignalBusinessInput[],
  findings: SignalFindingInput[],
): SignalRow[] {
  const reviewSample = businesses
    .map((b) => b.reviewCount)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const sortedReviews = [...reviewSample].sort((a, b) => a - b);
  const reviewBand = cellBand(reviewSample);

  const findingsByBiz = new Map<string, FindingChip[]>();
  for (const f of findings) {
    const chip: FindingChip = {
      signalKey: f.signalKey,
      confidence: f.confidence,
      explanation: f.explanation,
      group: f.group,
    };
    const arr = findingsByBiz.get(f.businessId);
    if (arr) arr.push(chip);
    else findingsByBiz.set(f.businessId, [chip]);
  }

  return businesses.map((b) => {
    const signals: ComparativeSignal[] = [];
    const reviews = typeof b.reviewCount === "number" ? b.reviewCount : null;
    if (reviews !== null) {
      signals.push({
        key: "reviews",
        label: "Reviews",
        value: reviews,
        unit: "",
        percentile: percentileOf(sortedReviews, reviews),
        band: reviewBand,
      });
    }
    return {
      id: b.id,
      name: b.name,
      category: b.category,
      city: b.city,
      signals,
      findings: findingsByBiz.get(b.id) ?? [],
    };
  });
}

/**
 * Build the comparative signals for a SINGLE business against a cohort sample
 * (the rest of its cell). Used by the business-detail view, which loads one
 * business plus the cohort's reviewCount distribution. Pure — unit-testable.
 *
 * The cohort sample is the reviewCount of every business in the cell (including
 * this one); the band is omitted when the cohort is too small (graceful).
 * Returns an empty array when the business has no comparable value (null
 * reviewCount), matching `buildSignalRows`' behavior.
 */
export function buildSingleBusinessSignals(
  business: Pick<SignalBusinessInput, "reviewCount">,
  cohortReviewCounts: number[],
): ComparativeSignal[] {
  const reviews =
    typeof business.reviewCount === "number" &&
    Number.isFinite(business.reviewCount)
      ? business.reviewCount
      : null;
  if (reviews === null) return [];

  const sample = cohortReviewCounts.filter((v) => Number.isFinite(v));
  const sortedReviews = [...sample].sort((a, b) => a - b);
  return [
    {
      key: "reviews",
      label: "Reviews",
      value: reviews,
      unit: "",
      percentile: percentileOf(sortedReviews, reviews),
      band: cellBand(sample),
    },
  ];
}

/** Tailwind class fragment for a finding-confidence pill. */
export function confidencePillClass(confidence: string): string {
  switch (confidence.toLowerCase()) {
    case "high":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "medium":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}
