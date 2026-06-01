// SMB /ads · META block · "Who's advertising on Facebook & Instagram" table
// (replaces the old creative-card gallery). One row per market advertiser,
// sorted by active ad count desc (already ordered by the query). Columns:
// Business · Active ads · Platforms · Running since. Maria's own row is
// highlighted in coral. NO spend column — we have no reliable spend, so we
// never invent one. Server component · pure presentation, every string arrives
// as a plain prop (cache-components Pattern 4b · no function props cross a
// boundary). Platform labels are pre-resolved server-side. No jargon (ui-ux-smb).

import * as React from "react";
import { PlatformIcons } from "./PlatformIcons";

export interface MetaAdvertiserRowView {
  pageId: string;
  name: string;
  handle: string | null;
  isOwn: boolean;
  /** Pre-resolved "6 ads" / "1 ad" plural string. */
  adCountText: string;
  /** Raw platform codes (FACEBOOK/INSTAGRAM/…) → rendered as icon badges. */
  platforms: string[];
  /** "May 2025" or "" — month-year, formatted server-side. */
  runningSinceText: string;
}

export interface MetaAdvertiserTableLabels {
  colBusiness: string;
  colAds: string;
  colPlatforms: string;
  colRunningSince: string;
  /** "(that's you)" badge on Maria's own row. */
  youBadge: string;
  /** Em-dash fallback for an unknown "running since". */
  noDate: string;
  /** Empty state when no advertisers were found. */
  empty: string;
}

export function MetaAdvertiserTable({
  rows,
  labels,
}: {
  rows: MetaAdvertiserRowView[];
  labels: MetaAdvertiserTableLabels;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ color: "var(--color-text-2)", fontSize: 14.5, margin: 0 }}>
        {labels.empty}
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}
      >
        <thead>
          <tr>
            <Th>{labels.colBusiness}</Th>
            <Th align="right">{labels.colAds}</Th>
            <Th>{labels.colPlatforms}</Th>
            <Th>{labels.colRunningSince}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.pageId}
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
                    fontWeight: row.isOwn ? 700 : 500,
                    color: row.isOwn
                      ? "var(--color-coral)"
                      : "var(--color-text)",
                  }}
                >
                  {row.name}
                </span>
                {row.handle ? (
                  <span
                    style={{
                      marginLeft: 6,
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color: "var(--color-text-3)",
                    }}
                  >
                    @{row.handle}
                  </span>
                ) : null}
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
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.adCountText}
                </span>
              </Td>
              <Td>
                <PlatformIcons platforms={row.platforms} />
              </Td>
              <Td>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    color: row.runningSinceText
                      ? "var(--color-text-2)"
                      : "var(--color-text-3)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.runningSinceText || labels.noDate}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
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
