import { describe, expect, test } from "vitest";

import {
  collapseLedger,
  collapseWithBalance,
  type LedgerMovement,
} from "@/modules/billing/ledger-view";

// Newest-first, like the DB query (orderBy createdAt desc).
function mv(
  partial: Partial<LedgerMovement> & { type: string; credits: number },
): LedgerMovement {
  return {
    id: partial.id ?? `${partial.type}-${Math.round(partial.credits * 100)}`,
    note: partial.note ?? null,
    createdAt: partial.createdAt ?? new Date("2026-07-09T12:00:00Z"),
    detail: partial.detail ?? null,
    runId: partial.runId ?? null,
    ...partial,
  };
}

describe("collapseLedger · run rows net correctly", () => {
  test("a fully-charged run nets to −charge (not −hold−charge)", () => {
    // TOPUP +50, then a 10-credit run: HOLD 10 → SETTLE 10.
    const rows: LedgerMovement[] = [
      mv({ id: "s", type: "SETTLE", credits: 10, runId: "r1" }),
      mv({ id: "h", type: "HOLD", credits: 10, runId: "r1" }),
      mv({ id: "t", type: "TOPUP", credits: 50 }),
    ];
    const out = collapseLedger(rows);
    // One collapsed run row + the top-up = 2 rows (the old bug showed 3).
    expect(out).toHaveLength(2);
    const run = out.find((r) => r.id === "r1")!;
    expect(run.kind).toBe("run-settled");
    expect(run.signed).toBe(-10); // NOT −20
    const topup = out.find((r) => r.type === "TOPUP")!;
    expect(topup.signed).toBe(50);
  });

  test("running balance is correct across a hold→settle cycle", () => {
    // True history: TOPUP 50 → 50, HOLD 10 → 40, SETTLE 10 → 40. Current = 40.
    const rows: LedgerMovement[] = [
      mv({ id: "s", type: "SETTLE", credits: 10, runId: "r1" }),
      mv({ id: "h", type: "HOLD", credits: 10, runId: "r1" }),
      mv({ id: "t", type: "TOPUP", credits: 50 }),
    ];
    const withBal = collapseWithBalance(rows, 40);
    // Newest-first: run row shows balance 40 (after), top-up shows 50 (after).
    expect(withBal[0].row.id).toBe("r1");
    expect(withBal[0].rowBalance).toBe(40);
    expect(withBal[1].row.type).toBe("TOPUP");
    expect(withBal[1].rowBalance).toBe(50);
  });

  test("a partial-refund run nets to −charge", () => {
    // HOLD 10, SETTLE 6, REFUND 4 → spent 6.
    const rows: LedgerMovement[] = [
      mv({ id: "rf", type: "REFUND", credits: 4, runId: "r2" }),
      mv({ id: "st", type: "SETTLE", credits: 6, runId: "r2" }),
      mv({ id: "hd", type: "HOLD", credits: 10, runId: "r2" }),
    ];
    const run = collapseLedger(rows)[0];
    expect(run.signed).toBe(-6); // −10 hold + 4 refund
    expect(run.kind).toBe("run-settled");
  });

  test("a failed run (full refund, no settle) nets to 0", () => {
    const rows: LedgerMovement[] = [
      mv({ id: "rf", type: "REFUND", credits: 10, runId: "r3" }),
      mv({ id: "hd", type: "HOLD", credits: 10, runId: "r3" }),
    ];
    const run = collapseLedger(rows)[0];
    expect(run.signed).toBe(0);
    expect(run.kind).toBe("run-refunded");
  });

  test("an in-flight run (hold only) shows the reservation as negative", () => {
    const rows: LedgerMovement[] = [
      mv({ id: "hd", type: "HOLD", credits: 200, runId: "r4" }),
    ];
    const run = collapseLedger(rows)[0];
    expect(run.signed).toBe(-200);
    expect(run.kind).toBe("run-pending");
  });

  test("interleaved runs each collapse independently and preserve order", () => {
    const t = (s: string) => new Date(s);
    const rows: LedgerMovement[] = [
      mv({
        id: "b-s",
        type: "SETTLE",
        credits: 5,
        runId: "B",
        createdAt: t("2026-07-09T15:00:00Z"),
      }),
      mv({
        id: "a-s",
        type: "SETTLE",
        credits: 3,
        runId: "A",
        createdAt: t("2026-07-09T14:00:00Z"),
      }),
      mv({
        id: "b-h",
        type: "HOLD",
        credits: 5,
        runId: "B",
        createdAt: t("2026-07-09T13:00:00Z"),
      }),
      mv({
        id: "a-h",
        type: "HOLD",
        credits: 3,
        runId: "A",
        createdAt: t("2026-07-09T12:00:00Z"),
      }),
    ];
    const out = collapseLedger(rows);
    expect(out.map((r) => r.id)).toEqual(["B", "A"]); // newest group first
    expect(out[0].signed).toBe(-5);
    expect(out[1].signed).toBe(-3);
  });

  test("top-ups and grants pass through with the right sign", () => {
    const rows: LedgerMovement[] = [
      mv({
        id: "g",
        type: "TOPUP",
        credits: 750,
        note: "plan-grant:AGENCY_PRO:x",
      }),
      mv({
        id: "p",
        type: "TOPUP",
        credits: 1000,
        note: "topup-purchase:sess",
      }),
    ];
    const out = collapseLedger(rows);
    expect(out[0].signed).toBe(750);
    expect(out[0].kind).toBe("topup");
    expect(out[1].signed).toBe(1000);
  });
});
