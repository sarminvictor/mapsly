// Tests for the F3 server-side AI sentence enrichment
// (modules/smb-reviews/phi-ai-enrich.ts).
//
// The AI service is replaced two ways:
//   - vi.mock of @/services/ai/phi-sentences covers the DEFAULT seam
//     (production wiring uses the KV-cached extractPhiSentences)
//   - opts.scan injection covers failure / timeout / cap behaviors
// Prisma is faked so withCronRun (the on-demand cost-attribution
// mechanism mirrored from the reply-draft server action) can open and
// close its rows without a DB.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cronRunCreate: vi.fn(),
  cronRunUpdate: vi.fn(),
  extractPhiSentences: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    cronRun: {
      create: mocks.cronRunCreate,
      update: mocks.cronRunUpdate,
    },
  },
  Prisma: { sql: vi.fn() },
}));

vi.mock("@/services/ai/phi-sentences", () => ({
  extractPhiSentences: mocks.extractPhiSentences,
}));

import {
  PHI_SENTENCE_SCAN_JOB,
  enrichRisksWithAiSentences,
} from "../phi-ai-enrich";
import type { ReplyRiskEntry } from "../phi-check";

const FOOTAGE_REPLY =
  "After reviewing footage from that afternoon, we are perplexed why you voiced frustration. Thanks for coming in.";
const OFFENDING_SENTENCE =
  "After reviewing footage from that afternoon, we are perplexed why you voiced frustration.";

function makeEntry(): ReplyRiskEntry {
  return {
    level: "high",
    hint: "…coming in…",
    matches: [
      {
        kind: "patient-status",
        phrase: "coming in",
        excerpt: "…Thanks for coming in.",
      },
    ],
  };
}

let nextRunId = 1;

beforeEach(() => {
  nextRunId = 1;
  mocks.cronRunCreate.mockReset().mockImplementation(async ({ data }) => ({
    id: `run_${nextRunId++}`,
    job: data.job,
    startedAt: new Date(),
  }));
  mocks.cronRunUpdate.mockReset().mockResolvedValue({});
  mocks.extractPhiSentences.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("enrichRisksWithAiSentences", () => {
  test("flagged reply → AI sentences merge into the entry's marks (default seam)", async () => {
    mocks.extractPhiSentences.mockResolvedValue({
      sentences: [OFFENDING_SENTENCE],
    });
    const entry = makeEntry();
    const risks = new Map([["r1", entry]]);

    await enrichRisksWithAiSentences(risks, [
      { id: "r1", text: FOOTAGE_REPLY },
    ]);

    expect(mocks.extractPhiSentences).toHaveBeenCalledTimes(1);
    expect(mocks.extractPhiSentences).toHaveBeenCalledWith({
      replyText: FOOTAGE_REPLY,
    });
    expect(entry.matches).toHaveLength(2);
    expect(entry.matches[1]).toEqual({
      kind: "ai-sentence",
      phrase: OFFENDING_SENTENCE,
      excerpt: OFFENDING_SENTENCE,
    });
    // Cost attributed via the manual CronRun, mirroring the reply-draft
    // server action's mechanism.
    expect(mocks.cronRunCreate).toHaveBeenCalledTimes(1);
    expect(mocks.cronRunCreate.mock.calls[0]![0].data.job).toBe(
      PHI_SENTENCE_SCAN_JOB,
    );
  });

  test("AI failure → deterministic marks only, never throws", async () => {
    const entry = makeEntry();
    const before = [...entry.matches];
    const scan = vi.fn().mockRejectedValue(new Error("openai 503"));

    await expect(
      enrichRisksWithAiSentences(
        new Map([["r1", entry]]),
        [{ id: "r1", text: FOOTAGE_REPLY }],
        { scan },
      ),
    ).resolves.toBeUndefined();

    expect(entry.matches).toEqual(before);
  });

  test("AI timeout → deterministic marks only, never throws", async () => {
    const entry = makeEntry();
    const before = [...entry.matches];
    // Never-resolving scan — the 10ms deadline must win.
    const scan = vi.fn().mockImplementation(() => new Promise(() => {}));

    await enrichRisksWithAiSentences(
      new Map([["r1", entry]]),
      [{ id: "r1", text: FOOTAGE_REPLY }],
      { scan, timeoutMs: 10 },
    );

    expect(entry.matches).toEqual(before);
  });

  test("one reply failing must not cost the others their AI marks", async () => {
    const good = makeEntry();
    const bad = makeEntry();
    const scan = vi
      .fn()
      .mockImplementation(async ({ replyText }: { replyText: string }) =>
        replyText === FOOTAGE_REPLY
          ? { sentences: [OFFENDING_SENTENCE] }
          : Promise.reject(new Error("boom")),
      );

    await enrichRisksWithAiSentences(
      new Map([
        ["good", good],
        ["bad", bad],
      ]),
      [
        { id: "good", text: FOOTAGE_REPLY },
        { id: "bad", text: "Your appointment ran late, sorry." },
      ],
      { scan },
    );

    expect(good.matches.some((m) => m.kind === "ai-sentence")).toBe(true);
    expect(bad.matches.some((m) => m.kind === "ai-sentence")).toBe(false);
  });

  test("empty risk map (non-medical / nothing flagged) → ZERO AI calls, no CronRun", async () => {
    const scan = vi.fn();
    await enrichRisksWithAiSentences(
      new Map(),
      [{ id: "r1", text: FOOTAGE_REPLY }],
      { scan },
    );
    expect(scan).not.toHaveBeenCalled();
    expect(mocks.extractPhiSentences).not.toHaveBeenCalled();
    expect(mocks.cronRunCreate).not.toHaveBeenCalled();
  });

  test("scans ONLY replies present in the risk map (never unflagged ones)", async () => {
    const entry = makeEntry();
    const scan = vi.fn().mockResolvedValue({ sentences: [] });

    await enrichRisksWithAiSentences(
      new Map([["flagged", entry]]),
      [
        { id: "flagged", text: FOOTAGE_REPLY },
        { id: "clean", text: "Thank you for the kind words!" },
        { id: "no-text", text: null },
      ],
      { scan },
    );

    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith({ replyText: FOOTAGE_REPLY });
  });

  test("caps the per-request fan-out at 8 flagged replies", async () => {
    const risks = new Map<string, ReplyRiskEntry>();
    const replies: Array<{ id: string; text: string }> = [];
    for (let i = 0; i < 12; i++) {
      risks.set(`r${i}`, makeEntry());
      replies.push({ id: `r${i}`, text: `${FOOTAGE_REPLY} #${i}` });
    }
    const scan = vi.fn().mockResolvedValue({ sentences: [] });

    await enrichRisksWithAiSentences(risks, replies, { scan });

    expect(scan).toHaveBeenCalledTimes(8);
  });
});
