// modules/agency-portal/discover/signals.ts · pure read-model for the Discovery
// vs-cell comparative signals. Its LIVE consumers are the workbench + lead
// drawer (`resolveCellBands`/`cellBand`/`BandKey`/`percentileOf`, and the lists
// page's per-band cellBand calls) and `buildSingleBusinessSignals` on the
// business-detail view. Kept PURE (no DB, no React) so the mapping is
// unit-testable — the repo tests logic, not rendered DOM.
//
// NOTE (WP10-6): the standalone "Signals" table + its /discover/[id]/signals
// route were removed as dead (cannibalized into the workbench after WP5). The
// row-mapping helpers `buildSignalRows`/`SignalRow` that fed that table are kept
// here as tested pure functions (no route consumes them today) rather than
// deleted, since the file itself stays live via the exports above.
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

/**
 * WP6-1 · the numeric band keys the workbench + drawer render. `match` is the
 * per-lead composite; the rest are real comparative metrics with a cell
 * distribution. Extended beyond `reviews` (Phase 9) to the five moat bands:
 * rating, Lighthouse performance, organic-traffic estimate (share of voice),
 * Meta ad count, and years-on-Google (tenure).
 */
export type BandKey =
  | "match"
  | "reviews"
  | "rating"
  | "perf"
  | "organic"
  | "meta_ads"
  | "google_ads"
  | "tenure";

/**
 * WP6-1 · the per-band cohort samples the workbench collects from its own rows.
 * Each is the raw value for the metric across the loaded businesses; used as the
 * COHORT FALLBACK when the market-true CellMetric reference has no distribution
 * for that band (a thin/never-aggregated cell).
 */
export interface CohortSamples {
  match?: number[];
  reviews?: number[];
  rating?: number[];
  perf?: number[];
  organic?: number[];
  meta_ads?: number[];
  google_ads?: number[];
  tenure?: number[];
}

/**
 * WP6-1 · the market-true reference bands, sourced from the scoring-v2
 * `CellMetric.distributions` for the discovery's cell (via
 * `parseCellReference`). Each band, when present, is authoritative across every
 * Discovery of that cell — not just the ≤N-lead cohort loaded here. Keys that
 * the CellMetric doesn't carry (e.g. `match`, `tenure`) simply fall through to
 * the cohort. Shape mirrors `CellBand` so it drops straight into VsCellBar.
 */
export interface CellReferenceBands {
  rating?: CellBand | null;
  /** reviewCount distribution → the `reviews` band. */
  reviews?: CellBand | null;
  /** lighthousePerformance distribution → the `perf` band. */
  perf?: CellBand | null;
  /** shareOfVoice distribution → the `organic` band (organic-traffic proxy). */
  organic?: CellBand | null;
  /** Meta-ad-count distribution → the `meta_ads` band (when the cell tracks it).
   *  Google ads have no per-market distribution — they fall through to cohort. */
  meta_ads?: CellBand | null;
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

/** A fully-mapped comparative-signals row (fed the removed Signals table; kept
 *  as a tested pure shape — see the WP10-6 note in this file's header). */
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

/**
 * Ported `.pill` tone modifier for a finding-confidence pill (WP4-9). Returns
 * the agency design-system pill class suffix ("green" | "amber" | "") — rendered
 * as `pill ${confidencePillTone(c)}` — with the same green/amber/neutral
 * semantics as the old Tailwind version, in the portal's own dialect.
 */
export function confidencePillTone(confidence: string): "green" | "amber" | "" {
  switch (confidence.toLowerCase()) {
    case "high":
      return "green";
    case "medium":
      return "amber";
    default:
      return "";
  }
}

/**
 * WP6-1 · resolve the workbench's vs-cell bands with the MARKET-TRUE source
 * preferred over the cohort. For each of the six comparative band keys:
 *
 *   1. prefer the scoring-v2 `CellMetric` reference band (`reference[key]`) —
 *      it's the whole cell's distribution, authoritative across every Discovery
 *      of that market, so a 40-lead cohort's median can't skew the comparison;
 *   2. else fall back to the cohort self-distribution (`cellBand(cohort[key])`),
 *      which is only honest WITHIN one Discovery but is all we have for a cell
 *      the weekly aggregate hasn't reached yet (or a band CellMetric doesn't
 *      carry, like `match` + `tenure`);
 *   3. else omit the band (null) — the UI shows the raw value (graceful).
 *
 * Pure + no-DB by design (the caller loads the CellMetric row and passes the
 * parsed reference in), so the source-selection logic is unit-testable.
 */
export function resolveCellBands(
  cohort: CohortSamples,
  reference?: CellReferenceBands | null,
): Partial<Record<BandKey, CellBand>> {
  const out: Partial<Record<BandKey, CellBand>> = {};
  const keys: BandKey[] = [
    "match",
    "reviews",
    "rating",
    "perf",
    "organic",
    "meta_ads",
    "google_ads",
    "tenure",
  ];
  for (const key of keys) {
    // The reference only carries the market-aggregated bands; `match`/`tenure`/
    // `google_ads` aren't in CellMetric, so they always take the cohort path.
    const refBand =
      key === "match" || key === "tenure" || key === "google_ads"
        ? null
        : (reference?.[key as keyof CellReferenceBands] ?? null);
    if (refBand) {
      out[key] = refBand;
      continue;
    }
    const sample = cohort[key];
    const cohortBand = sample ? cellBand(sample) : null;
    if (cohortBand) out[key] = cohortBand;
  }
  return out;
}

/**
 * @deprecated Tailwind class fragment for a finding-confidence pill. Superseded
 * by `confidencePillTone` (WP4-9 · one design system). Retained only for the
 * existing unit test; no production surface renders Tailwind slate anymore.
 */
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
