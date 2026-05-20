// Unit tests for the cost-counter / CronRun lifecycle.
//
// Strategy: mock @/lib/prisma so the tests don't need a real database.
// The mock records what would have been written so we can assert on it.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- Mock setup ---------------------------------------------------------

interface FakeRow {
  id: string;
  job: string;
  status: "RUNNING" | "OK" | "PARTIAL" | "FAILED";
  startedAt: Date;
  finishedAt: Date | null;
  itemsProcessed: number;
  costUsd: number;
  errorMessage: string | null;
}

const fakeDb = {
  rows: new Map<string, FakeRow>(),
  nextId: 1,
  reset() {
    this.rows.clear();
    this.nextId = 1;
  },
};

vi.mock("@/lib/prisma", () => ({
  default: {
    cronRun: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            job: string;
            status: string;
            costUsd?: number | null;
            itemsProcessed?: number;
          };
        }) => {
          const id = `run_${fakeDb.nextId++}`;
          // Mimic Postgres: nullable column without DB default = NULL when
          // not specified. This catches the "forgot to init costUsd to 0"
          // bug — Prisma's { increment } on NULL yields NULL in Postgres.
          const row: FakeRow = {
            id,
            job: data.job,
            status: data.status as FakeRow["status"],
            startedAt: new Date(),
            finishedAt: null,
            itemsProcessed: data.itemsProcessed ?? 0,
            costUsd: data.costUsd ?? (null as unknown as number),
            errorMessage: null,
          };
          fakeDb.rows.set(id, row);
          return { id, job: data.job, startedAt: row.startedAt };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = fakeDb.rows.get(where.id);
          if (!row) throw new Error(`row ${where.id} not found`);
          for (const [k, v] of Object.entries(data)) {
            if (
              k === "costUsd" &&
              typeof v === "object" &&
              v !== null &&
              "increment" in v
            ) {
              const inc = (v as { increment: number }).increment;
              // Mimic Postgres `NULL + x = NULL` — if costUsd is still NULL,
              // increments are silently lost (the bug code-reviewer caught).
              row.costUsd =
                row.costUsd == null
                  ? (null as unknown as number)
                  : row.costUsd + inc;
            } else if (k === "status") {
              row.status = v as FakeRow["status"];
            } else if (k === "finishedAt") {
              row.finishedAt = v as Date;
            } else if (k === "itemsProcessed") {
              row.itemsProcessed = v as number;
            } else if (k === "errorMessage") {
              row.errorMessage = v as string;
            } else if (k === "costUsd") {
              row.costUsd = v as number;
            }
          }
          return row;
        },
      ),
    },
  },
}));

// Imports must come AFTER vi.mock — the mock is hoisted.
import {
  assertCronContext,
  closeCronRun,
  getCurrentCronRun,
  incrementCost,
  openCronRun,
  withCostCounter,
  withCronRun,
} from "@/lib/cost/cost-counter";

