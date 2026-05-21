/**
 * AI reply-draft glue · D.7
 *
 * Tests the batched orchestration in `modules/scoring/ai-reply.ts`. The
 * underlying `draftReply` from services/ai is mocked at the import boundary
 * — these are unit tests for the glue, not for the prompt (prompt-level
 * tests live at services/ai/__tests__/reply-draft.test.ts).
 *
 * Invariants:
 *   1. Skip reviews whose EN+ES drafts are already populated.
 *   2. Skip 5★ reviews with empty text (unless opts.alsoBlankFiveStar).
 *   3. A single failing review does not tank the rest of the batch.
 *   4. Concurrency is bounded — no more than N in-flight calls.
 *   5. Counts (processed / skipped / failed) sum to attempted - already-done.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

interface ReviewFixture {
  id: string;
  stars: number;
  text: string | null;
  aiReplyDraftEn: string | null;
  aiReplyDraftEs: string | null;
  business: { name: string; category: string } | null;
}

const state: {
  reviews: ReviewFixture[];
  updates: Array<{ id: string; data: Record<string, unknown> }>;
} = { reviews: [], updates: [] };

vi.mock("@/lib/prisma", () => ({
  default: {
    review: {
      findMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => {
          const ids = new Set(where.id.in);
          return state.reviews.filter((r) => ids.has(r.id));
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          state.updates.push({ id: where.id, data });
          const row = state.reviews.find((r) => r.id === where.id);
          if (row) {
            if (typeof data.aiReplyDraftEn === "string")
              row.aiReplyDraftEn = data.aiReplyDraftEn;
            if (typeof data.aiReplyDraftEs === "string")
              row.aiReplyDraftEs = data.aiReplyDraftEs;
          }
          return row ?? null;
        },
      ),
    },
  },
  Prisma: {},
}));

// In-flight counter for concurrency assertions.
const draftReplyMock = vi.fn();
let inFlight = 0;
let maxInFlight = 0;

vi.mock("@/services/ai", () => ({
  draftReply: (...args: unknown[]) => draftReplyMock(...args),
}));

// Import AFTER mocks so the SUT sees the mocked modules.
import { generateAndPersistReplyDrafts, __test } from "../ai-reply";

// ─── Helpers ────────────────────────────────────────────────────────────────

function review(over: Partial<ReviewFixture>): ReviewFixture {
  return {
    id: over.id ?? "rev_x",
    stars: over.stars ?? 2,
    text: over.text === undefined ? "Service was slow." : over.text,
    aiReplyDraftEn: over.aiReplyDraftEn ?? null,
    aiReplyDraftEs: over.aiReplyDraftEs ?? null,
    business: over.business ?? { name: "Acme Spa", category: "med spa" },
  };
}

async function fakeDraftReply(delayMs = 5) {
  inFlight += 1;
  if (inFlight > maxInFlight) maxInFlight = inFlight;
  try {
    await new Promise((r) => setTimeout(r, delayMs));
    return { en: "Thanks for the feedback.", es: "Gracias por el comentario." };
  } finally {
    inFlight -= 1;
  }
}

beforeEach(() => {
  state.reviews = [];
  state.updates = [];
  draftReplyMock.mockReset();
  inFlight = 0;
  maxInFlight = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("generateAndPersistReplyDrafts", () => {
  test("returns zeroed result for empty input", async () => {
    const r = await generateAndPersistReplyDrafts([]);
    expect(r).toEqual({
      processed: 0,
      skipped: 0,
      failed: 0,
      failureSample: [],
    });
    expect(draftReplyMock).not.toHaveBeenCalled();
  });

  test("drafts + persists EN/ES for eligible reviews", async () => {
    state.reviews = [
      review({ id: "rev_1", stars: 2, text: "Long wait" }),
      review({ id: "rev_2", stars: 3, text: "Decent" }),
    ];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    const r = await generateAndPersistReplyDrafts(["rev_1", "rev_2"]);

    expect(r.processed).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.failed).toBe(0);
    expect(state.updates).toHaveLength(2);
    for (const u of state.updates) {
      expect(u.data.aiReplyDraftEn).toBe("Thanks for the feedback.");
      expect(u.data.aiReplyDraftEs).toBe("Gracias por el comentario.");
    }
  });

  test("skips reviews already fully drafted", async () => {
    state.reviews = [
      review({
        id: "rev_1",
        aiReplyDraftEn: "already",
        aiReplyDraftEs: "ya",
      }),
    ];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    const r = await generateAndPersistReplyDrafts(["rev_1"]);

    expect(r.skipped).toBe(1);
    expect(r.processed).toBe(0);
    expect(draftReplyMock).not.toHaveBeenCalled();
  });

  test("re-drafts a partially-drafted review (one language missing)", async () => {
    state.reviews = [
      review({
        id: "rev_1",
        aiReplyDraftEn: "only english",
        aiReplyDraftEs: null,
      }),
    ];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    const r = await generateAndPersistReplyDrafts(["rev_1"]);

    expect(r.processed).toBe(1);
    expect(r.skipped).toBe(0);
  });

  test("skips 5-star reviews with empty text by default", async () => {
    state.reviews = [
      review({ id: "rev_blank5", stars: 5, text: "" }),
      review({ id: "rev_blank5b", stars: 5, text: null }),
      review({ id: "rev_blank5c", stars: 5, text: "   " }),
    ];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    const r = await generateAndPersistReplyDrafts([
      "rev_blank5",
      "rev_blank5b",
      "rev_blank5c",
    ]);

    expect(r.skipped).toBe(3);
    expect(r.processed).toBe(0);
    expect(draftReplyMock).not.toHaveBeenCalled();
  });

  test("processes 5-star empty text when alsoBlankFiveStar=true", async () => {
    state.reviews = [review({ id: "rev_blank5", stars: 5, text: "" })];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    const r = await generateAndPersistReplyDrafts(["rev_blank5"], {
      alsoBlankFiveStar: true,
    });

    expect(r.processed).toBe(1);
    expect(r.skipped).toBe(0);
  });

  test("does NOT skip 1-3-star empty-text reviews (they still warrant a reply)", async () => {
    state.reviews = [
      review({ id: "rev_1star_empty", stars: 1, text: null }),
      review({ id: "rev_3star_empty", stars: 3, text: "" }),
    ];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    const r = await generateAndPersistReplyDrafts([
      "rev_1star_empty",
      "rev_3star_empty",
    ]);

    expect(r.processed).toBe(2);
    expect(r.skipped).toBe(0);
  });

  test("a single failing review does not tank the batch", async () => {
    state.reviews = [
      review({ id: "rev_ok1", stars: 2, text: "slow" }),
      review({ id: "rev_bad", stars: 1, text: "rude staff" }),
      review({ id: "rev_ok2", stars: 3, text: "meh" }),
    ];
    draftReplyMock.mockImplementation((arg: { text: string }) => {
      if (arg.text === "rude staff") {
        throw new Error("OpenAI 503 upstream");
      }
      return fakeDraftReply();
    });

    const r = await generateAndPersistReplyDrafts([
      "rev_ok1",
      "rev_bad",
      "rev_ok2",
    ]);

    expect(r.processed).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.failureSample).toHaveLength(1);
    expect(r.failureSample[0]).toMatchObject({
      reviewId: "rev_bad",
      error: expect.stringContaining("OpenAI 503"),
    });
  });

  test("failureSample is capped at 5 entries even if more reviews fail", async () => {
    state.reviews = Array.from({ length: 8 }, (_, i) =>
      review({ id: `rev_f${i}`, stars: 2, text: `txt${i}` }),
    );
    draftReplyMock.mockImplementation(() => {
      throw new Error("model down");
    });

    const r = await generateAndPersistReplyDrafts(
      state.reviews.map((rv) => rv.id),
    );

    expect(r.failed).toBe(8);
    expect(r.failureSample).toHaveLength(5);
  });

  test("respects the concurrency limit", async () => {
    state.reviews = Array.from({ length: 12 }, (_, i) =>
      review({ id: `rev_c${i}`, stars: 2, text: `txt${i}` }),
    );
    draftReplyMock.mockImplementation(() => fakeDraftReply(20));

    await generateAndPersistReplyDrafts(
      state.reviews.map((rv) => rv.id),
      { concurrency: 3 },
    );

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(0);
  });

  test("clamps concurrency below 1 → 1", () => {
    expect(__test.clampConcurrency(0)).toBe(1);
    expect(__test.clampConcurrency(-5)).toBe(1);
    expect(__test.clampConcurrency(Number.NaN)).toBe(1);
  });

  test("clamps concurrency above 10 → 10", () => {
    expect(__test.clampConcurrency(50)).toBe(10);
    expect(__test.clampConcurrency(Number.POSITIVE_INFINITY)).toBe(10);
  });

  test("de-dupes input ids", async () => {
    state.reviews = [review({ id: "rev_1", stars: 2, text: "x" })];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    const r = await generateAndPersistReplyDrafts(["rev_1", "rev_1", "rev_1"]);

    expect(r.processed).toBe(1);
    expect(draftReplyMock).toHaveBeenCalledTimes(1);
  });

  test("skips orphan reviews with no related business", async () => {
    state.reviews = [
      { ...review({ id: "rev_orphan", stars: 2, text: "x" }), business: null },
    ];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    const r = await generateAndPersistReplyDrafts(["rev_orphan"]);

    expect(r.skipped).toBe(1);
    expect(r.processed).toBe(0);
    expect(draftReplyMock).not.toHaveBeenCalled();
  });

  test("passes default warm tone + business name/category to draftReply", async () => {
    state.reviews = [
      review({
        id: "rev_1",
        stars: 2,
        text: "wait",
        business: { name: "Solea Brickell Spa", category: "med spa" },
      }),
    ];
    draftReplyMock.mockImplementation(() => fakeDraftReply());

    await generateAndPersistReplyDrafts(["rev_1"]);

    expect(draftReplyMock).toHaveBeenCalledTimes(1);
    expect(draftReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stars: 2,
        text: "wait",
        businessName: "Solea Brickell Spa",
        category: "med spa",
        tone: "warm",
      }),
    );
  });
});
