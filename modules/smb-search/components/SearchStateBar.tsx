// Server component · the 4-cell hero state bar at the top of
// /(smb)/search. Inspired by the canonical mockup at
// _design/product/search.html.
//
// Shows Maria the four headline numbers in plain English:
//   1. Total searches/mo across her tracked keywords (demand)
//   2. Estimated visits she gets from those (supply)
//   3. # keywords she ranks top 3 (Maps OR organic)
//   4. # keywords tracked total (denominator)
//
// All numbers are pre-computed in modules/smb-search/queries.ts ·
// the component is pure presentation.

import * as React from "react";

export interface SearchStateBarLabels {
  /** Row 1, col 1 · "Total searches/mo" */
  totalSearches: string;
  /** Row 1, col 2 · "Visits you likely get" */
  estimatedVisits: string;
  /** Row 1, col 3 · "Free traffic value" */
  trafficValue: string;
  /** Row 2, col 1 · "Top 3 keywords" */
  inTopThree: string;
  /** Row 2, col 2 · "Customers you miss" */
  missedCustomers: string;
  /** Row 2, col 3 · "Best spot in Maps" */
  bestSpot: string;
  /** "of {total} keywords" · `{total}` is replaced inline. */
  inTopThreeSublabel: string;
  /** "Per month" · sublabel for the missed-customers cell. */
  missedCustomersSublabel: string;
  /** "What Google Ads would cost" · sublabel for traffic-value cell. */
  trafficValueSublabel: string;
  /** Sub-line under the best-spot value · "for '{keyword}'" replaced
   *  inline. When Maria isn't in Maps anywhere, the page passes the
   *  `bestSpotNoneSublabel` instead. */
  bestSpotSublabel: string;
  /** Sub-line under best-spot when Maria isn't ranked anywhere yet. */
  bestSpotNoneSublabel: string;
  /** Sub-line under best-spot when Maps SERP scan never ran for this
   *  business · TRUTHFUL framing per the PO review · "Scanning this
   *  week" instead of misleading "Not in Maps yet". */
  bestSpotNotScannedSublabel: string;
  /** Big-number text shown when Maria isn't ranked in Maps at all. */
  bestSpotNoneValue: string;
  /** Tip on the totalSearches cell. */
  totalSearchesTip: string;
  /** Tip on the visits cell. */
  estimatedVisitsTip: string;
  /** Tip on the traffic-value cell. */
  trafficValueTip: string;
  /** Tip on the missed-customers cell. */
  missedCustomersTip: string;
}

export interface SearchStateBarProps {
  totalSearchVolume: number;
  totalEstimatedVisits: number;
  /** Σ DfS estimated_paid_traffic_cost · the dollar value of the
   *  visits Maria gets for free. Renders as "$X.Xk/mo" or "$XXX/mo". */
  totalEstTrafficUsd: number;
  topThreeKeywords: number;
  tracked: number;
  /** Maria's best (lowest) Maps rank across all tracked keywords ·
   *  null when she's not in any Maps result. */
  bestMapsRank: number | null;
  /** The keyword whose Maps rank equals bestMapsRank · for the
   *  sublabel "for '{keyword}'". null when bestMapsRank is null. */
  bestMapsKeyword: string | null;
  /** Sum of est-patients-lost across all tracked keywords. */
  missedCustomers: number;
  /** Whether ANY Maps SERP scan has ever run for this business. False
   *  flips the best-spot sublabel to the truthful "Scanning this week"
   *  copy instead of "Not in Maps yet". */
  hasMapsScans: boolean;
  labels: SearchStateBarLabels;
}

/** Format a count "1,234" using en-US separators · keeps the numbers
 *  scannable. Locale-aware formatting can come later if i18n needs it. */
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Render the traffic-value cell as compact USD: "$56.40", "$1.2k",
 *  "$24k". Keeps the cell narrow so it fits the 3-column grid. */
function fmtUsd(n: number): string {
  if (n < 10) return `$${n.toFixed(2)}`;
  if (n < 1000) return `$${Math.round(n)}`;
  return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
}