beforeEach(() => {
  fakeDb.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- Tests --------------------------------------------------------------

describe("cost-counter · CronRun lifecycle", () => {
  test("openCronRun creates a RUNNING row with costUsd initialized to 0", async () => {
    const run = await openCronRun("test:job-a");
    expect(run.id).toMatch(/^run_/);
    expect(run.job).toBe("test:job-a");
    const row = fakeDb.rows.get(run.id)!;
    expect(row.status).toBe("RUNNING");
    // Critical: costUsd MUST be 0, not NULL. Prisma's { increment } over
    // NULL stays NULL in Postgres, which would silently break every
    // adapter's cost accumulation. Regression guard.
    expect(row.costUsd).toBe(0);
  });

  test("closeCronRun finalizes status + finishedAt", async () => {
    const run = await openCronRun("test:close");
    await closeCronRun(run.id, "OK", 42);
    const row = fakeDb.rows.get(run.id)!;
    expect(row.status).toBe("OK");
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.itemsProcessed).toBe(42);
  });

  test("withCronRun binds context for fn body + closes OK on success", async () => {
    const result = await withCronRun("test:wrapped", async (ctx) => {
      const handle = getCurrentCronRun();
      expect(handle?.id).toBe(ctx.runId);
      expect(handle?.job).toBe("test:wrapped");
      return 7;
    });
    expect(result).toBe(7);
    // One row, status OK
    const rows = [...fakeDb.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("OK");
    expect(rows[0].finishedAt).toBeInstanceOf(Date);
  });

  test("withCronRun closes FAILED on thrown error + re-throws", async () => {
    await expect(
      withCronRun("test:fail", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = [...fakeDb.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].errorMessage).toBe("boom");
  });

  test("outside withCronRun, getCurrentCronRun returns null", () => {
    expect(getCurrentCronRun()).toBeNull();
  });

  test("assertCronContext throws with helpful message when outside", () => {
    expect(() => assertCronContext("dataforseo.maps.search")).toThrow(
      /dataforseo\.maps\.search.*outside of an open CronRun/,
    );
  });
});

describe("cost-counter · withCostCounter", () => {
  test("throws when called outside an open CronRun", async () => {
    const wrapped = withCostCounter("test.op", 0.001, async () => "result");
    await expect(wrapped()).rejects.toThrow(/test\.op.*outside of an open CronRun/);
  });

  test("increments costUsd by unit cost on success", async () => {
    await withCronRun("test:cost-1", async () => {
      const wrapped = withCostCounter("vendor.op", 0.0006, async () => "ok");
      const out = await wrapped();
      expect(out).toBe("ok");
    });
    const row = [...fakeDb.rows.values()][0];
    expect(row.costUsd).toBeCloseTo(0.0006, 8);
  });

  test("accumulates cost across multiple calls", async () => {
    await withCronRun("test:cost-multi", async () => {
      const wrapped = withCostCounter("vendor.op", 0.001, async () => true);
      await wrapped();
      await wrapped();
      await wrapped();
    });
    const row = [...fakeDb.rows.values()][0];
    expect(row.costUsd).toBeCloseTo(0.003, 8);
  });

  test("does NOT increment when the wrapped fn throws", async () => {
    await expect(
      withCronRun("test:cost-throw", async () => {
        const wrapped = withCostCounter("vendor.op", 0.005, async () => {
          throw new Error("upstream-500");
        });
        await wrapped();
      }),
    ).rejects.toThrow("upstream-500");
    // The CronRun closes FAILED with costUsd === 0
    const row = [...fakeDb.rows.values()][0];
    expect(row.costUsd).toBe(0);
    expect(row.status).toBe("FAILED");
  });

  test("rejects negative or NaN unit cost at wrap time", () => {
    expect(() => withCostCounter("bad", -0.01, async () => 1)).toThrow(
      /non-negative finite/,
    );
    expect(() => withCostCounter("bad", Number.NaN, async () => 1)).toThrow(
      /non-negative finite/,
    );
  });

  test("zero unit cost is allowed (cached call)", async () => {
    await withCronRun("test:cost-zero", async () => {
      const wrapped = withCostCounter("vendor.op.cached", 0, async () => "cached");
      const out = await wrapped();
      expect(out).toBe("cached");
    });
    const row = [...fakeDb.rows.values()][0];
    expect(row.costUsd).toBe(0);
  });

  test("preserves the wrapped fn signature (args + return type)", async () => {
    await withCronRun("test:cost-args", async () => {
      const wrapped = withCostCounter(
        "vendor.echo",
        0.001,
        async (a: number, b: string) => `${a}:${b}`,
      );
      expect(await wrapped(42, "hi")).toBe("42:hi");
    });
  });
});

describe("cost-counter · incrementCost (dynamic pricing)", () => {
  test("works inside a CronRun, throws outside", async () => {
    await expect(incrementCost(0.01)).rejects.toThrow(/outside of an open CronRun/);
    await withCronRun("test:dyn", async () => {
      await incrementCost(0.005);
      await incrementCost(0.0001);
    });
    const row = [...fakeDb.rows.values()][0];
    expect(row.costUsd).toBeCloseTo(0.0051, 8);
  });

  test("zero usd is a no-op", async () => {
    await withCronRun("test:dyn-zero", async () => {
      await incrementCost(0);
    });
    const row = [...fakeDb.rows.values()][0];
    expect(row.costUsd).toBe(0);
  });

  test("rejects negative or NaN", async () => {
    await withCronRun("test:dyn-bad", async () => {
      await expect(incrementCost(-1)).rejects.toThrow(/non-negative finite/);
      await expect(incrementCost(Number.NaN)).rejects.toThrow(/non-negative finite/);
    });
  });
});

describe("cost-counter · nesting + isolation", () => {
  test("nested withCronRun gives inner frame its own context, outer restored after", async () => {
    let outerId = "";
    let innerId = "";
    let postInnerId = "";
    await withCronRun("test:outer", async () => {
      outerId = getCurrentCronRun()!.id;
      await withCronRun("test:inner", async () => {
        innerId = getCurrentCronRun()!.id;
      });
      postInnerId = getCurrentCronRun()!.id;
    });
    expect(outerId).toBeTruthy();
    expect(innerId).toBeTruthy();
    expect(outerId).not.toBe(innerId);
    expect(postInnerId).toBe(outerId);
    // Two CronRun rows created
    expect(fakeDb.rows.size).toBe(2);
  });

  test("cost incremented inside inner CronRun bills the inner run, not outer", async () => {
    let outerRunId = "";
    let innerRunId = "";
    await withCronRun("test:outer-bill", async () => {
      outerRunId = getCurrentCronRun()!.id;
      // Cost attributed to outer
      const outerCall = withCostCounter("outer.op", 0.01, async () => 1);
      await outerCall();
      await withCronRun("test:inner-bill", async () => {
        innerRunId = getCurrentCronRun()!.id;
        const innerCall = withCostCounter("inner.op", 0.05, async () => 1);
        await innerCall();
      });
      // Back in outer scope — bill should go to outer again
      await outerCall();
    });
    const outer = fakeDb.rows.get(outerRunId)!;
    const inner = fakeDb.rows.get(innerRunId)!;
    expect(outer.costUsd).toBeCloseTo(0.02, 8); // 0.01 + 0.01
    expect(inner.costUsd).toBeCloseTo(0.05, 8);
  });

  test("concurrent withCronRun calls maintain isolated contexts (Promise.all)", async () => {
    const results = await Promise.all([
      withCronRun("test:par-a", async () => {
        await new Promise((r) => setTimeout(r, 5));
        await incrementCost(0.01);
        return getCurrentCronRun()!.id;
      }),
      withCronRun("test:par-b", async () => {
        await new Promise((r) => setTimeout(r, 1));
        await incrementCost(0.02);
        return getCurrentCronRun()!.id;
      }),
    ]);
    expect(results[0]).not.toBe(results[1]);
    const a = fakeDb.rows.get(results[0])!;
    const b = fakeDb.rows.get(results[1])!;
    expect(a.costUsd).toBeCloseTo(0.01, 8);
    expect(b.costUsd).toBeCloseTo(0.02, 8);
  });
});
