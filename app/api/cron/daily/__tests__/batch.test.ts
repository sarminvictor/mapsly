// Unit tests for the shared daily-cron batch helper.

import { describe, expect, test } from "vitest";
import { resolveBatchLimit, runBatch, statusFromOutcome } from "../_lib/batch";

describe("resolveBatchLimit", () => {
  test("returns default when query param absent", () => {
    expect(resolveBatchLimit(new Request("https://x/y"), 50, 200)).toBe(50);
  });

  test("uses query value within max", () => {
    expect(
      resolveBatchLimit(new Request("https://x/y?limit=100"), 50, 200),
    ).toBe(100);
  });

  test("clamps to max", () => {
    expect(
      resolveBatchLimit(new Request("https://x/y?limit=999"), 50, 200),
    ).toBe(200);
  });

  test("rejects non-numeric", () => {
    expect(
      resolveBatchLimit(new Request("https://x/y?limit=abc"), 50, 200),
    ).toBe(50);
  });

  test("rejects zero and negative", () => {
    expect(resolveBatchLimit(new Request("https://x/y?limit=0"), 50, 200)).toBe(
      50,
    );
    expect(
      resolveBatchLimit(new Request("https://x/y?limit=-5"), 50, 200),
    ).toBe(50);
  });
});

describe("runBatch", () => {
  test("succeeds on all items + returns ordered outcome", async () => {
    const outcome = await runBatch([1, 2, 3], async () => undefined);
    expect(outcome.attempted).toBe(3);
    expect(outcome.succeeded).toBe(3);
    expect(outcome.failures).toHaveLength(0);
  });

  test("isolates per-item failures + continues batch", async () => {
    const outcome = await runBatch([1, 2, 3, 4], async (n) => {
      if (n % 2 === 0) throw new Error(`even ${n}`);
    });
    expect(outcome.attempted).toBe(4);
    expect(outcome.succeeded).toBe(2);
    expect(outcome.failures).toHaveLength(2);
    expect(outcome.failures[0].error).toContain("even 2");
    expect(outcome.failures[1].error).toContain("even 4");
  });

  test("truncates long error messages", async () => {
    const longMessage = "x".repeat(1000);
    const outcome = await runBatch(
      [1],
      async () => {
        throw new Error(longMessage);
      },
      { errorMessageLimit: 50 },
    );
    expect(outcome.failures[0].error.length).toBe(50);
  });

  test("non-Error throws coerce to string", async () => {
    const outcome = await runBatch([1], async () => {
      throw "plain string thrown";
    });
    expect(outcome.failures[0].error).toContain("plain string thrown");
  });
});

describe("statusFromOutcome", () => {
  test("empty input → OK", () => {
    expect(
      statusFromOutcome({ attempted: 0, succeeded: 0, failures: [] }),
    ).toBe("OK");
  });
  test("zero failures → OK", () => {
    expect(
      statusFromOutcome({ attempted: 5, succeeded: 5, failures: [] }),
    ).toBe("OK");
  });
  test("mixed → PARTIAL", () => {
    expect(
      statusFromOutcome({
        attempted: 5,
        succeeded: 3,
        failures: [
          { item: null, error: "x" },
          { item: null, error: "y" },
        ],
      }),
    ).toBe("PARTIAL");
  });
  test("all failed → still PARTIAL (FAILED is reserved for thrown errors)", () => {
    expect(
      statusFromOutcome({
        attempted: 3,
        succeeded: 0,
        failures: [
          { item: null, error: "x" },
          { item: null, error: "y" },
          { item: null, error: "z" },
        ],
      }),
    ).toBe("PARTIAL");
  });
});
