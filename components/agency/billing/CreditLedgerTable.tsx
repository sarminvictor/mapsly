/**
 * Credit ledger / usage table (prototype #view-billing lines 8349–8403).
 *
 * "Every credit in and out — your activity, not a bill." Columns: When (relative
 * date) / What (human description) / Credits (signed · red debit / green credit
 * / "Free" for discovery) / running Balance.
 *
 * Real data: rows come from `CreditLedger`. The running balance is computed
 * backwards from the wallet's current available balance — the newest row's
 * Balance is the current balance, and each older row's Balance is reconstructed
 * by undoing the newer movements above it.
 *
 * Server-presentational: every prop is plain serialized data.
 */

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
}

export interface CreditLedgerTableProps {
  /** Newest-first ledger rows. */
  rows: LedgerRow[];
  /** The wallet's current available balance (anchors the running balance). */
  currentBalance: number;
}

const nf = new Intl.NumberFormat("en-US");

/** Ledger types that ADD credits (shown +/green) vs draw down (red). */
function isCredit(type: string): boolean {
  return type === "TOPUP" || type === "REFUND" || type === "ADJUST";
}

/** Relative "When" label — Today / N days ago / a date. */
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

/** Human "What" description — prefer the note, fall back to the type. */
function whatLabel(row: LedgerRow): string {
  if (row.note && row.note.length > 0) return prettyNote(row.note);
  switch (row.type) {
    case "HOLD":
      return "Run hold";
    case "SETTLE":
      return "Run settled";
    case "REFUND":
      return "Failed run refund";
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

/** Tidy internal note sentinels into readable copy. */
function prettyNote(note: string): string {
  if (note === "free-tier-grant") return "Free plan · starter credits";
  if (note.startsWith("plan-grant:")) return "Plan · monthly allowance";
  if (note.startsWith("topup-purchase:")) return "Top-up purchase";
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
 * balance minus the newer row's signed effect. Pure (no render-scope mutation).
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
  const withBalance = withRunningBalance(rows, currentBalance);

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
            {withBalance.map(({ row, rowBalance, signed }) => {
              const credit = isCredit(row.type);
              return (
                <tr key={row.id}>
                  <td>{whenLabel(row.createdAt)}</td>
                  <td>{whatLabel(row)}</td>
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
                  <td style={{ textAlign: "right", fontFamily: "var(--mono)" }}>
                    {nf.format(Math.max(0, rowBalance))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
