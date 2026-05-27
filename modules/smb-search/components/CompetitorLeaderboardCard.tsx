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
  /** Column headers */
  colRank: string;
  colName: string;
  colKeywords: string;
  colTopThree: string;
  /** "Customers/mo" · we converted from raw $ traffic to a Maria-friendly
   *  units-of-customer measure. */
  colCustomers: string;
  /** "Top 3 in maps or organic" tooltip */
  topThreeHelp: string;
  /** "Estimated monthly customers this business converts" tooltip */
  customersHelp: string;
  /** Empty state when no leaderboard data yet. */
  empty: string;
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
            margin: "4px 0 0",
            fontSize: 12.5,
            color: "var(--color-text-2)",
          }}
        >
          {subtitle}
        </p>
      </header>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ background: "var(--color-bg-3, #ece3d6)" }}>
              <Th>{labels.colRank}</Th>
              <Th>{labels.colName}</Th>
              <Th align="right">{labels.colKeywords}</Th>
              <Th align="right" tip={labels.topThreeHelp}>
                {labels.colTopThree}
              </Th>
              <Th align="right" tip={labels.customersHelp}>
                {labels.colCustomers}
              </Th>
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
                  <Td align="right">{fmt(row.keywordCount)}</Td>
                  <Td align="right">{fmt(row.topThreeCount)}</Td>
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
                      ~{fmt(row.estMonthlyCustomers)}/mo
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
        padding: "10px 18px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--color-text-3)",
        whiteSpace: "nowrap",
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
        padding: "12px 18px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}
