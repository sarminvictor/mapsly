import * as React from "react";

import type { ReportRow, ReportTypeValue } from "../types";

/**
 * ReportsTable · the rendered table for `/(agency)/reports`.
 *
 * Server-component-safe · pure presentational. The caller (the page)
 * passes pre-resolved labels + pre-built link nodes via
 * `linkForRow` so this leaf stays free of next-intl imports per
 * `.claude/rules/i18n.md`.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Dense table · sticky header · mono uppercase column titles
 *   - One row per Report · type pill (PDF / CSV / SHARE) drives tone
 *   - Action cell links to the storageUrl / share URL with a clear
 *     verb ("Open" / "Copy link") so Tom never has to hunt
 */

export interface ReportsTableLabels {
  caption: string;
  empty: { title: string; body: string };
  cappedFooter: (args: { shown: number; total: number }) => string;
  colType: string;
  colSubject: string;
  colCreated: string;
  colExpires: string;
  colViews: string;
  colAction: string;
  /** Type-pill labels. */
  typePill: Record<ReportTypeValue, string>;
  /** "expires in 3d" / "expired" / "—" formatter. Pre-resolved. */
  formatExpires: (iso: string | null) => string;
  /** "2h ago" / "il y a 2 h" formatter for created-at. */
  formatCreated: (iso: string) => string;
  /** Locale-aware integer formatter for the view count column. */
  formatInt: (n: number) => string;
  /** Subject-cell builder · returns the "Acme · Local SEO" line. */
  formatSubject: (row: ReportRow) => string;
  /** Aria-label for the table region. */
  tableAria: string;
  /** Row-action verb when the row is a stored PDF/CSV. */
  actionOpen: string;
  /** Row-action verb for share links. */
  actionShare: string;
  /** Row-action when no URL is available (pending). */
  actionPending: string;
}

export interface ReportsTableProps {
  rows: ReportRow[];
  totalCount: number;
  labels: ReportsTableLabels;
  /**
   * Build the action link / button for each row. The caller (page)
   * uses an `<a>` for direct storage downloads + a client island
   * for the "copy share link" affordance.
   */
  linkForRow: (row: ReportRow) => React.ReactNode;
}

/* ---------------------------------------------- tone per type */

function typeTone(type: ReportTypeValue): { bg: string; fg: string } {
  switch (type) {
    case "PDF_ONE_PAGER":
      return { bg: "rgba(91,61,245,.10)", fg: "var(--color-agency-indigo)" };
    case "SHARE_LINK":
      return { bg: "rgba(8,145,178,.10)", fg: "var(--color-agency-teal)" };
    case "CSV_LIST":
      return { bg: "rgba(45,134,89,.12)", fg: "var(--color-success)" };
    default:
      return { bg: "var(--color-bg-3)", fg: "var(--color-text-3)" };
  }
}

/* -------------------------------------------- header cell shared */

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
  textAlign: "left",
  whiteSpace: "nowrap",
};

const HEAD_CELL_RIGHT: React.CSSProperties = {
  ...HEAD_CELL,
  textAlign: "right",
};

export function ReportsTable({
  rows,
  totalCount,
  labels,
  linkForRow,
}: ReportsTableProps) {
  if (rows.length === 0) {
    return (
      <section
        aria-label={labels.tableAria}
        data-testid="reports-table-empty"
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
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
          {labels.empty.title}
        </p>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 12,
            color: "var(--color-text-2)",
            lineHeight: 1.5,
          }}
        >
          {labels.empty.body}
        </p>
      </section>
    );
  }

  const capped = rows.length < totalCount;

  return (
    <section
      aria-label={labels.tableAria}
      data-testid="reports-table"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-sans)",
          }}
        >
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr>
              <th style={HEAD_CELL} scope="col">
                {labels.colType}
              </th>
              <th style={HEAD_CELL} scope="col">
                {labels.colSubject}
              </th>
              <th style={HEAD_CELL} scope="col">
                {labels.colCreated}
              </th>
              <th style={HEAD_CELL} scope="col">
                {labels.colExpires}
              </th>
              <th style={HEAD_CELL_RIGHT} scope="col">
                {labels.colViews}
              </th>
              <th style={HEAD_CELL_RIGHT} scope="col">
                {labels.colAction}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = typeTone(row.type);
              return (
                <tr
                  key={row.id}
                  data-testid={`reports-row-${row.id}`}
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <td style={{ padding: "10px 12px" }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: tone.bg,
                        color: tone.fg,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {labels.typePill[row.type]}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: 13,
                      color: "var(--color-text)",
                      maxWidth: 280,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {labels.formatSubject(row)}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--color-text-3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {labels.formatCreated(row.createdAt)}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--color-text-3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {labels.formatExpires(row.expiresAt)}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--color-text)",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {labels.formatInt(row.viewCount)}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {linkForRow(row)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {capped ? (
        <div
          style={{
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
            borderTop: "1px solid var(--color-border)",
          }}
          data-testid="reports-table-capped-footer"
        >
          {labels.cappedFooter({ shown: rows.length, total: totalCount })}
        </div>
      ) : null}
    </section>
  );
}