export function SearchStateBar({
  totalSearchVolume,
  totalEstimatedVisits,
  totalEstTrafficUsd,
  topThreeKeywords,
  tracked,
  bestMapsRank,
  bestMapsKeyword,
  missedCustomers,
  hasMapsScans,
  labels,
}: SearchStateBarProps) {
  const visitsCapturePct =
    totalSearchVolume > 0
      ? Math.round((totalEstimatedVisits / totalSearchVolume) * 100)
      : 0;

  const bestSpotValue =
    bestMapsRank != null ? `#${bestMapsRank}` : labels.bestSpotNoneValue;
  // Truthful copy · "Scanning this week" when we never asked Google Maps
  // for this business, vs "Not in Maps yet" when we asked and she was
  // genuinely absent. The page sets hasMapsScans from mapsScanCount > 0.
  const bestSpotSublabel =
    bestMapsRank != null && bestMapsKeyword
      ? labels.bestSpotSublabel.replace("{keyword}", bestMapsKeyword)
      : hasMapsScans
        ? labels.bestSpotNoneSublabel
        : labels.bestSpotNotScannedSublabel;
  const bestSpotTone =
    bestMapsRank == null
      ? "warn"
      : bestMapsRank <= 3
        ? "good"
        : bestMapsRank <= 10
          ? "neutral"
          : "warn";

  // 2×3 desktop grid · 1 col on narrow screens.
  // Row 1: demand → visits → value (the funnel)
  // Row 2: wins   → gaps   → benchmark (the scoreboard)
  return (
    <section
      aria-label="Search visibility totals"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "20px 24px",
        marginBottom: 24,
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: "20px 24px",
        boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
      }}
      className="smb-search-state-bar"
    >
      {/* Row 1 · the funnel */}
      <StateCell
        label={labels.totalSearches}
        value={fmt(totalSearchVolume)}
        sublabel={""}
        tip={labels.totalSearchesTip}
        tone="neutral"
      />
      <StateCell
        label={labels.estimatedVisits}
        value={fmt(totalEstimatedVisits)}
        sublabel={`${visitsCapturePct}% of demand`}
        tip={labels.estimatedVisitsTip}
        tone={totalEstimatedVisits > 0 ? "good" : "warn"}
      />
      <StateCell
        label={labels.trafficValue}
        value={fmtUsd(totalEstTrafficUsd)}
        sublabel={labels.trafficValueSublabel}
        tip={labels.trafficValueTip}
        tone={totalEstTrafficUsd > 0 ? "good" : "neutral"}
      />

      {/* Row 2 · the scoreboard */}
      <StateCell
        label={labels.inTopThree}
        value={fmt(topThreeKeywords)}
        sublabel={labels.inTopThreeSublabel.replace("{total}", fmt(tracked))}
        tip=""
        tone={topThreeKeywords > 0 ? "good" : "neutral"}
      />
      <StateCell
        label={labels.missedCustomers}
        value={fmt(missedCustomers)}
        sublabel={labels.missedCustomersSublabel}
        tip={labels.missedCustomersTip}
        tone={missedCustomers > 0 ? "warn" : "good"}
      />
      <StateCell
        label={labels.bestSpot}
        value={bestSpotValue}
        sublabel={bestSpotSublabel}
        tip=""
        tone={bestSpotTone}
      />
    </section>
  );
}

function StateCell({
  label,
  value,
  sublabel,
  tip,
  tone,
}: {
  label: string;
  value: string;
  sublabel: string;
  tip: string;
  tone: "neutral" | "good" | "warn";
}) {
  const valueColor =
    tone === "good"
      ? "var(--color-success, #2d8659)"
      : tone === "warn"
        ? "var(--color-coral)"
        : "var(--color-text)";
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--color-text-3)",
          marginBottom: 8,
        }}
      >
        {label}
        {tip ? (
          <span
            title={tip}
            aria-label={tip}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "var(--color-bg-3)",
              color: "var(--color-text-3)",
              fontSize: 9,
              fontWeight: 700,
              marginLeft: 6,
              cursor: "help",
              fontFamily: "var(--font-mono)",
            }}
          >
            i
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 1,
          color: valueColor,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      {sublabel ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--color-text-3)",
            marginTop: 6,
          }}
        >
          {sublabel}
        </div>
      ) : null}
    </div>
  );
}
