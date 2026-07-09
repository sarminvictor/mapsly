/**
 * Credit-ledger display math — pure, unit-tested, no React or DB.
 *
 * The wallet writes THREE ledger rows for one enrichment run: a HOLD (reserve),
 * a SETTLE (the actual charge), and — when the charge is less than the hold — a
 * REFUND (release the unused reservation). settleRun (modules/cost/server.ts)
 * releases the held credits AT SETTLE, so the true effect of a hold→settle cycle
 * on the AVAILABLE balance (plan + rollover + purchased − held) is:
 *
 *   HOLD   → available −= credits         (heldCredits += credits)
 *   SETTLE → available += 0               (releases `charge` of hold, spends
 *                                          `charge` of buckets → net zero)
 *   REFUND → available += credits         (releases the unused hold)
 *
 * The old table treated HOLD and SETTLE as two independent −credits movements,
 * so it double-counted every settled charge (a 10-credit run read as −20) and
 * showed two red rows for one run. This collapses all run-scoped movements
 * (keyed by runId) into ONE net row per run — the number an agency reconciles
 * against. Non-run rows (top-ups, plan grants, adjustments) pass through
 * unchanged.
 *
 * BALANCE-COLUMN SCOPE: the running balance is seeded from the real current
 * wallet balance, so the newest row and every row within the current billing
 * cycle tie out exactly. It is NOT exact across a plan-renewal boundary: a
 * renewal SETs planCredits and silently EXPIRES the prior cycle's unused
 * credits WITHOUT writing an EXPIRE ledger row, and a grant row is a +credits
 * TOPUP, so rows OLDER than a renewal understate the balance by the expired
 * leftover. Pre-existing (grants were always TOPUP rows); closing it fully means
 * writing EXPIRE rows at reset — a deferred ledger-completeness pass.
 */

export interface LedgerMovement {
  id: string;
  /** CreditLedgerType: HOLD / SETTLE / REFUND / TOPUP / EXPIRE / ADJUST. */
  type: string;
  /** Magnitude of the movement (always >= 0 in the DB). */
  credits: number;
  note: string | null;
  createdAt: Date;
  /** Joined run detail (market · N businesses · what ran); null when none. */
  detail?: string | null;
  /** The run this movement belongs to; null for grants / top-ups. */
  runId?: string | null;
}

export interface LedgerDisplayRow {
  id: string;
  /** Which visual kind — drives the "What" label + color. */
  kind: "grant" | "topup" | "run-pending" | "run-settled" | "run-refunded";
  /** Original type for grants/top-ups (so existing note prettifying still runs). */
  type: string;
  note: string | null;
  createdAt: Date;
  detail?: string | null;
  /** Signed effect on the available balance (negative = spent). */
  signed: number;
}

export interface DisplayRowWithBalance {
  row: LedgerDisplayRow;
  /** The available balance AFTER this row (newest-first reconstruction). */
  rowBalance: number;
}

/** Run-scoped movement types (keyed by runId) that collapse into one row. */
const RUN_TYPES = new Set(["HOLD", "SETTLE", "REFUND"]);

/** Ledger types that ADD to the available balance when standalone. EXPIRE and
 *  anything else draw down (negative). */
function isStandaloneCredit(type: string): boolean {
  return type === "TOPUP" || type === "REFUND" || type === "ADJUST";
}

/**
 * Collapse newest-first ledger movements into display rows: run-scoped
 * HOLD/SETTLE/REFUND with the same runId merge into ONE net row; everything
 * else passes through. The net available effect of a run group is
 * `−ΣHOLD + ΣREFUND` (SETTLE nets zero because it releases the hold it spends) —
 * self-consistent even when a group's HOLD scrolled out of the loaded window.
 */
export function collapseLedger(rows: LedgerMovement[]): LedgerDisplayRow[] {
  const groups = new Map<string, LedgerMovement[]>();
  const order: string[] = []; // display order key, newest-first as encountered
  const standalone: LedgerDisplayRow[] = [];

  for (const r of rows) {
    const grouped = r.runId && RUN_TYPES.has(r.type);
    if (grouped) {
      const key = r.runId as string;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(`run:${key}`);
      }
      groups.get(key)!.push(r);
    } else {
      const key = `row:${r.id}`;
      order.push(key);
      standalone.push({
        id: r.id,
        kind: r.type === "TOPUP" ? "topup" : "grant",
        type: r.type,
        note: r.note,
        createdAt: r.createdAt,
        detail: r.detail ?? null,
        signed: isStandaloneCredit(r.type) ? r.credits : -r.credits,
      });
    }
  }

  const standaloneById = new Map(standalone.map((s) => [`row:${s.id}`, s]));

  const out: LedgerDisplayRow[] = [];
  for (const key of order) {
    if (key.startsWith("row:")) {
      const s = standaloneById.get(key);
      if (s) out.push(s);
      continue;
    }
    const runId = key.slice("run:".length);
    const g = groups.get(runId);
    if (!g) continue;

    let hold = 0;
    let settle = 0;
    let refund = 0;
    let detail: string | null = null;
    // Newest timestamp represents the group; the first HOLD's detail is richest.
    let newest = g[0].createdAt;
    for (const m of g) {
      if (m.type === "HOLD") hold += m.credits;
      else if (m.type === "SETTLE") settle += m.credits;
      else if (m.type === "REFUND") refund += m.credits;
      if (m.detail && !detail) detail = m.detail;
      if (m.createdAt.getTime() > newest.getTime()) newest = m.createdAt;
    }

    // Net available effect: −ΣHOLD + ΣREFUND (SETTLE releases what it spends).
    const signed = -hold + refund;
    const kind: LedgerDisplayRow["kind"] =
      settle > 0
        ? "run-settled"
        : refund > 0 && hold > 0
          ? "run-refunded"
          : "run-pending";

    out.push({
      id: runId,
      kind,
      type: settle > 0 ? "SETTLE" : refund > 0 ? "REFUND" : "HOLD",
      note: null,
      createdAt: newest,
      detail,
      signed,
    });
  }

  return out;
}

/**
 * Reconstruct a running available balance over COLLAPSED display rows
 * (newest-first). The newest row's balance is the current wallet balance; each
 * older row's balance is the newer balance minus the newer row's signed effect.
 */
export function withRunningBalance(
  rows: LedgerDisplayRow[],
  currentBalance: number,
): DisplayRowWithBalance[] {
  const out: DisplayRowWithBalance[] = [];
  let balance = currentBalance;
  for (const row of rows) {
    out.push({ row, rowBalance: balance });
    balance = balance - row.signed; // the balance BEFORE this row
  }
  return out;
}

/** Collapse + reconstruct in one call — the table's single entry point. */
export function collapseWithBalance(
  rows: LedgerMovement[],
  currentBalance: number,
): DisplayRowWithBalance[] {
  return withRunningBalance(collapseLedger(rows), currentBalance);
}
