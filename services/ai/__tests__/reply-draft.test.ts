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
  },
  Prisma: { sql: vi.fn() },
}));

import { withCronRun } from "@/lib/cost/cost-counter";
import { __setApiKeyForTesting, __setFetchForTesting } from "../client";
import { draftReplyUncached } from "../reply-draft";

function reply(content: string) {
  return new Response(
    JSON.stringify({
      id: "x",
      model: "gpt-5.4-mini",
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content } },
      ],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 250,
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

describe("draftReplyUncached", () => {
  test("parses EN + ES drafts from a well-formed response", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            en: "Thank you for sharing this — we're sorry the wait was longer than expected.",
            es: "Gracias por compartir esto — lamentamos que la espera haya sido más larga.",
          }),
        ),
      ),
    );
    const r = await withCronRun("test", () =>
      draftReplyUncached({
        stars: 2,
        text: "I had to wait 45 minutes.",
        businessName: "Solea Brickell Spa",
        category: "med spa",
      }),
    );
    expect(r.en).toMatch(/wait/i);
    expect(r.es).toMatch(/espera/i);
  });

  test("requires non-empty businessName", async () => {
    await expect(
      withCronRun("test", () =>
        draftReplyUncached({
          stars: 5,
          text: "ok",
          businessName: " ",
          category: "spa",
        }),
      ),
    ).rejects.toThrow(/businessName is required/);
  });

  test("requires non-empty category", async () => {
    await expect(
      withCronRun("test", () =>
        draftReplyUncached({
          stars: 5,
          text: "ok",
          businessName: "Acme",
          category: "  ",
        }),
      ),
    ).rejects.toThrow(/category is required/);
  });

  test("rejects out-of-range stars", async () => {
    await expect(
      withCronRun("test", () =>
        draftReplyUncached({
          stars: 0,
          text: "ok",
          businessName: "Acme",
          category: "spa",
        }),
      ),
    ).rejects.toThrow(/stars must be an integer 1..5/);
  });

  test("throws if EN or ES is missing in response", async () => {
    __setFetchForTesting(
      vi.fn(async () => reply(JSON.stringify({ en: "only english" }))),
    );
    await expect(
      withCronRun("test", () =>
        draftReplyUncached({
          stars: 5,
          text: "ok",
          businessName: "Acme",
          category: "spa",
        }),
      ),
    ).rejects.toThrow();
  });

  test("passes tone + voiceNotes through to the prompt", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      reply(JSON.stringify({ en: "hi", es: "hola" })),
    );
    __setFetchForTesting(fetchMock);
    await withCronRun("test", () =>
      draftReplyUncached({
        stars: 5,
        text: "ok",
        businessName: "Solea",
        category: "med spa",
        tone: "apologetic",
        voiceNotes: "Use formal usted",
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    const userMsg = body.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Tone: apologetic");
    expect(userMsg).toContain("Voice notes: Use formal usted");
  });
});
