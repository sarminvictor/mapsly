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
});

afterEach(() => {
  __setFetchForTesting(null);
  __setApiKeyForTesting(null);
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
    const fetchMock = vi.fn(async () =>
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

  test("posts JSON body with model + messages + max_tokens", async () => {
    const fetchMock = vi.fn(async () =>
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
      max_tokens: number;
      temperature: number;
      response_format?: { type: string };
      seed?: number;
    };
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.max_tokens).toBe(200);
    expect(body.temperature).toBe(0.7);
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
    // 1M input × $0.05/MTok = $0.05
    const row = Array.from(fakeDb.rows.values())[0]!;
    expect(row.costUsd).toBeCloseTo(0.05, 6);
  });

  test("rejects when computed cost exceeds ceiling (does NOT bill)", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        okResponse({
          content: "x",
          promptTokens: 20_000_000, // 20M × $0.05/MTok = $1.00 → exceeds default $0.5 ceiling
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
    // The withCronRun wrapper marks the run FAILED but cost should be 0
    // because the ceiling check throws BEFORE incrementCost.
    const row = Array.from(fakeDb.rows.values())[0]!;
    expect(row.costUsd).toBe(0);
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
    expect(result.costUsd).toBeCloseTo(1, 6);
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
