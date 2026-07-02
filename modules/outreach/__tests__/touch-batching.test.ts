// Pure-core tests for the WP5-1 client-side batch orchestration helper.
// `chunkBusinessIds` splits an unbounded selection under the server's per-call
// cap so the overlay can draft touches for any selection size (sequential
// ≤25-lead batches), instead of failing post-hoc on the Zod .max(25) bound.

import { describe, expect, test } from "vitest";

import { chunkBusinessIds, TOUCH_BATCH_SIZE } from "../touch-batching";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `b${i}`);

describe("chunkBusinessIds", () => {
  test("empty in → empty out", () => {
    expect(chunkBusinessIds([])).toEqual([]);
  });

  test("a selection at or under the cap is a single batch", () => {
    expect(chunkBusinessIds(ids(25))).toHaveLength(1);
    expect(chunkBusinessIds(ids(1))).toHaveLength(1);
    expect(chunkBusinessIds(ids(TOUCH_BATCH_SIZE))[0]).toHaveLength(25);
  });

  test("splits > cap into ordered ≤25 batches covering every id once", () => {
    const src = ids(412);
    const batches = chunkBusinessIds(src);
    // ceil(412 / 25) = 17 batches; last is the remainder.
    expect(batches).toHaveLength(17);
    expect(batches.slice(0, 16).every((b) => b.length === 25)).toBe(true);
    expect(batches[16]).toHaveLength(12);

    // No batch exceeds the per-call server bound…
    expect(batches.every((b) => b.length <= TOUCH_BATCH_SIZE)).toBe(true);
    // …and flattening reproduces the input in order (deterministic "top N by
    // the current sort" batching, no dropped/duplicated ids).
    expect(batches.flat()).toEqual(src);
  });

  test("exact multiple of the cap has no ragged tail", () => {
    const batches = chunkBusinessIds(ids(50));
    expect(batches).toHaveLength(2);
    expect(batches.every((b) => b.length === 25)).toBe(true);
  });

  test("respects a custom size", () => {
    expect(chunkBusinessIds(ids(7), 3).map((b) => b.length)).toEqual([3, 3, 1]);
    // A degenerate size never yields empty/zero-length batches.
    expect(chunkBusinessIds(ids(3), 0).every((b) => b.length >= 1)).toBe(true);
  });
});
