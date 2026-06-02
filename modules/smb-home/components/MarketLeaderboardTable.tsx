"use client";

/**
 * SMB overview · interactive market leaderboard.
 *
 * Every business in Maria's local market (cell), ranked by Mapsly Score with
 * a column per section score so she can sort by any of them. A weekly
 * rank-movement column (▲/▼ N spots) shows who's climbing. Her own row is
 * highlighted and always visible (appended if it falls off the current page).
 *
 * Client-rendered with in-memory sort + pagination (the cell is small — tens
 * of rows — so one round-trip + local state is the smooth-UX choice, mirroring
 * `modules/smb-search/components/KeywordVisibilityTable`). Cream + coral
 * tokens, mono numerics, color-coded score cells per `.claude/rules/ui-ux-smb.md`.
 */

import * as React from "react";

import type { RankColumn, SmbCompetitorRow } from "../types";

export interface MarketLeaderboardLabels {
  heading: string;
  /** "{category} · {city} — sortable" · {total} replaced client-side. */
  subtitle: string;
  colRank: string;
  colDelta: string;
  colBusiness: string;
  colMapsly: string;
  colReputation: string;
  colVisibility: string;
  colAds: string;
  colWebsite: string;
  colProfile: string;
  youBadge: string;
  /** Delta cell when there's no comparable prior week yet. */
  deltaNew: string;
  /** Tooltip on the Δ header explaining the warm-up. */
  deltaHelp: string;
  empty: string;
  sortAria: string;
  pageOfTotal: string;
  prev: string;
  next: string;
  notRanked: string;
}

export interface MarketLeaderboardTableProps {
  rows: readonly SmbCompetitorRow[];
  labels: MarketLeaderboardLabels;
}

type ScoreField =
  | "mapsly"
  | "reputation"
  | "visibility"
  | "ads"
  | "website"
  | "profile";
type SortField = "rank" | "name" | ScoreField;
type SortDir = "asc" | "desc";

const PAGE_SIZE = 10;

const SCORE_ACCESSOR: Record<
  ScoreField,
  (r: SmbCompetitorRow) => number | null
> = {
  mapsly: (r) => r.mapslyScore,
  reputation: (r) => r.reputation,
  visibility: (r) => r.visibility,
  ads: (r) => r.ads,
  website: (r) => r.website,
  profile: (r) => r.profile,
};

function scoreColor(v: number | null): string {
  if (v == null) return "var(--color-text-3)";
  if (v >= 7) return "var(--color-success, #2d8659)";
  if (v >= 4) return "var(--color-gold, #d4a574)";
  return "var(--color-coral)";
}

