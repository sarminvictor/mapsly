// SMB /ads · GOOGLE block · "Who's outspending you on Google" leaderboard.
//
// A table of the top Google advertisers in Maria's market (by active ad count),
// modeled on `modules/smb-search/components/CompetitorLeaderboardCard.tsx`.
// Maria's own row is highlighted in coral. Server component · pure presentation,
// every string arrives as a plain prop (cache-components Pattern 4b · no
// function props cross any boundary). Plain English, no jargon (ui-ux-smb).

import * as React from "react";
import type { GoogleAdvertiserRow } from "../types";

export interface GoogleAdvertiserLeaderboardLabels {
  /** "You're #{rank} of {total}" · inline placeholders, resolved by page. */
  ownRankLine: string;
  colRank: string;
  colBusiness: string;
  colAdCount: string;
  colDomain: string;
  /** "(that's you)" badge appended to Maria's row name. */
  youBadge: string;
  /** "no website" placeholder for the domain column. */
  noDomain: string;
  /** Empty state when no Google advertisers were found. */
  empty: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function GoogleAdvertiserLeaderboard({
  rows,
  ownRank,
  total,
  labels,
}: {
  rows: GoogleAdvertiserRow[];
  ownRank: number | null;
  total: number;
  labels: GoogleAdvertiserLeaderboardLabels;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ color: "var(--color-text-2)", fontSize: 14.5, margin: 0 }}>
        {labels.empty}
      </p>
    );
  }

  const ownRankLine =
    ownRank != null
      ? labels.ownRankLine
          .replace("{rank}", fmt(ownRank))
          .replace("{total}", fmt(total))
      : null;

  return (
    <div>
      {ownRankLine ? (
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text)",
            lineHeight: 1.4,
          }}
        >
          {ownRankLine}
        </p>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13.5,
          }}
        >
          <thead>
            <tr>
              <Th>{labels.colRank}</Th>
              <Th>{labels.colBusiness}</Th>
              <Th align="right">{labels.colAdCount}</Th>
              <Th>{labels.colDomain}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                style={{
                  background: row.isOwn
                    ? "rgba(195, 85, 58, 0.08)"
                    : "transparent",
                  borderTop: row.isOwn
                    ? "1px solid rgba(195, 85, 58, 0.4)"
                    : "1px solid var(--color-border)",
                  borderBottom: row.isOwn
                    ? "1px solid rgba(195, 85, 58, 0.4)"
                    : undefined,
                }}
              >
                <Td>
                  <span
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: 17,
                      fontWeight: 700,
                      color: row.isOwn
                        ? "var(--color-coral)"
                        : "var(--color-text)",
                    }}
                  >
                    #{row.rank}
                  </span>
                </Td>
                <Td>
                  <span
                    style={{
                      fontWeight: row.isOwn ? 700 : 500,
                      color: row.isOwn
                        ? "var(--color-coral)"
                        : "var(--color-text)",
                    }}
                  >
                    {row.name}
                  </span>
                  {row.isOwn ? (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-coral)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {labels.youBadge}
                    </span>
                  ) : null}
                </Td>
                <Td align="right">
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: row.isOwn ? 700 : 500,
                      color: row.isOwn
                        ? "var(--color-coral)"
                        : "var(--color-text)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmt(row.adCount)}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      style={{
        textAlign: align ?? "left",
        padding: "8px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--color-text-3)",
        borderBottom: "1px solid var(--color-border)",
        lineHeight: 1.25,
        whiteSpace: "nowrap",
      }}
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
        padding: "11px 10px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}
