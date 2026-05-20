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
import {
  generateOnePager,
  type GenerateOnePagerInput,
  type PitchWedgeInput,
} from "../copy-gen";

function reply(content: string) {
  return new Response(
    JSON.stringify({
      id: "x",
      model: "gpt-5.4-mini",
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content } },
      ],
      usage: {
        prompt_tokens: 400,
        completion_tokens: 600,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const wedge = (n: number): PitchWedgeInput => ({
  headline: `Wedge headline ${n}`,
  evidence: `Evidence ${n}`,
});

const baseInput = (): GenerateOnePagerInput => ({
  businessName: "Solea Brickell Spa",
  category: "med spa",
  city: "Miami",
  agencyName: "Anchor Local",
  pitchWedges: [wedge(1), wedge(2), wedge(3), wedge(4)],
});

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.nextId = 1;
  __setApiKeyForTesting("test-key");
});
afterEach(() => {
  __setFetchForTesting(null);
  __setApiKeyForTesting(null);
});

describe("generateOnePager", () => {
  test("parses a well-formed response with all 4 wedge narratives", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            headline: "Solea Brickell · why now is the moment",
            subhead: "Miami's med-spa scene is shifting. Your profile is ready.",
            wedgeNarratives: [
              "Your reply rate is 0% on the last 47 reviews — Google's local pack rewards engagement.",
              "Three competitors moved within 2 blocks in Q1. Your visibility is at risk.",
              "Your booking page loads in 4.2s on mobile — 60% of visitors leave.",
              "Your weekly ad spend is $0 in the category. Three competitors run weekly.",
            ],
            callToAction: "15 minutes next Tuesday to walk through this together?",
          }),
        ),
      ),
    );
    const r = await withCronRun("test", () => generateOnePager(baseInput()));
    expect(r.wedgeNarratives).toHaveLength(4);
    expect(r.headline).toMatch(/Solea/);
    expect(r.callToAction.length).toBeLessThanOrEqual(120);
  });

  test("requires non-empty businessName", async () => {
    const input = baseInput();
    input.businessName = " ";
    await expect(
      withCronRun("test", () => generateOnePager(input)),
    ).rejects.toThrow(/businessName is required/);
  });

  test("rejects fewer than 4 wedges", async () => {
    const input = baseInput();
    (input as { pitchWedges: PitchWedgeInput[] }).pitchWedges = [
      wedge(1),
      wedge(2),
      wedge(3),
    ];
    await expect(
      withCronRun("test", () => generateOnePager(input)),
    ).rejects.toThrow(/exactly 4 entries/);
  });

  test("rejects response with wrong wedge count", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            headline: "h",
            subhead: "s",
            wedgeNarratives: ["a", "b", "c"], // 3, not 4
            callToAction: "go",
          }),
        ),
      ),
    );
    await expect(
      withCronRun("test", () => generateOnePager(baseInput())),
    ).rejects.toThrow();
  });

  test("rejects oversize callToAction (>120 chars)", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            headline: "h",
            subhead: "s",
            wedgeNarratives: ["a", "b", "c", "d"],
            callToAction: "x".repeat(150),
          }),
        ),
      ),
    );
    await expect(
      withCronRun("test", () => generateOnePager(baseInput())),
    ).rejects.toThrow();
  });

  test("includes all wedges in the prompt in order", async () => {
    const fetchMock = vi.fn(async () =>
      reply(
        JSON.stringify({
          headline: "h",
          subhead: "s",
          wedgeNarratives: ["a", "b", "c", "d"],
          callToAction: "go",
        }),
      ),
    );
    __setFetchForTesting(fetchMock);
    await withCronRun("test", () => generateOnePager(baseInput()));
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    const userMsg = body.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Wedge 1");
    expect(userMsg).toContain("Wedge 4");
    expect(userMsg.indexOf("Wedge 1")).toBeLessThan(
      userMsg.indexOf("Wedge 4"),
    );
  });
});
