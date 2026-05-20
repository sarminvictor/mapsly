// Tests for sentiment classification — bypasses kvCache by importing the
// uncached entrypoint, mocks fetch + prisma.

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
  },
  Prisma: { sql: vi.fn() },
}));

import { withCronRun } from "@/lib/cost/cost-counter";
import { __setApiKeyForTesting, __setFetchForTesting } from "../client";
import { classifyReviewUncached, DEFAULT_SENTIMENT_MODEL } from "../sentiment";

function makeOpenAiResponse(content: string, model = DEFAULT_SENTIMENT_MODEL) {
  return new Response(
    JSON.stringify({
      id: "x",
      model,
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content } },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.nextId = 1;
  __setApiKeyForTesting("test-key");
});
afterEach(() => {
  __setFetchForTesting(null);
  __setApiKeyForTesting(null);
});

describe("classifyReviewUncached", () => {
  test("parses a well-formed JSON response", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        makeOpenAiResponse(
          JSON.stringify({
            sentiment: "POSITIVE",
            themes: ["staff", "results"],
            summary: "Loved the staff and saw real results.",
            confidence: 0.93,
          }),
        ),
      ),
    );
    const result = await withCronRun("test", () =>
      classifyReviewUncached({
        stars: 5,
        text: "The staff was great and I saw results immediately.",
      }),
    );
    expect(result.sentiment).toBe("POSITIVE");
    expect(result.themes).toEqual(["staff", "results"]);
    expect(result.summary).toMatch(/staff/);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  test("strips code fences if the model adds them", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        makeOpenAiResponse(
          "```json\n" +
            JSON.stringify({
              sentiment: "NEGATIVE",
              themes: ["wait_time"],
              summary: "Wait was long.",
              confidence: 0.7,
            }) +
            "\n```",
        ),
      ),
    );
    const result = await withCronRun("test", () =>
      classifyReviewUncached({ stars: 2, text: "Waited 45 min." }),
    );
    expect(result.sentiment).toBe("NEGATIVE");
    expect(result.themes).toContain("wait_time");
  });

  test("rejects themes outside ALLOWED_THEMES via Zod", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        makeOpenAiResponse(
          JSON.stringify({
            sentiment: "POSITIVE",
            themes: ["staff", "totally_invented_theme"],
            summary: "ok",
            confidence: 0.5,
          }),
        ),
      ),
    );
    await expect(
      withCronRun("test", () =>
        classifyReviewUncached({ stars: 5, text: "Great" }),
      ),
    ).rejects.toThrow();
  });

  test("rejects out-of-range stars before calling the API", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => makeOpenAiResponse("{}"), // shouldn't be hit
    );
    __setFetchForTesting(fetchMock);
    await expect(
      withCronRun("test", () =>
        classifyReviewUncached({ stars: 7, text: "ok" }),
      ),
    ).rejects.toThrow(/stars must be an integer 1..5/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("throws on non-JSON response with the bad output included", async () => {
    __setFetchForTesting(
      vi.fn(async () => makeOpenAiResponse("not actually json")),
    );
    await expect(
      withCronRun("test", () =>
        classifyReviewUncached({ stars: 3, text: "meh" }),
      ),
    ).rejects.toThrow(/non-JSON output/);
  });

  test("rejects themes longer than 5 entries", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        makeOpenAiResponse(
          JSON.stringify({
            sentiment: "NEUTRAL",
            themes: [
              "staff",
              "pricing",
              "wait_time",
              "cleanliness",
              "results",
              "communication",
            ],
            summary: "many things",
            confidence: 0.5,
          }),
        ),
      ),
    );
    await expect(
      withCronRun("test", () =>
        classifyReviewUncached({ stars: 3, text: "many things to say" }),
      ),
    ).rejects.toThrow();
  });

  test("model parameter overrides the default (for A/B testing)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeOpenAiResponse(
        JSON.stringify({
          sentiment: "POSITIVE",
          themes: [],
          summary: "ok",
          confidence: 0.6,
        }),
        "gpt-5.4-mini",
      ),
    );
    __setFetchForTesting(fetchMock);
    await withCronRun("test", () =>
      classifyReviewUncached({
        stars: 5,
        text: "ok",
        model: "gpt-5.4-mini",
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { model: string };
    expect(body.model).toBe("gpt-5.4-mini");
  });
});