function compareScore(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  // Nulls sink regardless of direction.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

function sortRows(
  rows: readonly SmbCompetitorRow[],
  field: SortField,
  dir: SortDir,
): SmbCompetitorRow[] {
  const arr = [...rows];
  arr.sort((a, b) => {
    if (field === "rank")
      return dir === "asc"
        ? a.ranks.mapsly.rank - b.ranks.mapsly.rank
        : b.ranks.mapsly.rank - a.ranks.mapsly.rank;
    if (field === "name") {
      const c = a.name.localeCompare(b.name);
      return dir === "asc" ? c : -c;
    }
    return compareScore(
      SCORE_ACCESSOR[field](a),
      SCORE_ACCESSOR[field](b),
      dir,
    );
  });
  return arr;
}

export function MarketLeaderboardTable({
  rows,
  labels,
}: MarketLeaderboardTableProps) {
  const [sort, setSort] = React.useState<SortField>("mapsly");
  const [dir, setDir] = React.useState<SortDir>("desc");
  const [page, setPage] = React.useState(1);

  // Reset page when sort changes — during render, never in an effect.
  const sortKey = `${sort}|${dir}`;
  const [prevSortKey, setPrevSortKey] = React.useState(sortKey);
  if (prevSortKey !== sortKey) {
    setPrevSortKey(sortKey);
    setPage(1);
  }

  const sorted = React.useMemo(
    () => sortRows(rows, sort, dir),
    [rows, sort, dir],
  );
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visible = React.useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage],
  );

  // Always show Maria's row — append it if it's off the current page.
  const ownRow = sorted.find((r) => r.isOwn) ?? null;
  const ownOnPage = visible.some((r) => r.isOwn);
  const appended = ownRow && !ownOnPage ? ownRow : null;

  // The "#" and "Δ" follow the active sort — rank/delta for the sorted column,
  // server-computed across the whole cell. Name/rank sorts show the standing.
  const activeRankCol: RankColumn =
    sort === "rank" || sort === "name" ? "mapsly" : sort;

  const handleSort = (field: SortField) => {
    if (field === sort) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSort(field);
      // Rank + name ascend by default; score columns descend (high = good).
      setDir(field === "rank" || field === "name" ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <Shell labels={labels} total={0}>
        <p style={mutedParagraph}>{labels.empty}</p>
      </Shell>
    );
  }

  return (
    <Shell labels={labels} total={totalRows}>
      {totalPages > 1 ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "0 20px 10px",
          }}
        >
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
            labels={labels}
          />
        </div>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: "var(--color-bg-3, #ece3d6)" }}>
              <Th
                field="rank"
                label={labels.colRank}
                current={sort}
                dir={dir}
                onSort={handleSort}
                aria={labels.sortAria}
                align="center"
              />
              <th
                style={{ ...thBase, textAlign: "center" }}
                title={labels.deltaHelp}
              >
                {labels.colDelta}
              </th>
              <Th
                field="name"
                label={labels.colBusiness}
                current={sort}
                dir={dir}
                onSort={handleSort}
                aria={labels.sortAria}
              />
              <Th
                field="mapsly"
                label={labels.colMapsly}
                current={sort}
                dir={dir}
                onSort={handleSort}
                aria={labels.sortAria}
                align="right"
              />
              <Th
                field="reputation"
                label={labels.colReputation}
                current={sort}
                dir={dir}
                onSort={handleSort}
                aria={labels.sortAria}
                align="right"
              />
              <Th
                field="visibility"
                label={labels.colVisibility}
                current={sort}
                dir={dir}
                onSort={handleSort}
                aria={labels.sortAria}
                align="right"
              />
              <Th
                field="ads"
                label={labels.colAds}
                current={sort}
                dir={dir}
                onSort={handleSort}
                aria={labels.sortAria}
                align="right"
              />
              <Th
                field="website"
                label={labels.colWebsite}
                current={sort}
                dir={dir}
                onSort={handleSort}
                aria={labels.sortAria}
                align="right"
              />
              <Th
                field="profile"
                label={labels.colProfile}
                current={sort}
                dir={dir}
                onSort={handleSort}
                aria={labels.sortAria}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Row key={r.id} row={r} rankCol={activeRankCol} labels={labels} />
            ))}
            {appended ? (
              <>
                <tr aria-hidden>
                  <td colSpan={9} style={{ padding: "6px 0" }}>
                    <div
                      style={{
                        borderTop: "1px dashed var(--color-border)",
                        height: 0,
                      }}
                    />
                  </td>
                </tr>
                <Row row={appended} rankCol={activeRankCol} labels={labels} />
              </>
            ) : null}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

/* ---- rows + cells -------------------------------------------------------- */

function Row({
  row,
  rankCol,
  labels,
}: {
  row: SmbCompetitorRow;
  rankCol: RankColumn;
  labels: MarketLeaderboardLabels;
}) {
  const own = row.isOwn;
  return (
    <tr
      style={{
        borderTop: own
          ? "1px solid rgba(195,85,58,0.4)"
          : "1px solid var(--color-border)",
        borderBottom: own ? "1px solid rgba(195,85,58,0.4)" : undefined,
        background: own ? "rgba(195,85,58,0.06)" : "transparent",
      }}
    >
      <Td align="center">
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            color: own ? "var(--color-coral)" : "var(--color-text-2)",
          }}
        >
          {row.ranks[rankCol].rank}
        </span>
      </Td>
      <Td align="center">
        <DeltaCell delta={row.ranks[rankCol].delta} labels={labels} />
      </Td>
      <Td>
        <span
          style={{
            color: own ? "var(--color-coral)" : "var(--color-text)",
            fontWeight: own ? 600 : 400,
          }}
        >
          {row.name}
        </span>
        {own ? (
          <span
            style={{
              marginLeft: 8,
              padding: "1px 7px",
              borderRadius: 999,
              background: "var(--color-coral)",
              color: "#fff",
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {labels.youBadge}
          </span>
        ) : null}
      </Td>
      <ScoreCell value={row.mapslyScore} bold dash={labels.notRanked} />
      <ScoreCell value={row.reputation} dash={labels.notRanked} />
      <ScoreCell value={row.visibility} dash={labels.notRanked} />
      <ScoreCell
        value={row.adsApplicable === false ? null : row.ads}
        dash={labels.notRanked}
      />
      <ScoreCell value={row.website} dash={labels.notRanked} />
      <ScoreCell value={row.profile} dash={labels.notRanked} />
    </tr>
  );
}

