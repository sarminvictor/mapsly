// SMB /ads · GOOGLE block · "Where to start" card (replaces the old budget
// calculator). Highlights the best-value searches to advertise on — driven by
// the query's `bestOpportunity` + top keyword-cost picks (already sorted by
// opportunity). Server component · pure presentation, every string arrives as a
// plain prop (cache-components Pattern 4b · no function props cross a boundary).
// Plain English, no jargon (ui-ux-smb).
//
// We can't see which keywords Maria already runs, so this never claims a
// head-to-head — it just surfaces the cheapest / highest-volume openings.

import * as React from "react";

export interface GoogleStartPick {
  /** "Botox" — the search term (capitalized for display). */
  keyword: string;
  /** Pre-resolved line: "about {cpc}/click · {competition} competition ·
   *  {volume} searches/mo". Resolved by the page so format stays server-side. */
  line: string;
  /** Whether this is the single best opening (gets the ★ accent). */
  isBest: boolean;
}

export interface GoogleStartCardLabels {
  /** Lead-in line · adapts to whether she's already advertising. */
  intro: string;
  /** Empty state when there aren't enough cost rows to pick openings. */
  empty: string;
}

export function GoogleStartCard({
  picks,
  labels,
}: {
  picks: GoogleStartPick[];
  labels: GoogleStartCardLabels;
}) {
  if (picks.length === 0) {
    return (
      <p style={{ color: "var(--color-text-2)", fontSize: 15, margin: 0 }}>
        {labels.empty}
      </p>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        background: "var(--color-bg-2)",
        padding: "16px 18px",
      }}
    >
      <p
        style={{
          margin: "0 0 14px",
          color: "var(--color-text-2)",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {labels.intro}
      </p>

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {picks.map((p) => (
          <li
            key={p.keyword}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              border: "1px solid var(--color-border)",
              borderLeft: `4px solid ${
                p.isBest ? "var(--color-coral)" : "var(--color-info, #3b6ec4)"
              }`,
              borderRadius: "0 12px 12px 0",
              background: p.isBest ? "rgba(195,85,58,0.05)" : "var(--color-bg)",
              padding: "12px 16px",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    color: p.isBest
                      ? "var(--color-coral)"
                      : "var(--color-text)",
                    textTransform: "capitalize",
                    lineHeight: 1.25,
                  }}
                >
                  {p.keyword}
                </span>
                {p.isBest ? (
                  <span
                    aria-hidden
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "var(--color-coral)",
                      fontFamily: "var(--font-mono)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ★
                  </span>
                ) : null}
              </div>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 13,
                  color: "var(--color-text-2)",
                  lineHeight: 1.45,
                }}
              >
                {p.line}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
