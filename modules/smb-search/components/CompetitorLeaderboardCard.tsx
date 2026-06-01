// Server component · cell-wide competitor leaderboard for /(smb)/search.
//
// Shows the top 10 businesses in Maria's (city, country) cell ranked
// by Σ estimated traffic across their tracked keywords. Maria's own
// row is always visible · highlighted in coral. If she's outside the
// top 10, an extra row pins her position at the bottom of the visible
// table.
//
// All data comes from BusinessKeyword (S.1 schema) · zero new API
// calls. Same dataset that powers the gap analysis · just sliced
// differently.

import * as React from "react";

import type { CompetitorRow } from "../types";

export interface CompetitorLeaderboardCardLabels {
  heading: string;
  /** "You are #{rank} of {total} businesses in {city}" · inline placeholders */
  subtitleOwn: string;
  /** Subtitle when Maria isn't ranked · "Other businesses in {city}" */
  subtitleNoOwn: string;
  /** Column headers · S.6.6 rework (Viktor 2026-05-28) */
  colRank: string;
  colName: string;
  colTopThreeMaps: string;
  colTopThreeSearch: string;
  colMonthlyVisitors: string;
  colDomain: string;
  /** "How many keywords this biz is top-3 in Maps Pack for" tooltip */
  topThreeMapsHelp: string;
  /** "How many keywords this biz is top-3 in Google Search for" tooltip */
  topThreeSearchHelp: string;
  /** "Estimated monthly clicks across all keywords" tooltip */
  monthlyVisitorsHelp: string;
  /** "no website" placeholder for the domain column */
  noDomain: string;
  /** Empty state when no leaderboard data yet. */
  empty: string;
  /** Smaller legend line right below the "You are #N of M" subtitle.
   *  Explains what the column numbers mean so we can keep the
   *  headers short ("Maps", "Search") without losing the "top 3
   *  count" meaning. */
  columnsLegend: string;
}

export interface CompetitorLeaderboardCardProps {
  rows: readonly CompetitorRow[];
  ownRank: number | null;
  total: number;
  city: string | null;
  labels: CompetitorLeaderboardCardLabels;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function CompetitorLeaderboardCard({
  rows,
  ownRank,
  total,
  city,
  labels,
}: CompetitorLeaderboardCardProps) {
  if (rows.length === 0) {
    return (
      <section
        aria-labelledby="competitor-leaderboard-heading"
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 24,
          boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
        }}
      >
        <h2
          id="competitor-leaderboard-heading"
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {labels.heading}
        </h2>
        <p
          style={{
            margin: "10px 0 0",
            color: "var(--color-text-2)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {labels.empty}
        </p>
      </section>
    );
  }

  const cityText = city ?? "";
  const subtitle =
    ownRank != null
      ? labels.subtitleOwn
          .replace("{rank}", fmt(ownRank))
          .replace("{total}", fmt(total))
          .replace("{city}", cityText)
      : labels.subtitleNoOwn.replace("{city}", cityText);

  return (
    <section
      aria-labelledby="competitor-leaderboard-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "20px 0 4px",
        marginBottom: 24,
        boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
        overflow: "hidden",
      }}
    >
      <header style={{ padding: "0 24px 14px" }}>
        <h2
          id="competitor-leaderboard-heading"
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {labels.heading}
        </h2>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text)",
            lineHeight: 1.4,
          }}
        >
          {subtitle}
        </p>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 12,
            color: "var(--color-text-2)",
            lineHeight: 1.4,
          }}
        >
          {labels.columnsLegend}
        </p>
      </header>

      <div>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            tableLayout: "auto",
          }}
        >
          <thead>
            <tr style={{ background: "var(--color-bg-3, #ece3d6)" }}>
              <Th>{labels.colRank}</Th>
              <Th>{labels.colName}</Th>
              <Th align="right" tip={labels.topThreeMapsHelp}>
                {labels.colTopThreeMaps}
              </Th>
              <Th align="right" tip={labels.topThreeSearchHelp}>
                {labels.colTopThreeSearch}
              </Th>
              <Th align="right" tip={labels.monthlyVisitorsHelp}>
                {labels.colMonthlyVisitors}
              </Th>
              <Th>{labels.colDomain}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOwn = row.kind === "you";
              return (
                <tr
                  key={row.id}
                  style={{
                    background: isOwn
                      ? "rgba(195, 85, 58, 0.08)"
                      : "transparent",
                    borderTop: isOwn
                      ? "1px solid rgba(195, 85, 58, 0.4)"
                      : "1px solid var(--color-border)",
                    borderBottom: isOwn
                      ? "1px solid rgba(195, 85, 58, 0.4)"
                      : undefined,
                  }}
                >
                  <Td>
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: 18,
                        fontWeight: 700,
                        color: isOwn
                          ? "var(--color-coral)"
                          : "var(--color-text)",
                      }}
                    >
                      #{row.rank}
                    </span>
                  </Td>
                  <Td>
                    <div
                      style={{
                        fontWeight: isOwn ? 700 : 500,
                        color: isOwn
                          ? "var(--color-coral)"
                          : "var(--color-text)",
                      }}
                    >
                      {row.name}
                    </div>
                  </Td>
                  <Td align="right">{fmt(row.topThreeMaps)}</Td>
                  <Td align="right">{fmt(row.topThreeSearch)}</Td>
                  <Td align="right">
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontWeight: isOwn ? 700 : 500,
                        color: isOwn
                          ? "var(--color-coral)"
                          : "var(--color-text)",
                      }}
                    >
                      {fmt(row.monthlyVisitors)}
                    </span>
                  </Td>
                  <Td>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: row.domain
                          ? "var(--color-text-2)"
                          : "var(--color-text-3)",
                      }}
                    >
                      {row.domain ?? labels.noDomain}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  align,
  tip,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  tip?: string;
}) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "10px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--color-text-3)",
        // Allow two-line wrap so headers like "Top 3 Maps" can fold
        // gracefully on narrow viewports instead of forcing a
        // horizontal scrollbar across the whole card.
        lineHeight: 1.25,
      }}
      title={tip}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align ?? "left",
        padding: "12px 10px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}
