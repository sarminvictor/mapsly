import { describe, expect, test } from "vitest";

import { decideUnit } from "../unit-decision";

describe("decideUnit · four-quadrant entitlement billing", () => {
  test("owned + fresh → SKIPPED_ENTITLED, free no-op", () => {
    expect(decideUnit(true, true)).toEqual({
      status: "SKIPPED_ENTITLED",
      billable: false,
      run: false,
      mint: false,
    });
  });

  test("not owned + fresh → CHARGED_FROM_DB, charge, no vendor, mint", () => {
    expect(decideUnit(false, true)).toEqual({
      status: "CHARGED_FROM_DB",
      billable: true,
      run: false,
      mint: true,
    });
  });

  test("not owned + stale → QUEUED, charge, run, mint (new buy)", () => {
    expect(decideUnit(false, false)).toEqual({
      status: "QUEUED",
      billable: true,
      run: true,
      mint: true,
    });
  });

  test("owned + stale → QUEUED, charge, run, mint (owner refresh of stale data)", () => {
    expect(decideUnit(true, false)).toEqual({
      status: "QUEUED",
      billable: true,
      run: true,
      mint: true,
    });
  });

  test("invariants: only owned∧fresh is free; freshness alone gates the vendor", () => {
    for (const owned of [true, false]) {
      for (const fresh of [true, false]) {
        const d = decideUnit(owned, fresh);
        expect(d.billable).toBe(!(owned && fresh)); // only owned-fresh is free
        expect(d.run).toBe(!fresh); // vendor runs iff stale
        expect(d.mint).toBe(d.billable); // mint on every charge
      }
    }
  });
});
