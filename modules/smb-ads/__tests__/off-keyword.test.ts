import { describe, expect, test } from "vitest";

import {
  EMPTY_SMB_ADS,
  MAX_LANES,
  UNMATCHED_KEYWORD,
  groupIntoLanes,
  isOffKeyword,
  type AdEntry,
} from "../types";

/**
 * Pure-logic tests for the SMB ads off-keyword detector and lane
 * grouping. Per `.claude/rules/testing.md`, we cover invariants — the
 * cases where Maria's experience would be wrong if these flipped.
 *
 * Type-shape parity of `EMPTY_SMB_ADS` is enforced by TypeScript at
 * compile time (per `.claude/rules/cache-components.md` Pattern 1).
 * One runtime check below catches any accidental field deletion that
 * still passes the type system (e.g. an additive field defaulting to
 * undefined).
 */

const ad = (id: string, overrides: Partial<AdEntry> = {}): AdEntry => ({
  id,
  platform: "META",
  adCreativeBody: `creative ${id}`,
  landingUrl: `https://example.test/${id}`,
  lastSeenAt: new Date("2026-05-20T00:00:00Z"),
  ...overrides,
});

describe("EMPTY_SMB_ADS", () => {
  test("marks the empty-business state correctly", () => {
    expect(EMPTY_SMB_ADS.ownedBusinessId).toBe("");
    expect(EMPTY_SMB_ADS.name).toBe("");
    expect(EMPTY_SMB_ADS.category).toBe("");
    expect(EMPTY_SMB_ADS.totalActiveAds).toBe(0);
    expect(EMPTY_SMB_ADS.offKeywordCount).toBe(0);
    expect(EMPTY_SMB_ADS.lanes).toEqual([]);
    expect(EMPTY_SMB_ADS.refreshedAt).toBeNull();
  });
});

describe("isOffKeyword", () => {
  test("null keyword is off-keyword", () => {
    expect(isOffKeyword(null, ["botox", "filler"])).toBe(true);
  });

  test("undefined keyword is off-keyword", () => {
    expect(isOffKeyword(undefined, ["botox"])).toBe(true);
  });

  test("empty-string keyword is off-keyword", () => {
    expect(isOffKeyword("", ["botox"])).toBe(true);
  });

  test("whitespace-only keyword is off-keyword", () => {
    expect(isOffKeyword("   ", ["botox"])).toBe(true);
  });

  test("__unmatched__ sentinel is off-keyword regardless of services", () => {
    expect(isOffKeyword(UNMATCHED_KEYWORD, ["botox"])).toBe(true);
  });

  test("empty services list treats every keyword as off-keyword", () => {
    expect(isOffKeyword("botox specials", [])).toBe(true);
  });

  test("matches when service is a substring of the keyword", () => {
    expect(isOffKeyword("botox specials brickell", ["botox", "filler"])).toBe(
      false,
    );
  });

  test("matches when the keyword is a substring of the service", () => {
    // e.g. service "weight loss treatment" and keyword "weight loss"
    expect(isOffKeyword("weight loss", ["weight loss treatment"])).toBe(false);
  });

  test("returns true when no service overlaps with the keyword", () => {
    expect(isOffKeyword("dental cleaning", ["botox", "filler"])).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isOffKeyword("BOTOX", ["botox"])).toBe(false);
    expect(isOffKeyword("Botox", ["BOTOX"])).toBe(false);
  });

  test("ignores leading/trailing whitespace in service entries", () => {
    expect(isOffKeyword("botox specials", ["  botox  "])).toBe(false);
  });

  test("skips null/empty service entries without crashing", () => {
    // Cast to string[] — runtime guard handles the unsafe shape.
    expect(
      isOffKeyword("botox", ["", "  ", "botox"] as unknown as string[]),
    ).toBe(false);
  });
});

describe("groupIntoLanes", () => {
  test("returns [] for empty ads", () => {
    expect(groupIntoLanes([], ["botox"], MAX_LANES)).toEqual([]);
  });

  test("returns [] when maxLanes <= 0", () => {
    expect(groupIntoLanes([ad("1")], ["botox"], 0, ["botox"])).toEqual([]);
  });

  test("groups same-keyword ads into a single lane", () => {
    const lanes = groupIntoLanes(
      [ad("1"), ad("2"), ad("3")],
      ["botox"],
      MAX_LANES,
      ["botox specials", "botox specials", "botox specials"],
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].keyword).toBe("botox specials");
    expect(lanes[0].ads).toHaveLength(3);
    expect(lanes[0].isOffKeyword).toBe(false);
  });

  test("caps result to maxLanes lanes (most-active first)", () => {
    // Build 5 distinct lanes with varying counts.
    const ads: AdEntry[] = [];
    const keywords: string[] = [];
    // 3 ads under "a", 2 under "b", 1 each under c/d/e
    for (let i = 0; i < 3; i++) {
      ads.push(ad(`a${i}`));
      keywords.push("a");
    }
    for (let i = 0; i < 2; i++) {
      ads.push(ad(`b${i}`));
      keywords.push("b");
    }
    ads.push(ad("c1"));
    keywords.push("c");
    ads.push(ad("d1"));
    keywords.push("d");
    ads.push(ad("e1"));
    keywords.push("e");

    const lanes = groupIntoLanes(ads, ["a", "b", "c", "d", "e"], 3, keywords);
    expect(lanes).toHaveLength(3);
    expect(lanes.map((l) => l.keyword)).toEqual(["a", "b", "c"]);
  });

  test("flags lanes whose keyword doesn't match any service as off-keyword", () => {
    const lanes = groupIntoLanes(
      [ad("1"), ad("2")],
      ["botox", "filler"],
      MAX_LANES,
      ["botox specials", "dental cleaning"],
    );
    const byKeyword = Object.fromEntries(lanes.map((l) => [l.keyword, l]));
    expect(byKeyword["botox specials"].isOffKeyword).toBe(false);
    expect(byKeyword["dental cleaning"].isOffKeyword).toBe(true);
  });

  test("buckets ads with null/empty matched keywords into the unmatched lane", () => {
    const lanes = groupIntoLanes(
      [ad("1"), ad("2"), ad("3")],
      ["botox"],
      MAX_LANES,
      [null, "", "   "],
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].keyword).toBe(UNMATCHED_KEYWORD);
    expect(lanes[0].isOffKeyword).toBe(true);
    expect(lanes[0].ads).toHaveLength(3);
  });

  test("sorts ties by keyword alphabetically (stable render)", () => {
    const lanes = groupIntoLanes(
      [ad("1"), ad("2"), ad("3"), ad("4")],
      ["a", "b", "c", "d"],
      MAX_LANES,
      ["d", "a", "c", "b"],
    );
    expect(lanes.map((l) => l.keyword)).toEqual(["a", "b", "c", "d"]);
  });

  test("MAX_LANES enforces the documented density cap (14)", () => {
    expect(MAX_LANES).toBe(14);
  });
});
