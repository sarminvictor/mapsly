// Tests for the shared DataForSEO transport · retry, timeout, auth,
// envelope-status handling, error classification. Mocks fetch + prisma.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { costUsd?: number | { increment: number } };
        }) => {
          const row = fakeDb.rows.get(where.id);
          if (!row) return null;
          if (data.costUsd !== undefined) {
            if (
              typeof data.costUsd === "object" &&
              "increment" in data.costUsd
            ) {
              row.costUsd += data.costUsd.increment;
            }
          }
          return row;
        },
      ),
    },
    $executeRaw: vi.fn(async () => 1),
  },
  Prisma: { sql: vi.fn() },
}));

import { withCronRun } from "@/lib/cost/cost-counter";
import {
  __setCredentialsForTesting,
  __setFetchForTesting,
  __setSleepForTesting,
  DataForSeoError,
  dataforSeoPost,
} from "../client";

function envelope(opts: {
  statusCode?: number;
  taskStatusCode?: number;
  result?: unknown[] | null;
  message?: string;
}): string {
  return JSON.stringify({
    status_code: opts.statusCode ?? 20000,
    status_message: opts.message ?? "Ok.",
    tasks: [
      {
        id: "x",
        status_code: opts.taskStatusCode ?? 20000,
        status_message: opts.message ?? "Ok.",
        result: opts.result ?? [],
      },
    ],
  });
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.nextId = 1;
  __setCredentialsForTesting({ username: "u@example.com", password: "secret" });
  // Tests don't actually wait — replace sleep with a resolved promise.
  __setSleepForTesting(async () => undefined);
});

afterEach(() => {
  __setFetchForTesting(null);
  __setCredentialsForTesting(null);
  __setSleepForTesting(null);
});

describe("dataforSeoPost", () => {
  test("sends HTTP basic auth derived from credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(envelope({ result: [{ items: [] }] })),
    );
    __setFetchForTesting(fetchMock);

    await withCronRun("test", () =>
      dataforSeoPost({
        path: "/v3/some/endpoint",
        operation: "test.op",
        body: { keyword: "med spa" },
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + Buffer.from("u@example.com:secret").toString("base64"),
    );
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("wraps the body in an array (DataForSEO task batching shape)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(envelope({ result: [] })),
    );
    __setFetchForTesting(fetchMock);

    await withCronRun("test", () =>
      dataforSeoPost({
        path: "/v3/x",
        operation: "test.op",
        body: { keyword: "med spa" },
      }),
    );

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(typeof init.body).toBe("string");
    const parsed = JSON.parse(init.body as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({ keyword: "med spa" });
  });

  test("throws if path does not start with '/'", async () => {
    __setFetchForTesting(vi.fn<typeof fetch>());
    await expect(
      withCronRun("test", () =>
        dataforSeoPost({ path: "v3/x", operation: "test.op", body: {} }),
      ),
    ).rejects.toThrow(/path must start with/);
  });

  test("requires an open CronRun (assertCronContext invariant)", async () => {
    __setFetchForTesting(vi.fn<typeof fetch>());
    await expect(
      dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
    ).rejects.toThrow(/outside of an open CronRun/);
  });

  test("requires DATAFORSEO_USERNAME / PASSWORD", async () => {
    __setCredentialsForTesting(null);
    const prevUser = process.env.DATAFORSEO_USERNAME;
    const prevPass = process.env.DATAFORSEO_PASSWORD;
    delete process.env.DATAFORSEO_USERNAME;
    delete process.env.DATAFORSEO_PASSWORD;
    try {
      await expect(
        withCronRun("test", () =>
          dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
        ),
      ).rejects.toThrow(/DATAFORSEO_USERNAME/);
    } finally {
      if (prevUser) process.env.DATAFORSEO_USERNAME = prevUser;
      if (prevPass) process.env.DATAFORSEO_PASSWORD = prevPass;
    }
  });

  test("retries on 503 then succeeds (within retry budget)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse("upstream busy", 503))
      .mockResolvedValueOnce(jsonResponse(envelope({ result: [{}] })));
    __setFetchForTesting(fetchMock);

    const out = await withCronRun("test", () =>
      dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
    );
    expect(out.result).toEqual([{}]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does NOT retry on 401 (auth error is not retryable)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse("bad creds", 401));
    __setFetchForTesting(fetchMock);

    await expect(
      withCronRun("test", () =>
        dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
      ),
    ).rejects.toMatchObject({ httpStatus: 401, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("throws DataForSeoError on envelope status_code != 20000", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope({
            statusCode: 40000,
            message: "Bad Request",
          }),
        ),
      ),
    );

    await expect(
      withCronRun("test", () =>
        dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
      ),
    ).rejects.toMatchObject({
      envelopeStatusCode: 40000,
      retryable: false,
    });
  });

  test("retries on envelope status_code >= 50000 (server error)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(envelope({ statusCode: 50000, message: "internal" })),
      )
      .mockResolvedValueOnce(jsonResponse(envelope({ result: [{}] })));
    __setFetchForTesting(fetchMock);

    const out = await withCronRun("test", () =>
      dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
    );
    expect(out.result).toEqual([{}]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("normalizes task.result = null to empty array", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () => jsonResponse(envelope({ result: null }))),
    );
    const out = await withCronRun("test", () =>
      dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
    );
    expect(out.result).toEqual([]);
  });

  test("respects custom retry budget of 0", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse("503", 503));
    __setFetchForTesting(fetchMock);

    await expect(
      withCronRun("test", () =>
        dataforSeoPost({
          path: "/v3/x",
          operation: "test.op",
          body: {},
          retries: 0,
        }),
      ),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("wraps a transport-level Error into DataForSeoError(retryable)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNRESET"));
    __setFetchForTesting(fetchMock);
    await expect(
      withCronRun("test", () =>
        dataforSeoPost({
          path: "/v3/x",
          operation: "test.op",
          body: {},
          retries: 0,
        }),
      ),
    ).rejects.toBeInstanceOf(DataForSeoError);
  });

  test("retries when fetch throws a TimeoutError (AbortSignal.timeout)", async () => {
    // Simulate AbortSignal.timeout firing: it throws an Error whose .name is
    // "TimeoutError". The shared client treats this as retryable within budget.
    const timeoutErr = new Error("operation timed out");
    timeoutErr.name = "TimeoutError";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce(jsonResponse(envelope({ result: [{}] })));
    __setFetchForTesting(fetchMock);

    const out = await withCronRun("test", () =>
      dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
    );
    expect(out.result).toEqual([{}]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("error message does not echo the Authorization header", async () => {
    // Defense-in-depth: even if a 4xx response body includes our auth, the
    // wrapped error string must not. Today the client never includes
    // request-side data in error strings, but assert it to lock that in.
    __setFetchForTesting(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse("bad creds for u@example.com", 401)),
    );
    try {
      await withCronRun("test", () =>
        dataforSeoPost({ path: "/v3/x", operation: "test.op", body: {} }),
      );
      throw new Error("expected to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("Basic ");
      expect(msg).not.toContain("secret");
      expect(msg).not.toContain("u@example.com:secret");
    }
  });
});
