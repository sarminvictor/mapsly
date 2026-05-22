import * as React from "react";

import type { ListFunnelRow as FunnelRowData } from "../types";
import { ListFunnelRow, type ListFunnelRowLabels } from "./ListFunnelRow";

/**
 * ListFunnelTable · the per-list funnel table for `/(agency)/list-
 * analytics`.
 *
 * Dense, scan-friendly per `.claude/rules/ui-ux-agency.md`:
 *   - Sticky header (uppercase mono labels)
 *   - Tabular-nums monospaced numeric cells · 5 status columns + funnel viz
 *   - Rows sorted DESC by `totalLeads` (caller-supplied · we render order
 *     verbatim)
 *
 * The list-name cell receives a pre-built `Link` ReactNode from the
 * caller via `linkForList(listId)`. Keeps next-intl out of this leaf
 * (per `.claude/rules/i18n.md` — the page owns routing).
 *
 * Server-component-safe · pure presentational. No hooks, no state.
 */

export interface ListFunnelTableLabels {
  tableTitle: string;
  /** Pre-resolved aria-label for the table region (e.g. for screen readers). */
  tableAria: string;
  colList: string;
  colNew: string;
  colContacted: string;
  colReplied: string;
  colWon: string;
  colLost: string;
  /** Close-rate column header · "Close %" / "Cierre %" / "Closure %". */
  colCloseRate: string;
  colFunnel: string;
  /** Pre-resolved row labels (shared formatters + pill copy). */
  row: ListFunnelRowLabels;
  /** Empty-table copy · shown when `rows.length === 0`. */
  emptyTableTitle: string;
  emptyTableBody: string;
}

export interface ListFunnelTableProps {
  rows: FunnelRowData[];
  labels: ListFunnelTableLabels;
  /**
   * Build a Link node for the list's detail page. The caller (the
   * page) wires this with the i18n-aware `Link` from `@/i18n/
   * navigation` so route translation works.
   */
  linkForList: (row: FunnelRowData) => React.ReactNode;
}

const HEAD_CELL: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "var(--color-bg-2)",
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-3)",
  borderBottom: "1px solid var(--color-border)",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const HEAD_CELL_LEFT: React.CSSProperties = {
  ...HEAD_CELL,
  textAlign: "left",
};

export function ListFunnelTable({
  rows,
  labels,
  linkForList,
}: ListFunnelTableProps) {
  return (
    <section
      aria-label={labels.tableAria}
      data-testid="list-funnel-table"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        marginBottom: 22,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "var(--color-text)",
          }}
        >
          {labels.tableTitle}
        </h2>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <div
          data-testid="list-funnel-table-empty"
          style={{
            padding: "32px 24px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-text)",
            }}
          >
            {labels.emptyTableTitle}
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: "var(--color-text-2)",
            }}
          >
            {labels.emptyTableBody}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "var(--font-sans)",
            }}
          >
            <thead>
              <tr>
                <th style={HEAD_CELL_LEFT} scope="col">
                  {labels.colList}
                </th>
                <th style={HEAD_CELL} scope="col">
                  {labels.colNew}
                </th>
                <th style={HEAD_CELL} scope="col">
                  {labels.colContacted}
                </th>
                <th style={HEAD_CELL} scope="col">
                  {labels.colReplied}
                </th>
                <th style={HEAD_CELL} scope="col">
                  {labels.colWon}
                </th>
                <th style={HEAD_CELL} scope="col">
                  {labels.colLost}
                </th>
                <th style={HEAD_CELL} scope="col">
                  {labels.colCloseRate}
                </th>
                <th style={HEAD_CELL_LEFT} scope="col">
                  {labels.colFunnel}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.listId}
                  data-testid={`list-funnel-row-${row.listId}`}
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <ListFunnelRow
                    row={row}
                    labels={labels.row}
                    nameLink={linkForList(row)}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
