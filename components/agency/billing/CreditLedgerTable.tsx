"use client";

/**
 * Credit ledger / usage table — reworked 2026-07-09 (Phase 5, billing
 * repricing). "Every credit in and out — your activity, not a bill."
 *
 * New this pass:
 *   - Pagination (10 rows / page) over the ≤50 rows the page loads.
 *   - Full timestamps (Mon D, YYYY · HH:MM) alongside the relative "When".
 *   - Action detail line under "What" — market · N businesses · what ran
 *     (joined from run metadata server-side; see modules/billing/usage-detail).
 *
 * `'use client'` for the page-state only; every prop is plain serialized data
 * (Date survives the RSC boundary). Running balance is reconstructed once over
 * ALL rows, then sliced per page so the numbers stay correct across pages.
 */

import { useState } from "react";

export interface LedgerRow {
  id: string;
  /** CreditLedgerType: HOLD / SETTLE / REFUND / TOPUP / EXPIRE / ADJUST. */
  type: string;
  /** Magnitude of the movement (always >= 0 in the DB). */
  credits: number;
  /** Optional human note carried on the ledger row. */
  note: string | null;
  /** When the movement happened. */
  createdAt: Date;
  /** Joined run detail (market · N businesses · what ran); null when none. */
  detail?: string | null;
}

export interface CreditLedgerTableProps {
  /** Newest-first ledger rows. */
  rows: LedgerRow[];
  /** The wallet's current available balance (anchors the running balance). */
  currentBalance: number;
}

const nf = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 10;

/** Ledger types that ADD credits (shown +/green) vs draw down (red). */
function isCredit(type: string): boolean {
  return type === "TOPUP" || type === "REFUND" || type === "ADJUST";
}

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

/** Human "What" description — prefer the note, fall back to the type. */
function whatLabel(row: LedgerRow): string {
  if (row.note && row.note.length > 0) {
    const pretty = prettyNote(row.note);
    if (pretty) return pretty;
  }
  switch (row.type) {
    case "HOLD":
      return "Run hold";
    case "SETTLE":
      return "Run settled";
    case "REFUND":
      return "Refund";
    case "TOPUP":
      return "Credits added";
    case "EXPIRE":
      return "Credits expired";
    case "ADJUST":
      return "Adjustment";
    default:
      return row.type;
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

interface RowWithBalance {
  row: LedgerRow;
  rowBalance: number;
  signed: number;
}

/**
 * Reconstruct a running balance from newest-first rows: the newest row's
 * balance is the current wallet balance; each older row's balance = the newer
 * balance minus the newer row's signed effect.
 */
function withRunningBalance(
  rows: LedgerRow[],
  currentBalance: number,
): RowWithBalance[] {
  const out: RowWithBalance[] = [];
  let balance = currentBalance;
  for (const row of rows) {
    const signed = isCredit(row.type) ? row.credits : -row.credits;
    out.push({ row, rowBalance: balance, signed });
    balance = balance - signed; // the balance BEFORE this row
  }
  return out;
}

export function CreditLedgerTable({
  rows,
  currentBalance,
}: CreditLedgerTableProps) {
  const [page, setPage] = useState(0);
  const withBalance = withRunningBalance(rows, currentBalance);
  const pageCount = Math.max(1, Math.ceil(withBalance.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = withBalance.slice(start, start + PAGE_SIZE);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Usage</h2>
      <p className="note" style={{ marginTop: -4 }}>
        Every credit in and out — your activity, not a bill.
      </p>
      {rows.length === 0 ? (
        <p className="note" style={{ marginTop: 8 }}>
          No credit activity yet. Discovery is free; enrichment runs settle
          here.
        </p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th style={{ textAlign: "right" }}>Credits</th>
                  <th style={{ textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ row, rowBalance, signed }) => {
                  const credit = isCredit(row.type);
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
                          color: credit ? "var(--green)" : "var(--red)",
                          fontFamily: "var(--mono)",
                        }}
                      >
                        {credit ? "+" : "−"}
                        {nf.format(Math.abs(signed))}
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
