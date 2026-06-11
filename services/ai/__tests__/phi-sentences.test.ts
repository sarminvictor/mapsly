// Tests for the F3 sentence-level PHI scan (services/ai/phi-sentences.ts).
//
// Mock strategy mirrors reply-draft.test.ts: fake prisma backs the
// withCronRun cost rows, __setFetchForTesting fakes the OpenAI HTTP
// call. The KV-cache test installs an in-memory client via
// __setKvClientForTest (same pattern as lib/cache/__tests__).

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
          if (
            data.costUsd !== undefined &&
            typeof data.costUsd === "object" &&
            "increment" in data.costUsd
          ) {
            row.costUsd += data.costUsd.increment;
          }
          return row;
        },
      ),
    },
    // kvCache's recordCacheHit telemetry path (cache-hit bookkeeping).
    $executeRaw: vi.fn(async () => 1),
  },
  Prisma: { sql: vi.fn() },
}));

import { __setKvClientForTest, type KvClient } from "@/lib/cache/kv";
import { withCronRun } from "@/lib/cost/cost-counter";
import { __setApiKeyForTesting, __setFetchForTesting } from "../client";
import {
  extractPhiSentences,
  extractPhiSentencesUncached,
  PhiSentencesSchema,
} from "../phi-sentences";

function reply(content: string) {
  return new Response(
    JSON.stringify({
      id: "x",
      model: "gpt-5.4-nano",
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content } },
      ],
      usage: {
        prompt_tokens: 150,
        completion_tokens: 60,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Minimal in-memory KV fake — enough surface for kvCache. */
function makeFakeKv(): KvClient {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (store.has(key) ? (store.get(key) as T) : null) as T | null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    async scan() {
      return ["0", []] as [string, string[]];
    },
  };
}

// The paraphrased-disclosure reply that motivated F3 — no deterministic
// vocabulary, but "after reviewing footage" admits the reviewer was there.
const FOOTAGE_REPLY =
  "After reviewing footage from that afternoon, we are perplexed why you voiced frustration. Our team works hard for everyone.";

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.nextId = 1;
  __setApiKeyForTesting("test-key");
});
afterEach(() => {
  __setFetchForTesting(null);
  __setApiKeyForTesting(null);
  __setKvClientForTest(null);
});

describe("extractPhiSentencesUncached", () => {
  test("returns sentences the model copied verbatim from the reply", async () => {
    const offending =
      "After reviewing footage from that afternoon, we are perplexed why you voiced frustration.";
    __setFetchForTesting(
      vi.fn(async () => reply(JSON.stringify({ sentences: [offending] }))),
    );
    const r = await withCronRun("test", () =>
      extractPhiSentencesUncached({ replyText: FOOTAGE_REPLY }),
    );
    expect(r.sentences).toEqual([offending]);
  });

  test("drops paraphrased sentences that are not verbatim in the reply", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            sentences: [
              // Model reworded — unlocatable, must be dropped.
              "We reviewed the footage and saw you were frustrated.",
            ],
          }),
        ),
      ),
    );
    const r = await withCronRun("test", () =>
      extractPhiSentencesUncached({ replyText: FOOTAGE_REPLY }),
    );
    expect(r.sentences).toEqual([]);
  });

  test("normalizes curly apostrophes when locating sentences", async () => {
    // Reply uses a curly apostrophe; model returns the straight form
    // (the same normalization detectPhiRisk + the UI marker apply).
    const curlyReply = "We weren’t aware of your concerns until today.";
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            sentences: ["We weren't aware of your concerns until today."],
          }),
        ),
      ),
    );
    const r = await withCronRun("test", () =>
      extractPhiSentencesUncached({ replyText: curlyReply }),
    );
    expect(r.sentences).toHaveLength(1);
  });

  test("dedupes repeats and caps the sentence list", async () => {
    const reply1 = "Sentence one is here. Sentence two is here.";
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            sentences: [
              "Sentence one is here.",
              "Sentence one is here.",
              "sentence two is here.",
            ],
          }),
        ),
      ),
    );
    const r = await withCronRun("test", () =>
      extractPhiSentencesUncached({ replyText: reply1 }),
    );
    expect(r.sentences).toEqual([
      "Sentence one is here.",
      "sentence two is here.",
    ]);
  });

  test("empty reply text returns [] WITHOUT calling the model", async () => {
    const fetchMock = vi.fn(async () =>
      reply(JSON.stringify({ sentences: [] })),
    );
    __setFetchForTesting(fetchMock);
    const r = await withCronRun("test", () =>
      extractPhiSentencesUncached({ replyText: "   " }),
    );
    expect(r.sentences).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("throws on non-JSON model output", async () => {
    __setFetchForTesting(vi.fn(async () => reply("not json at all")));
    await expect(
      withCronRun("test", () =>
        extractPhiSentencesUncached({ replyText: FOOTAGE_REPLY }),
      ),
    ).rejects.toThrow(/non-JSON/);
  });

  test("Zod rejects malformed output shapes", async () => {
    __setFetchForTesting(
      vi.fn(async () => reply(JSON.stringify({ sentences: [42, true] }))),
    );
    await expect(
      withCronRun("test", () =>
        extractPhiSentencesUncached({ replyText: FOOTAGE_REPLY }),
      ),
    ).rejects.toThrow();
  });

  test("schema accepts a missing sentences field via default", () => {
    expect(PhiSentencesSchema.parse({})).toEqual({ sentences: [] });
  });

  test("refuses to run outside an open CronRun (no live API in user path)", async () => {
    __setFetchForTesting(
      vi.fn(async () => reply(JSON.stringify({ sentences: [] }))),
    );
    await expect(
      extractPhiSentencesUncached({ replyText: FOOTAGE_REPLY }),
    ).rejects.toThrow(/outside of an open CronRun/);
  });
});

describe("extractPhiSentences (KV-cached)", () => {
  test("second call with the same reply text hits the cache, not OpenAI", async () => {
    __setKvClientForTest(makeFakeKv());
    const offending =
      "After reviewing footage from that afternoon, we are perplexed why you voiced frustration.";
    const fetchMock = vi.fn(async () =>
      reply(JSON.stringify({ sentences: [offending] })),
    );
    __setFetchForTesting(fetchMock);

    const first = await withCronRun("test", () =>
      extractPhiSentences({ replyText: FOOTAGE_REPLY }),
    );
    const second = await withCronRun("test", () =>
      extractPhiSentences({ replyText: FOOTAGE_REPLY }),
    );

    expect(first.sentences).toEqual([offending]);
    expect(second.sentences).toEqual([offending]);
    // Billed once ever per unique reply text — the second call must not
    // re-hit the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
