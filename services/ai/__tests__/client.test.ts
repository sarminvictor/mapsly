// Unit tests for callOpenAi. Mocks global fetch so no network call, and
// mocks @/lib/prisma so no DB. Validates: cron-context invariant, ceiling
// guard, json-mode passthrough, HTTP error handling, cost-on-success-only.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- Fake Prisma for cost-counter --------------------------------------

interface FakeRow {
  id: string;
  job: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  costUsd: number;
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
        async ({ data }: { data: { job: string; costUsd?: number } }) => {
          const id = `run_${fakeDb.nextId++}`;
          const row: FakeRow = {
            id,
            job: data.job,
            status: "RUNNING",
            startedAt: new Date(),
            finishedAt: null,
            costUsd: data.costUsd ?? 0,
          };
          fakeDb.rows.set(id, row);
          return { id, job: row.job, startedAt: row.startedAt };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            status?: string;
            finishedAt?: Date;
            costUsd?: number | { increment: number };
          };
        }) => {
          const row = fakeDb.rows.get(where.id);
          if (!row) throw new Error(`no row ${where.id}`);
          if (data.status !== undefined) row.status = data.status;
          if (data.finishedAt !== undefined) row.finishedAt = data.finishedAt;
          if (data.costUsd !== undefined) {
            if (
              typeof data.costUsd === "object" &&
              "increment" in data.costUsd
            ) {
              row.costUsd += data.costUsd.increment;
            } else {
              row.costUsd = data.costUsd as number;
            }
          }
          return row;
        },
      ),
    },
  },
  Prisma: { sql: vi.fn() },
}));

// ---- Imports under test (after mocks) ----------------------------------

import { withCronRun } from "@/lib/cost/cost-counter";
import {
  callOpenAi,
  __setApiKeyForTesting,
  __setFetchForTesting,
  __setSleepForTesting,
} from "../client";

