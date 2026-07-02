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
  MAX_PHI_SENTENCES,
  PHI_SENTENCES_PROMPT_VERSION,
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

/** Minimal in-memory KV fake — enough surface for kvCache. Pass your
 *  own `store` to inspect the keys kvCache writes (prompt-version
 *  invalidation test). */
function makeFakeKv(store = new Map<string, unknown>()): KvClient {
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

  test("model returning 6 sentences → post-filter keeps the first 3 verbatim survivors", async () => {
    // Six-sentence reply; the model over-returns (ignoring the prompt's
    // 3-cap) AND paraphrases its first pick. The code-level cap must
    // hold regardless: verbatim filter drops the paraphrase, then the
    // first MAX_PHI_SENTENCES (3) survivors win.
    const s = [
      "You came in for filler on March 3.",
      "Your deposit was refunded in full.",
      "We adjusted your lips at the follow up.",
      "You signed the consent form before treatment.",
      "Your results settled within two weeks.",
      "We have your appointment history on file.",
    ];
    const sixSentenceReply = s.join(" ");
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            sentences: [
              "You visited on March 3 for filler.", // paraphrased → dropped
              s[1],
              s[2],
              s[3],
              s[4],
              s[5],
            ],
          }),
        ),
      ),
    );
    const r = await withCronRun("test", () =>
      extractPhiSentencesUncached({ replyText: sixSentenceReply }),
    );
    expect(MAX_PHI_SENTENCES).toBe(3);
    expect(r.sentences).toEqual([s[1], s[2], s[3]]);
  });

  test("system prompt pins reviewer-specific scope, general-statement exclusion, and the 3-cap", async () => {
    // The exclusion + cap live in the prompt (model behavior can't be
    // unit-tested), so the contract test asserts the instructions
    // actually ship in the outgoing request body.
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        reply(JSON.stringify({ sentences: [] })),
    );
    __setFetchForTesting(fetchMock);
    await withCronRun("test", () =>
      extractPhiSentencesUncached({ replyText: FOOTAGE_REPLY }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((m) => m.role === "system")?.content;
    expect(system).toBeDefined();
    // Reviewer-specific scope — never general statements.
    expect(system).toContain("THE REVIEWER");
    // The two production false-positives, named as exclusion examples.
    expect(system).toContain("Toxin takes a full 14 days to take effect");
    expect(system).toContain("All injectors state a follow up could be needed");
    // Count discipline.
    expect(system).toContain("AT MOST the 3 most serious");
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

  test("cache key carries the bumped prompt version so older verdicts re-scan", async () => {
    // The 2026-06 prompt tightening (reviewer-specific only, 3-cap) bumped to
    // v2; WP8-5 (2026-07 · untrusted-content fencing changed the user message)
    // bumped to v3 — cached older verdicts under the 90d TTL must MISS, not
    // serve stale marks generated under a different prompt.
    expect(PHI_SENTENCES_PROMPT_VERSION).toBe("v3");

    const store = new Map<string, unknown>();
    __setKvClientForTest(makeFakeKv(store));
    __setFetchForTesting(
      vi.fn(async () => reply(JSON.stringify({ sentences: [] }))),
    );
    await withCronRun("test", () =>
      extractPhiSentences({ replyText: FOOTAGE_REPLY }),
    );
    const keys = Array.from(store.keys());
    expect(keys.length).toBeGreaterThan(0);
    expect(
      keys.every((k) =>
        k.includes(`ai:phi:sentences:${PHI_SENTENCES_PROMPT_VERSION}:`),
      ),
    ).toBe(true);
    expect(keys.some((k) => k.includes("ai:phi:sentences:v1:"))).toBe(false);
  });
});
