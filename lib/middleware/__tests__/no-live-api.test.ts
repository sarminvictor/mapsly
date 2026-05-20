// Unit tests for the cronHandler Route Handler wrapper.
//
// Mocks @/lib/prisma so withCronRun's CronRun lifecycle calls don't hit a
// real database. Mock setup mirrors lib/cost/__tests__/cost-counter.test.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeRow {
  id: string;
  job: string;
  status: "RUNNING" | "OK" | "PARTIAL" | "FAILED";
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
      create: vi.fn(async ({ data }: { data: { job: string; status: string } }) => {
        const id = `run_${fakeDb.nextId++}`;
        const row: FakeRow = {
          id,
          job: data.job,
          status: data.status as FakeRow["status"],
          finishedAt: null,
          itemsProcessed: 0,
          costUsd: 0,
          errorMessage: null,
        };
        fakeDb.rows.set(id, row);
        return { id, job: data.job, startedAt: new Date() };
      }),
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
            if (k === "status") row.status = v as FakeRow["status"];
            else if (k === "finishedAt") row.finishedAt = v as Date;
            else if (k === "errorMessage") row.errorMessage = v as string;
            else if (k === "itemsProcessed") row.itemsProcessed = v as number;
            else if (
              k === "costUsd" &&
              typeof v === "object" &&
              v !== null &&
              "increment" in v
            ) {
              row.costUsd += (v as { increment: number }).increment;
            }
          }
          return row;
        },
      ),
    },
  },
}));

import { cronHandler, requireCronContext } from "@/lib/middleware/no-live-api";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  fakeDb.reset();
  process.env.CRON_SECRET = "test-secret-abc";
});

afterEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe("cronHandler · auth", () => {
  test("rejects missing Authorization header with 401", async () => {
    const handler = cronHandler("test:auth", async () => undefined);
    const res = await handler(new Request("https://x/y"));
    expect(res.status).toBe(401);
  });

  test("rejects wrong bearer token with 401", async () => {
    const handler = cronHandler("test:auth", async () => undefined);
    const res = await handler(
      new Request("https://x/y", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("accepts matching bearer + opens CronRun", async () => {
    const handler = cronHandler("test:auth-ok", async () => ({ itemsProcessed: 3 }));
    const res = await handler(
      new Request("https://x/y", {
        headers: { authorization: "Bearer test-secret-abc" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, itemsProcessed: 3 });
    expect(fakeDb.rows.size).toBe(1);
    expect([...fakeDb.rows.values()][0].status).toBe("OK");
  });

  test("returns 500 if CRON_SECRET env var is unset", async () => {
    delete process.env.CRON_SECRET;
    const handler = cronHandler("test:no-secret", async () => undefined);
    const res = await handler(
      new Request("https://x/y", {
        headers: { authorization: "Bearer anything" },
      }),
    );
    expect(res.status).toBe(500);
  });

  test("secretEnvVar option overrides the default env name", async () => {
    process.env.OTHER_SECRET = "other-pass";
    const handler = cronHandler("test:other", async () => undefined, {
      secretEnvVar: "OTHER_SECRET",
    });
    const res = await handler(
      new Request("https://x/y", {
        headers: { authorization: "Bearer other-pass" },
      }),
    );
    expect(res.status).toBe(200);
    delete process.env.OTHER_SECRET;
  });
});

describe("cronHandler · CronRun lifecycle", () => {
  test("on thrown error: returns 500 + closes CronRun with FAILED", async () => {
    const handler = cronHandler("test:throw", async () => {
      throw new Error("upstream-broke");
    });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handler(
      new Request("https://x/y", {
        headers: { authorization: "Bearer test-secret-abc" },
      }),
    );
    consoleErr.mockRestore();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal_error", job: "test:throw" });
    const row = [...fakeDb.rows.values()][0];
    expect(row.status).toBe("FAILED");
    expect(row.errorMessage).toBe("upstream-broke");
  });

  test("body override returns the supplied body", async () => {
    const handler = cronHandler("test:body", async () => ({
      body: { custom: "shape", count: 7 },
    }));
    const res = await handler(
      new Request("https://x/y", {
        headers: { authorization: "Bearer test-secret-abc" },
      }),
    );
    const body = await res.json();
    expect(body).toEqual({ custom: "shape", count: 7 });
  });

  test("passes runId + job into the handler fn", async () => {
    let receivedRunId = "";
    let receivedJob = "";
    const handler = cronHandler("test:ctx", async (ctx) => {
      receivedRunId = ctx.runId;
      receivedJob = ctx.job;
    });
    await handler(
      new Request("https://x/y", {
        headers: { authorization: "Bearer test-secret-abc" },
      }),
    );
    expect(receivedRunId).toMatch(/^run_/);
    expect(receivedJob).toBe("test:ctx");
  });
});

describe("requireCronContext (re-export)", () => {
  test("throws outside a CronRun", () => {
    expect(() => requireCronContext("adapter.foo")).toThrow(
      /outside of an open CronRun/,
    );
  });
});
