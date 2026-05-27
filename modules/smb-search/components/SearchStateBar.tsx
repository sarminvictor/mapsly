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
  /** "Searches your services get each month" */
  totalSearches: string;
  /** "How many likely land on you" */
  estimatedVisits: string;
  /** "Top 3 spots" */
  inTopThree: string;
  /** "Keywords tracked" */
  tracked: string;
  /** "of {total} keywords" · `{total}` is replaced inline. */
  inTopThreeSublabel: string;
  /** Sub-line for tracked · e.g. "Refreshed weekly". */
  trackedSublabel: string;
  /** "Add up to all your services' searches" · the "what is this" tip
   *  surfaced on the totalSearches cell. */
  totalSearchesTip: string;
  /** "{count} of {total} searches likely land on you" — tip on visits. */
  estimatedVisitsTip: string;
}

export interface SearchStateBarProps {
  totalSearchVolume: number;
  totalEstimatedVisits: number;
  topThreeKeywords: number;
  tracked: number;
  labels: SearchStateBarLabels;
}

/** Format a count "1,234" using en-US separators · keeps the numbers
 *  scannable. Locale-aware formatting can come later if i18n needs it. */
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function SearchStateBar({
  totalSearchVolume,
  totalEstimatedVisits,
  topThreeKeywords,
  tracked,
  labels,
}: SearchStateBarProps) {
  const visitsCapturePct =
    totalSearchVolume > 0
      ? Math.round((totalEstimatedVisits / totalSearchVolume) * 100)
      : 0;

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
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 20,
        boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
      }}
    >
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
        label={labels.inTopThree}
        value={fmt(topThreeKeywords)}
        sublabel={labels.inTopThreeSublabel.replace("{total}", fmt(tracked))}
        tip=""
        tone={topThreeKeywords > 0 ? "good" : "neutral"}
      />
      <StateCell
        label={labels.tracked}
        value={fmt(tracked)}
        sublabel={labels.trackedSublabel}
        tip=""
        tone="neutral"
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
