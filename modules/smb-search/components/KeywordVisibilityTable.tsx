"use client";

// S.6 · architecture C · sortable "How customers search for {industry}
// in {city}" table. Boxly-pattern (see
// boxly_app/modules/pro/components/intelligence/SearchVisibilityPage.tsx).
//
// Columns: Keyword (+ "your service" badge) · Searches/mo · Maps rank
// · Search rank. Click a header to sort; click again to flip direction.
// Color coding on the rank cells: green = top 3, amber = top 10,
// default = below 10, dash = unranked.
//
// Server resolves all i18n strings + the row data; this component owns
// only the sort state. No function props cross the boundary
// (Pattern 4b · INC-40).

import * as React from "react";

import type { KeywordRow } from "../types";

export interface KeywordVisibilityTableLabels {
  /** "How customers search for {industry} in {city}" · {industry}
   *  and {city} are replaced server-side before being passed in. */
  heading: string;
  /** "Click column headers to sort." */
  subtitle: string;
  colKeyword: string;
  colSearches: string;
  colMaps: string;
  colOrganic: string;
  /** "your service" pill copy. */
  serviceBadge: string;
  /** Empty state when the keyword set is empty (rare · transition
   *  window between deploy and first cron). */
  empty: string;
  /** Footer line · "Position colors: green = top 3, amber = top 10,
   *  default = below 10." */
  legend: string;
  /** Aria-label for the sort buttons · "Sort by {column}". */
  sortAriaTemplate: string;
}

export interface KeywordVisibilityTableProps {
  rows: readonly KeywordRow[];
  labels: KeywordVisibilityTableLabels;
}

type SortField = "keyword" | "searchVolume" | "mapsRank" | "organicRank";
type SortDir = "asc" | "desc";

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function rankColor(rank: number | null): string {
  if (rank == null) return "var(--color-text-3)";
  if (rank <= 3) return "var(--color-success, #2d8659)";
  if (rank <= 10) return "var(--color-gold, #d4a574)";
  return "var(--color-text-2)";
}

function comparePosition(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  // Nulls sink regardless of direction · "not ranked" always at the end
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

function sortRows(
  rows: readonly KeywordRow[],
  field: SortField,
  dir: SortDir,
): KeywordRow[] {
  const arr = [...rows];
  arr.sort((a, b) => {
    if (field === "keyword") {
      const cmp = a.keyword.localeCompare(b.keyword);
      return dir === "asc" ? cmp : -cmp;
    }
    if (field === "searchVolume") {
      const av = a.searchVolume ?? 0;
      const bv = b.searchVolume ?? 0;
      return dir === "asc" ? av - bv : bv - av;
    }
    if (field === "mapsRank") {
      return comparePosition(a.localPackRank, b.localPackRank, dir);
    }
    return comparePosition(a.organicRank, b.organicRank, dir);
  });
  return arr;
}

export function KeywordVisibilityTable({
  rows,
  labels,
}: KeywordVisibilityTableProps) {
  const [sortField, setSortField] = React.useState<SortField>("searchVolume");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      // Rank columns default asc (rank #1 is best); volume + keyword desc
      setSortDir(
        field === "mapsRank" || field === "organicRank" ? "asc" : "desc",
      );
    }
  };

  if (rows.length === 0) {
    return (
      <section
        aria-labelledby="visibility-table-heading"
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
          id="visibility-table-heading"
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

  const sorted = sortRows(rows, sortField, sortDir);

  return (
    <section
      aria-labelledby="visibility-table-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "16px 0 12px",
        marginBottom: 24,
        boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
        overflow: "hidden",
      }}
    >
      <header style={{ padding: "0 24px 12px" }}>
        <h2
          id="visibility-table-heading"
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
          {labels.subtitle}
        </p>
      </header>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--color-bg-3, #ece3d6)" }}>
              <SortableTh
                field="keyword"
                label={labels.colKeyword}
                currentField={sortField}
                currentDir={sortDir}
                onSort={handleSort}
                ariaTemplate={labels.sortAriaTemplate}
              />
              <SortableTh
                field="searchVolume"
                label={labels.colSearches}
                currentField={sortField}
                currentDir={sortDir}
                onSort={handleSort}
                ariaTemplate={labels.sortAriaTemplate}
                align="right"
              />
              <SortableTh
                field="mapsRank"
                label={labels.colMaps}
                currentField={sortField}
                currentDir={sortDir}
                onSort={handleSort}
                ariaTemplate={labels.sortAriaTemplate}
                align="center"
              />
              <SortableTh
                field="organicRank"
                label={labels.colOrganic}
                currentField={sortField}
                currentDir={sortDir}
                onSort={handleSort}
                ariaTemplate={labels.sortAriaTemplate}
                align="center"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                style={{
                  borderTop: "1px solid var(--color-border)",
                  background: row.isServiceKeyword
                    ? "rgba(45, 134, 89, 0.04)"
                    : "transparent",
                }}
              >
                <Td>
                  <span style={{ color: "var(--color-text)" }}>{row.keyword}</span>
                  {row.isServiceKeyword ? (
                    <span
                      style={{
                        marginLeft: 8,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "rgba(45, 134, 89, 0.1)",
                        color: "var(--color-success, #2d8659)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {labels.serviceBadge}
                    </span>
                  ) : null}
                </Td>
                <Td align="right">
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-text-2)",
                    }}
                  >
                    {fmt(row.searchVolume)}
                  </span>
                </Td>
                <Td align="center">
                  <RankPill rank={row.localPackRank} />
                </Td>
                <Td align="center">
                  <RankPill rank={row.organicRank} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p
        style={{
          margin: "12px 24px 0",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-3)",
          lineHeight: 1.5,
        }}
      >
        {labels.legend}
      </p>
    </section>
  );
}

function SortableTh({
  field,
  label,
  currentField,
  currentDir,
  onSort,
  ariaTemplate,
  align,
}: {
  field: SortField;
  label: string;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (f: SortField) => void;
  ariaTemplate: string;
  align?: "left" | "right" | "center";
}) {
  const active = currentField === field;
  const indicator = !active ? "" : currentDir === "asc" ? " ↑" : " ↓";
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: align ?? "left",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--color-text-3)",
        whiteSpace: "nowrap",
      }}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={ariaTemplate.replace("{column}", label)}
        style={{
          all: "unset",
          cursor: "pointer",
          color: active ? "var(--color-text)" : "var(--color-text-3)",
          fontFamily: "inherit",
          fontSize: "inherit",
          fontWeight: "inherit",
          letterSpacing: "inherit",
          textTransform: "inherit",
        }}
      >
        {label}
        {indicator}
      </button>
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      style={{
        padding: "10px 14px",
        textAlign: align ?? "left",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function RankPill({ rank }: { rank: number | null }) {
  const color = rankColor(rank);
  if (rank == null) {
    return <span style={{ color, fontFamily: "var(--font-mono)" }}>—</span>;
  }
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 32,
        padding: "2px 8px",
        borderRadius: 999,
        background:
          rank <= 3
            ? "rgba(45, 134, 89, 0.1)"
            : rank <= 10
              ? "rgba(212, 165, 116, 0.15)"
              : "var(--color-bg-3, #ece3d6)",
        color,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      #{rank}
    </span>
  );
}