function ScoreCell({
  value,
  bold,
  dash,
}: {
  value: number | null;
  bold?: boolean;
  dash: string;
}) {
  return (
    <Td align="right">
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: bold ? 700 : 500,
          color: scoreColor(value),
        }}
      >
        {value == null ? dash : value.toFixed(1)}
      </span>
    </Td>
  );
}

function DeltaCell({
  delta,
  labels,
}: {
  delta: number | null;
  labels: MarketLeaderboardLabels;
}) {
  if (delta == null) {
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--color-text-3)",
        }}
      >
        {labels.deltaNew}
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span
        style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-3)" }}
      >
        —
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 700,
        color: up ? "var(--color-success, #2d8659)" : "var(--color-coral)",
      }}
    >
      {up ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}

/* ---- chrome -------------------------------------------------------------- */

function Shell({
  labels,
  total,
  children,
}: {
  labels: MarketLeaderboardLabels;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby="market-table-heading" style={shellStyle}>
      <header style={{ padding: "0 20px 12px" }}>
        <h2 id="market-table-heading" style={headingStyle}>
          {labels.heading}
        </h2>
        <p style={subtitleStyle}>
          {labels.subtitle.replace("{total}", String(total))}
        </p>
      </header>
      {children}
    </section>
  );
}

function Th({
  field,
  label,
  current,
  dir,
  onSort,
  aria,
  align,
}: {
  field: SortField;
  label: string;
  current: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
  aria: string;
  align?: "left" | "right" | "center";
}) {
  const active = current === field;
  const indicator = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th style={{ ...thBase, textAlign: align ?? "left" }}>
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={aria.replace("{column}", label)}
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
        padding: "9px 12px",
        textAlign: align ?? "left",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function PageBtn({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        fontSize: 12,
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--color-text-3)" : "var(--color-text)",
        background: disabled ? "var(--color-bg-3)" : "var(--color-bg-2)",
      }}
    >
      {label}
    </button>
  );
}

function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
  labels,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  labels: MarketLeaderboardLabels;
}) {
  return (
    <nav
      aria-label="pagination"
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      <PageBtn disabled={page <= 1} onClick={onPrev} label={labels.prev} />
      <span
        style={{
          fontSize: 11.5,
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-2)",
          whiteSpace: "nowrap",
        }}
      >
        {labels.pageOfTotal
          .replace("{page}", String(page))
          .replace("{total}", String(totalPages))}
      </span>
      <PageBtn
        disabled={page >= totalPages}
        onClick={onNext}
        label={labels.next}
      />
    </nav>
  );
}

const shellStyle: React.CSSProperties = {
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  padding: "16px 0 12px",
  marginBottom: 20,
  boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
  overflow: "hidden",
};
const headingStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-serif)",
  fontSize: 18,
  letterSpacing: "-0.01em",
  color: "var(--color-text)",
};
const subtitleStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12.5,
  color: "var(--color-text-2)",
};
const mutedParagraph: React.CSSProperties = {
  margin: "10px 20px",
  color: "var(--color-text-2)",
  fontSize: 13,
  lineHeight: 1.5,
};
const thBase: React.CSSProperties = {
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "var(--color-text-3)",
  whiteSpace: "nowrap",
};
