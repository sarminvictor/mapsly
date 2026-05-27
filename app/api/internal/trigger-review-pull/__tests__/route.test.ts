/**
 * Tests for /api/internal/trigger-review-pull (Task #81).
 *
 * Covers:
 *   - 401 when Authorization is missing / wrong token
 *   - 400 on invalid JSON or invalid body shape
 *   - 200 on successful trigger (passes through result)
 *   - 200 when guard skips (in_flight, no_cid, etc.)
 *   - 500 when triggerReviewPullForBusiness throws
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Fake CronRun store for withCronRun · mirrors the pattern used in
// services/ai/__tests__/reply-draft.test.ts so the cost-counter can
// open + close without needing real Prisma.
interface FakeRow {
  id: string;
  job: string;
  costUsd: number;
}
const fakeDb = { rows: new Map<string, FakeRow>(), nextId: 1 };

vi.mock("@/lib/prisma", () => ({
  default: {
    cronRun: {
      create: vi.fn(async ({ data }: { data: { job: string } }) => {
        const id = `run_${fakeDb.nextId++}`;
        fakeDb.rows.set(id, { id, job: data.job, costUsd: 0 });
        return { id, job: data.job, startedAt: new Date() };
      }),
      update: vi.fn(async ({ where }: { where: { id: string } }) => {
        return fakeDb.rows.get(where.id) ?? null;
      }),
    },
  },
  Prisma: { sql: vi.fn() },
}));

const { triggerMock } = vi.hoisted(() => ({ triggerMock: vi.fn() }));

vi.mock("@/modules/reviews/trigger-pull", () => ({
  triggerReviewPullForBusiness: triggerMock,
}));

import { POST } from "../route";

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.nextId = 1;
  triggerMock.mockReset();
  process.env.BOXLY_WORKER_AUTH_TOKEN = "test-token";
});

afterEach(() => {
  delete process.env.BOXLY_WORKER_AUTH_TOKEN;
});

function req(opts: { body?: unknown; authHeader?: string | null }): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.authHeader !== null) {
    headers["authorization"] = opts.authHeader ?? "Bearer test-token";
  }
  return new Request("https://x/api/internal/trigger-review-pull", {
    method: "POST",
    headers,
    body:
      opts.body !== undefined
        ? typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body)
        : undefined,
  });
}

describe("POST /api/internal/trigger-review-pull · auth", () => {
  test("401 when Authorization header missing", async () => {
    const res = await POST(req({ authHeader: null, body: {} }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
    expect(triggerMock).not.toHaveBeenCalled();
  });

  test("401 when bearer token doesn't match", async () => {
    const res = await POST(
      req({ authHeader: "Bearer wrong-token", body: { businessId: "x" } }),
    );
    expect(res.status).toBe(401);
    expect(triggerMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/trigger-review-pull · validation", () => {
  test("400 on malformed JSON", async () => {
    const res = await POST(req({ body: "{not json" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("malformed_json");
  });

  test("400 on missing businessId", async () => {
    const res = await POST(req({ body: { mode: "manual" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
    expect(body.details).toBeDefined();
  });

  test("400 on invalid mode", async () => {
    const res = await POST(
      req({ body: { businessId: "biz-1", mode: "unknown" } }),
    );
    expect(res.status).toBe(400);
  });

  test("400 on out-of-range depth", async () => {
    const res = await POST(
      req({ body: { businessId: "biz-1", depth: 99999 } }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/internal/trigger-review-pull · trigger paths", () => {
  test("200 on successful trigger · returns outcome", async () => {
    triggerMock.mockResolvedValueOnce({
      triggered: true,
      taskId: "dfs-task-abc",
      mode: "manual",
    });
    const res = await POST(req({ body: { businessId: "biz-1" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      businessId: "biz-1",
      mode: "manual",
      triggered: true,
      taskId: "dfs-task-abc",
    });
    expect(triggerMock).toHaveBeenCalledWith("biz-1", {
      mode: "manual",
      depth: undefined,
    });
  });

  test("200 when guard skips (e.g. in_flight) · worker doesn't retry", async () => {
    triggerMock.mockResolvedValueOnce({
      triggered: false,
      reason: "in_flight",
    });
    const res = await POST(
      req({ body: { businessId: "biz-1", mode: "delta" } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      triggered: false,
      reason: "in_flight",
    });
  });

  test("404 on business_not_found (Error contains 'not found')", async () => {
    triggerMock.mockRejectedValueOnce(new Error("Business not found"));
    const res = await POST(req({ body: { businessId: "biz-x" } }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("business_not_found");
  });

  test("500 on other errors · worker retries", async () => {
    triggerMock.mockRejectedValueOnce(new Error("Neon WebSocket dropped"));
    const res = await POST(req({ body: { businessId: "biz-1" } }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(body.message).toContain("Neon WebSocket dropped");
  });

  test("default mode is 'manual' when not provided", async () => {
    triggerMock.mockResolvedValueOnce({
      triggered: true,
      taskId: "t",
      mode: "manual",
    });
    await POST(req({ body: { businessId: "biz-1" } }));
    expect(triggerMock).toHaveBeenCalledWith("biz-1", {
      mode: "manual",
      depth: undefined,
    });
  });

  test("forwards depth when provided", async () => {
    triggerMock.mockResolvedValueOnce({
      triggered: true,
      taskId: "t",
      mode: "initial",
    });
    await POST(
      req({ body: { businessId: "biz-1", mode: "initial", depth: 1500 } }),
    );
    expect(triggerMock).toHaveBeenCalledWith("biz-1", {
      mode: "initial",
      depth: 1500,
    });
  });
});
