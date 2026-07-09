"use client";

/**
 * Credit ledger / usage table — "Every credit in and out — your activity, not a
 * bill."
 *
 *   - Pagination (10 rows / page) over the ≤50 rows the page loads.
 *   - Full timestamps (Mon D, YYYY · HH:MM) alongside the relative "When".
 *   - Action detail line under "What" — market · N businesses · what ran
 *     (joined from run metadata server-side; see modules/billing/usage-detail).
 *
 * 2026-07-09 (review Part E1): the running-balance math + double-billing bug is
 * fixed by collapsing each run's HOLD/SETTLE/REFUND rows into one net row via
 * the pure `collapseWithBalance` helper (modules/billing/ledger-view.ts, unit-
 * tested). This component is now display-only.
 *
 * `'use client'` for the page-state only; every prop is plain serialized data
 * (Date survives the RSC boundary).
 */

import { useState } from "react";

import {
  collapseWithBalance,
  type LedgerDisplayRow,
  type LedgerMovement,
} from "@/modules/billing/ledger-view";

/** A raw ledger movement as loaded by the billing page (newest-first). */
export type LedgerRow = LedgerMovement;

export interface CreditLedgerTableProps {
  /** Newest-first ledger rows. */
  rows: LedgerRow[];
  /** The wallet's current available balance (anchors the running balance). */
  currentBalance: number;
  /** True when exactly the row cap was fetched (older activity may exist). */
  truncated?: boolean;
}

const nf = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 10;

/** Relative "When" label — Today / Yesterday / N days ago / a date. */
function whenLabel(d: Date): string {
  const now = Date.now();
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Exact timestamp — "Jul 9, 2026 · 14:32" (year + hour:min, per Phase 5). */
function exactStamp(d: Date): string {
  try {
    const datePart = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
    const timePart = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return `${datePart} · ${timePart}`;
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " · ");
  }
}

/** Human "What" description for a collapsed display row. */
function whatLabel(row: LedgerDisplayRow): string {
  switch (row.kind) {
    case "run-pending":
      return "Run in progress";
    case "run-settled":
      return "Run settled";
    case "run-refunded":
      return "Run refunded";
    case "topup":
      if (row.note) {
        const pretty = prettyNote(row.note);
        if (pretty) return pretty;
      }
      return "Credits added";
    case "grant":
    default:
      if (row.note) {
        const pretty = prettyNote(row.note);
        if (pretty) return pretty;
      }
      switch (row.type) {
        case "EXPIRE":
          return "Credits expired";
        case "ADJUST":
          return "Adjustment";
        default:
          return row.type;
      }
  }
}

/** Tidy internal note sentinels into readable copy; null → fall back to type. */
function prettyNote(note: string): string | null {
  if (note === "free-tier-grant") return "Free plan · starter credits";
  if (note.startsWith("plan-grant:")) return "Plan · monthly allowance";
  if (note.startsWith("topup-purchase:")) return "Top-up purchase";
  // Internal settle/hold sentinels carry no user value — let the type label win
  // (the detail line below already shows the real market · N · what-ran).
  if (
    note === "hold for run" ||
    note === "settle actual" ||
    note === "refund unused hold" ||
    note === "refund full hold"
  ) {
    return null;
  }
  return note;
}

export function CreditLedgerTable({
  rows,
  currentBalance,
  truncated = false,
}: CreditLedgerTableProps) {
  const [page, setPage] = useState(0);
  const withBalance = collapseWithBalance(rows, currentBalance);
  const pageCount = Math.max(1, Math.ceil(withBalance.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = withBalance.slice(start, start + PAGE_SIZE);
  const onLastPage = safePage >= pageCount - 1;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Usage</h2>
      <p className="note" style={{ marginTop: -4 }}>
        Every credit in and out — your activity, not a bill.
      </p>
      {rows.length === 0 ? (
        <p className="note" style={{ marginTop: 8 }}>
          No credit activity yet. Discovery is free — enrichment runs settle
          here.
        </p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Credits
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ row, rowBalance }) => {
                  // Positive → green +, negative → red −, exactly zero
                  // (fully-refunded / failed run) → neutral "0", no sign.
                  const zero = row.signed === 0;
                  const credit = row.signed > 0;
                  return (
                    <tr key={row.id}>
                      <td>
                        <div>{whenLabel(row.createdAt)}</div>
                        <div
                          className="note"
                          style={{ fontSize: 11, whiteSpace: "nowrap" }}
                        >
                          {exactStamp(row.createdAt)}
                        </div>
                      </td>
                      <td>
                        <div>{whatLabel(row)}</div>
                        {row.detail ? (
                          <div className="note" style={{ fontSize: 11.5 }}>
                            {row.detail}
                          </div>
                        ) : null}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: zero
                            ? "var(--muted)"
                            : credit
                              ? "var(--green)"
                              : "var(--red)",
                          fontFamily: "var(--mono)",
                        }}
                      >
                        {zero ? "" : credit ? "+" : "−"}
                        {nf.format(Math.abs(row.signed))}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--mono)",
                        }}
                      >
                        {nf.format(Math.max(0, rowBalance))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {truncated && onLastPage ? (
            <p className="note" style={{ marginTop: 10, fontSize: 12 }}>
              Showing your most recent activity. Older movements aren&apos;t
              listed here.
            </p>
          ) : null}

          {pageCount > 1 ? (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 12,
              }}
            >
              <button
                type="button"
                className="btn sm"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Prev
              </button>
              <span className="note" style={{ fontSize: 12 }}>
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                type="button"
                className="btn sm"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next →
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
