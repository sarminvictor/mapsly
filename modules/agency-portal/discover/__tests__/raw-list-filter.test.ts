// Unit tests for the Raw List client-side filter logic (Phase 9). Pure — the
// table loads a page server-side then narrows it client-side without a round
// trip. We lock the chip semantics: has website / min rating / reachability.

import { describe, expect, test } from "vitest";

import {
  applyClientFilters,
  rowPassesClientFilters,
  type ClientFilterRow,
} from "../raw-list-filter";

const row = (over: Partial<ClientFilterRow> = {}): ClientFilterRow => ({
  rating: over.rating ?? null,
  website: over.website ?? null,
  reachability: over.reachability ?? "UNKNOWN",
});

describe("rowPassesClientFilters", () => {
  test("no filters → every row passes", () => {
    expect(rowPassesClientFilters(row(), {})).toBe(true);
  });

  test("hasWebsite excludes null + blank websites", () => {
    expect(
      rowPassesClientFilters(row({ website: null }), { hasWebsite: true }),
    ).toBe(false);
    expect(
      rowPassesClientFilters(row({ website: "  " }), { hasWebsite: true }),
    ).toBe(false);
    expect(
      rowPassesClientFilters(row({ website: "https://x.com" }), {
        hasWebsite: true,
      }),
    ).toBe(true);
  });

  test("minRating is an inclusive floor; null rating fails any floor", () => {
    expect(rowPassesClientFilters(row({ rating: 4.5 }), { minRating: 4 })).toBe(
      true,
    );
    expect(rowPassesClientFilters(row({ rating: 4 }), { minRating: 4 })).toBe(
      true,
    );
    expect(rowPassesClientFilters(row({ rating: 3.9 }), { minRating: 4 })).toBe(
      false,
    );
    expect(
      rowPassesClientFilters(row({ rating: null }), { minRating: 4 }),
    ).toBe(false);
  });

  test("minRating 0 / undefined imposes no floor", () => {
    expect(
      rowPassesClientFilters(row({ rating: null }), { minRating: 0 }),
    ).toBe(true);
    expect(rowPassesClientFilters(row({ rating: null }), {})).toBe(true);
  });

  test("reachability requires one of the active tiers", () => {
    expect(
      rowPassesClientFilters(row({ reachability: "MULTI" }), {
        reachability: ["MULTI", "RICH"],
      }),
    ).toBe(true);
    expect(
      rowPassesClientFilters(row({ reachability: "PHONE_ONLY" }), {
        reachability: ["MULTI", "RICH"],
      }),
    ).toBe(false);
  });

  test("null reachability is treated as UNKNOWN", () => {
    expect(
      rowPassesClientFilters(row({ reachability: null }), {
        reachability: ["UNKNOWN"],
      }),
    ).toBe(true);
  });

  test("empty reachability list imposes no constraint", () => {
    expect(
      rowPassesClientFilters(row({ reachability: "UNREACHABLE" }), {
        reachability: [],
      }),
    ).toBe(true);
  });

  test("combined filters are an AND", () => {
    const r = row({
      website: "https://x.com",
      rating: 4.2,
      reachability: "MULTI",
    });
    expect(
      rowPassesClientFilters(r, {
        hasWebsite: true,
        minRating: 4,
        reachability: ["MULTI"],
      }),
    ).toBe(true);
    expect(
      rowPassesClientFilters(r, {
        hasWebsite: true,
        minRating: 4.5, // fails this clause
        reachability: ["MULTI"],
      }),
    ).toBe(false);
  });
});

describe("applyClientFilters", () => {
  test("filters a page without mutating the input", () => {
    const rows = [
      row({ website: "https://a.com", rating: 4.8, reachability: "RICH" }),
      row({ website: null, rating: 4.9, reachability: "MULTI" }),
      row({
        website: "https://c.com",
        rating: 3.1,
        reachability: "PHONE_ONLY",
      }),
    ];
    const out = applyClientFilters(rows, { hasWebsite: true, minRating: 4 });
    expect(out).toHaveLength(1);
    expect(out[0]?.website).toBe("https://a.com");
    expect(rows).toHaveLength(3); // input untouched
  });
});
