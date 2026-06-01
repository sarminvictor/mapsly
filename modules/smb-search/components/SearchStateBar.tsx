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
  /** Row 2, col 1 · "Top 3 in Search" · counts organicRank ≤ 3 */
  topThreeSearch: string;
  /** Row 2, col 2 · "Customers you miss" */
  missedCustomers: string;
  /** Row 2, col 3 · "Top 3 in Maps" · counts mapsRank ≤ 3 */
  topThreeMaps: string;
  /** "of {total} tracked" · sublabel for the Top-3-in-Search cell.
   *  Denominator = all tracked keywords (Maria's full portfolio). */
  topThreeSublabel: string;
  /** "of {total} scanned in Maps" · sublabel for the Top-3-in-Maps
   *  cell. Different denominator because Maps is only scanned over
   *  the cell-aggregated template set, not her full portfolio. */
  topThreeMapsSublabel: string;
  /** "Per month" · sublabel for the missed-customers cell. */
  missedCustomersSublabel: string;
  /** "What Google Ads would cost" · sublabel for traffic-value cell. */
  trafficValueSublabel: string;
  /** Sublabel when no Maps SERP scan has ever run for this business ·
   *  separates "0 because we never asked" from "0 because she's not
   *  in any Maps top 3". */
  topThreeMapsNotScannedSublabel: string;
  /** Tip on the totalSearches cell. */
  totalSearchesTip: string;
  /** Tip on the visits cell. */
  estimatedVisitsTip: string;
  /** Tip on the traffic-value cell. */
  trafficValueTip: string;
  /** Tip on the missed-customers cell. */
  missedCustomersTip: string;
  /** Tip on the Top-3-in-Search cell. */
  topThreeSearchTip: string;
  /** Tip on the Top-3-in-Maps cell. */
  topThreeMapsTip: string;
}

export interface SearchStateBarProps {
  totalSearchVolume: number;
  totalEstimatedVisits: number;
  /** Σ DfS estimated_paid_traffic_cost · the dollar value of the
   *  visits Maria gets for free. Renders as "$X.Xk/mo" or "$XXX/mo". */
  totalEstTrafficUsd: number;
  /** Count of tracked keywords where Maria ranks ≤ 3 in organic search. */
  topThreeSearchCount: number;
  /** Count of tracked keywords where Maria ranks ≤ 3 in Google Maps. */
  topThreeMapsCount: number;
  /** Total keywords tracked (Maria's full portfolio). */
  tracked: number;
  /** Total keywords actually scanned for Maps rank · smaller than
   *  `tracked` because Maps is only run on the cell-aggregated
   *  template set. */
  mapsScanned: number;
  /** Sum of est-customers-missed across all tracked keywords. */
  missedCustomers: number;
  /** Whether ANY Maps SERP scan has ever run for this business. False
   *  flips the Top-3-in-Maps sublabel to "Maps scan coming this week"
   *  to separate "0 because not in Maps" from "0 because never asked
   *  Google Maps". */
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
  topThreeSearchCount,
  topThreeMapsCount,
  tracked,
  mapsScanned,
  missedCustomers,
  hasMapsScans,
  labels,
}: SearchStateBarProps) {
  const visitsCapturePct =
    totalSearchVolume > 0
      ? Math.round((totalEstimatedVisits / totalSearchVolume) * 100)
      : 0;

  // Top-3-in-Maps cell truthful sublabel · separates "0 because we
  // never asked Google Maps" from "0 because she's not in Maps top 3
  // for any scanned keyword". Denominator = mapsScanned (typically
  // ~12), NOT tracked (often 200) — Maps is only run on the
  // cell-aggregated template set.
  const topThreeMapsSublabelText = !hasMapsScans
    ? labels.topThreeMapsNotScannedSublabel
    : labels.topThreeMapsSublabel.replace("{total}", fmt(mapsScanned));

  // 2×3 desktop grid · 1 col on narrow screens.
  // Row 1: demand → visits → value (the funnel)
  // Row 2: organic wins → misses → maps wins (the scoreboard)
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
        label={labels.topThreeSearch}
        value={fmt(topThreeSearchCount)}
        sublabel={labels.topThreeSublabel.replace("{total}", fmt(tracked))}
        tip={labels.topThreeSearchTip}
        tone={topThreeSearchCount > 0 ? "good" : "neutral"}
      />
      <StateCell
        label={labels.missedCustomers}
        value={fmt(missedCustomers)}
        sublabel={labels.missedCustomersSublabel}
        tip={labels.missedCustomersTip}
        tone={missedCustomers > 0 ? "warn" : "good"}
      />
      <StateCell
        label={labels.topThreeMaps}
        value={fmt(topThreeMapsCount)}
        sublabel={topThreeMapsSublabelText}
        tip={labels.topThreeMapsTip}
        tone={
          !hasMapsScans ? "warn" : topThreeMapsCount > 0 ? "good" : "neutral"
        }
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