// Helper: build a minimal OK response from OpenAI shape.
function okResponse({
  content,
  promptTokens,
  completionTokens,
  cachedTokens,
  model = "gpt-5.4-nano",
  finishReason = "stop",
}: {
  content: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  model?: string;
  finishReason?: string;
}): Response {
  const body = {
    id: "chatcmpl-test",
    model,
    choices: [
      {
        finish_reason: finishReason,
        message: { role: "assistant", content },
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      prompt_tokens_details: { cached_tokens: cachedTokens ?? 0 },
    },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fakeDb.reset();
  __setApiKeyForTesting("test-key");
  __setSleepForTesting(async () => undefined); // WP3-8 · no real backoff wait
});

afterEach(() => {
  __setFetchForTesting(null);
  __setApiKeyForTesting(null);
  __setSleepForTesting(null);
});

describe("callOpenAi", () => {
  test("throws if called outside a CronRun", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        okResponse({ content: "hi", promptTokens: 10, completionTokens: 5 }),
      ),
    );
    await expect(
      callOpenAi({
        operation: "test",
        model: "gpt-5.4-nano",
        maxTokens: 64,
        prompt: "hi",
      }),
    ).rejects.toThrow(/outside of an open CronRun/);
  });

  test("returns text + usage from a successful call", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      okResponse({
        content: "Hello world",
        promptTokens: 10,
        completionTokens: 3,
      }),
    );
    __setFetchForTesting(fetchMock);

    const result = await withCronRun("test-job", () =>
      callOpenAi({
        operation: "test",
        model: "gpt-5.4-nano",
        maxTokens: 64,
        prompt: "hi",
      }),
    );
    expect(result.text).toBe("Hello world");
    expect(result.finishReason).toBe("stop");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(3);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // WP3-8 · retry on a 429 then succeed (matches the DfS adapter's resilience).
  test("retries a 429 then succeeds", async () => {
    let calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return okResponse({
        content: "recovered",
        promptTokens: 5,
        completionTokens: 2,
      });
    });
    __setFetchForTesting(fetchMock);

    const result = await withCronRun("test-job", () =>
      callOpenAi({
        operation: "test",
        model: "gpt-5.4-nano",
        maxTokens: 64,
        prompt: "hi",
      }),
    );
    expect(result.text).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2); // 429 then 200
  });

  // WP3-8 · retry on a timeout/network error (rejected fetch) then succeed.
  test("retries a transport error (timeout) then succeeds", async () => {
    let calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("The operation was aborted");
        err.name = "TimeoutError";
        throw err;
      }
      return okResponse({
        content: "ok",
        promptTokens: 1,
        completionTokens: 1,
      });
    });
    __setFetchForTesting(fetchMock);

    const result = await withCronRun("test-job", () =>
      callOpenAi({
        operation: "test",
        model: "gpt-5.4-nano",
        maxTokens: 64,
        prompt: "hi",
      }),
    );
    expect(result.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("posts JSON body with model + messages + max_tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      okResponse({ content: "x", promptTokens: 1, completionTokens: 1 }),
    );
    __setFetchForTesting(fetchMock);

    await withCronRun("test-job", () =>
      callOpenAi({
        operation: "test",
        model: "gpt-5.4-mini",
        maxTokens: 200,
        temperature: 0.7,
        system: "You are tested.",
        prompt: "Hi.",
        jsonMode: true,
        seed: 42,
      }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      max_completion_tokens: number;
      temperature?: number;
      response_format?: { type: string };
      seed?: number;
    };
    expect(body.model).toBe("gpt-5.4-mini");
    // OpenAI deprecated `max_tokens` for gpt-5.x in favor of
    // `max_completion_tokens` — see services/ai/client.ts § 151.
    expect(body.max_completion_tokens).toBe(200);
    // gpt-5.x rejects explicit temperature · the client omits the field
    // for any model whose name starts with "gpt-5".
    expect(body.temperature).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.seed).toBe(42);
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are tested.",
    });
    expect(body.messages[1]).toEqual({ role: "user", content: "Hi." });
  });

  test("increments CronRun.costUsd by computed cost", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        okResponse({
          content: "x",
          promptTokens: 1_000_000,
          completionTokens: 0,
          model: "gpt-5.4-nano",
        }),
      ),
    );
    await withCronRun("test-job", () =>
      callOpenAi({
        operation: "test",
        model: "gpt-5.4-nano",
        maxTokens: 64,
        prompt: "hi",
      }),
    );
    // 1M input × $0.20/MTok = $0.20 (gpt-5.4-nano current pricing per
    // services/ai/pricing.ts · $0.20 in / $1.25 out per 1M tokens).
    const row = Array.from(fakeDb.rows.values())[0]!;
    expect(row.costUsd).toBeCloseTo(0.2, 6);
  });

  test("rejects when computed cost exceeds ceiling — but BILLS the real spend first", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        okResponse({
          content: "x",
          promptTokens: 20_000_000, // 20M × $0.20/MTok = $4.00 → exceeds default $0.5 ceiling
          completionTokens: 0,
          model: "gpt-5.4-nano",
        }),
      ),
    );
    await expect(
      withCronRun("test-job", () =>
        callOpenAi({
          operation: "test",
          model: "gpt-5.4-nano",
          maxTokens: 64,
          prompt: "hi",
        }),
      ),
    ).rejects.toThrow(/exceeded ceiling/);
    // The API already responded — the money is SPENT. The ceiling
    // throw must not hide that spend from the CronRun ledger
    // (2026-06-11 audit: ceiling violations were paid to OpenAI but
    // recorded as $0, violating cost-discipline rule 3). The run is
    // marked FAILED; the cost on it is the real one.
    const row = Array.from(fakeDb.rows.values())[0]!;
    expect(row.costUsd).toBeCloseTo(4.0, 2);
  });

  test("explicit costCeilingUsd overrides default", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        okResponse({
          content: "x",
          promptTokens: 20_000_000,
          completionTokens: 0,
          model: "gpt-5.4-nano",
        }),
      ),
    );
    const result = await withCronRun("test-job", () =>
      callOpenAi({
        operation: "test",
        model: "gpt-5.4-nano",
        maxTokens: 64,
        prompt: "hi",
        costCeilingUsd: 5,
      }),
    );
    // 20M input × $0.20/MTok = $4.00 (under the explicit $5 ceiling).
    expect(result.costUsd).toBeCloseTo(4, 6);
  });

  test("throws on non-2xx HTTP response (does NOT bill)", async () => {
    __setFetchForTesting(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "bad request" } }), {
            status: 400,
            statusText: "Bad Request",
          }),
      ),
    );
    await expect(
      withCronRun("test-job", () =>
        callOpenAi({
          operation: "test",
          model: "gpt-5.4-nano",
          maxTokens: 64,
          prompt: "hi",
        }),
      ),
    ).rejects.toThrow(/HTTP 400/);
    const row = Array.from(fakeDb.rows.values())[0]!;
    expect(row.costUsd).toBe(0);
  });

  test("throws if OPENAI_API_KEY is missing", async () => {
    __setApiKeyForTesting(null);
    delete process.env.OPENAI_API_KEY;
    __setFetchForTesting(
      vi.fn(async () =>
        okResponse({ content: "x", promptTokens: 1, completionTokens: 1 }),
      ),
    );
    await expect(
      withCronRun("test-job", () =>
        callOpenAi({
          operation: "test",
          model: "gpt-5.4-nano",
          maxTokens: 64,
          prompt: "hi",
        }),
      ),
    ).rejects.toThrow(/OPENAI_API_KEY is not set/);
  });

  test("rejects non-positive maxTokens", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        okResponse({ content: "x", promptTokens: 1, completionTokens: 1 }),
      ),
    );
    await expect(
      withCronRun("test-job", () =>
        callOpenAi({
          operation: "test",
          model: "gpt-5.4-nano",
          maxTokens: 0,
          prompt: "hi",
        }),
      ),
    ).rejects.toThrow(/maxTokens must be a positive integer/);
  });

  test("normalizes cached_tokens from prompt_tokens_details", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        okResponse({
          content: "x",
          promptTokens: 1000,
          completionTokens: 100,
          cachedTokens: 800,
        }),
      ),
    );
    const result = await withCronRun("test-job", () =>
      callOpenAi({
        operation: "test",
        model: "gpt-5.4-nano",
        maxTokens: 64,
        prompt: "hi",
      }),
    );
    expect(result.usage.cachedInputTokens).toBe(800);
  });
});
