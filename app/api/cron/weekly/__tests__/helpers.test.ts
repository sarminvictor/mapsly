// Unit tests for the pure helpers in the weekly cron handlers.
//
// These cover the logic in route.ts files that doesn't require mocking
// prisma / external adapters. Per `.claude/rules/testing.md`, this is the
// "core invariants" coverage — every cron handler should have at least
// these. Full integration-shape tests with mocked prisma + revalidateTag
// + adapters are tracked as a C.9 follow-up task.

import { describe, expect, test } from "vitest";
import {
  pickMatch,
  mapsRowToProfileUpdate,
} from "../business-profile-refresh/route";
import { normalizeDomain } from "@/lib/url/normalize-domain";
import {
  averageReplyLatencyHours,
  yearsOnGoogle,
  hasAttribute,
  todayUtcMidnight,
} from "../snapshot-write/route";

describe("business-profile-refresh · pickMatch", () => {
  const rowsCid = [
    { cid: "111", title: "Other Spa" },
    { cid: "222", title: "Solea Spa", place_id: "p222" },
  ];

  test("matches by cid exactly", () => {
    const match = pickMatch(rowsCid, {
      googleCid: "222",
      googlePlaceId: null,
    });
    expect(match?.title).toBe("Solea Spa");
  });

  test("falls back to place_id when cid not in result set", () => {
    const match = pickMatch(rowsCid, {
      googleCid: "999",
      googlePlaceId: "p222",
    });
    expect(match?.title).toBe("Solea Spa");
  });

  test("returns null when neither identifier matches", () => {
    expect(
      pickMatch(rowsCid, { googleCid: "999", googlePlaceId: "pZ" }),
    ).toBeNull();
  });

  test("returns null when business has no identifiers", () => {
    expect(
      pickMatch(rowsCid, { googleCid: null, googlePlaceId: null }),
    ).toBeNull();
  });

  test("returns null on empty input", () => {
    expect(
      pickMatch([], { googleCid: "anything", googlePlaceId: null }),
    ).toBeNull();
  });
});

describe("business-profile-refresh · mapsRowToProfileUpdate", () => {
  test("extracts every populated field", () => {
    const out = mapsRowToProfileUpdate({
      rating: { value: 4.7, votes_count: 312 },
      phone: "+1 305-555-0123",
      url: "https://soleaspa.example.com",
      address: "123 Brickell Ave",
      address_info: {
        city: "Miami",
        region: "FL",
        zip: "33131",
      },
      is_claimed: true,
      additional_categories: ["med_spa", "skin_clinic"],
    });
    expect(out).toEqual({
      rating: 4.7,
      reviewCount: 312,
      phone: "+1 305-555-0123",
      website: "https://soleaspa.example.com",
      address: "123 Brickell Ave",
      city: "Miami",
      province: "FL",
      postalCode: "33131",
      isClaimed: true,
      categories: ["med_spa", "skin_clinic"],
    });
  });

  test("skips fields the row doesn't carry — never writes nulls", () => {
    const out = mapsRowToProfileUpdate({
      rating: { value: 4.5 },
      // no phone, no url, no address_info
    });
    expect(out).toEqual({ rating: 4.5 });
    expect("phone" in out).toBe(false);
    expect("website" in out).toBe(false);
  });

  test("caps additional_categories to 10", () => {
    const tooMany = Array.from({ length: 20 }).map((_, i) => `cat_${i}`);
    const out = mapsRowToProfileUpdate({ additional_categories: tooMany });
    expect(out.categories).toHaveLength(10);
    expect(out.categories?.[0]).toBe("cat_0");
    expect(out.categories?.[9]).toBe("cat_9");
  });

  test("empty additional_categories does NOT set the field", () => {
    const out = mapsRowToProfileUpdate({ additional_categories: [] });
    expect("categories" in out).toBe(false);
  });

  test("treats empty-string phone/website as missing", () => {
    const out = mapsRowToProfileUpdate({ phone: "", url: "" });
    expect("phone" in out).toBe(false);
    expect("website" in out).toBe(false);
  });
});

describe("serp-rank-scan · normalizeDomain", () => {
  test("strips www. and lowercases", () => {
    expect(normalizeDomain("https://WWW.Mapsly.AI/path")).toBe("mapsly.ai");
  });

  test("handles bare host without scheme", () => {
    expect(normalizeDomain("soleaspa.example.com")).toBe(
      "soleaspa.example.com",
    );
  });

  test("preserves subdomains other than www", () => {
    expect(normalizeDomain("https://blog.mapsly.ai")).toBe("blog.mapsly.ai");
  });

  test("returns null for null/empty/whitespace input", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });

  test("returns null for unparseable input", () => {
    // URL parser accepts most things; only truly malformed should fail.
    expect(normalizeDomain("http://")).toBeNull();
  });
});

describe("snapshot-write · averageReplyLatencyHours", () => {
  test("returns null when no reviews replied", () => {
    expect(
      averageReplyLatencyHours([
        {
          ownerReplied: false,
          ownerReplyAt: null,
          postedAt: new Date("2026-05-01"),
        },
      ]),
    ).toBeNull();
  });

  test("averages over only replied reviews", () => {
    const posted = new Date("2026-05-01T00:00:00Z");
    const repliedAt2h = new Date("2026-05-01T02:00:00Z");
    const repliedAt6h = new Date("2026-05-01T06:00:00Z");
    const avg = averageReplyLatencyHours([
      { ownerReplied: true, ownerReplyAt: repliedAt2h, postedAt: posted },
      { ownerReplied: true, ownerReplyAt: repliedAt6h, postedAt: posted },
      // Not replied — ignored.
      { ownerReplied: false, ownerReplyAt: null, postedAt: posted },
    ]);
    expect(avg).toBeCloseTo(4, 5);
  });

  test("clamps negative latency to 0 (reply timestamp before posted)", () => {
    const posted = new Date("2026-05-01T05:00:00Z");
    const repliedBefore = new Date("2026-05-01T04:00:00Z");
    const avg = averageReplyLatencyHours([
      {
        ownerReplied: true,
        ownerReplyAt: repliedBefore,
        postedAt: posted,
      },
    ]);
    expect(avg).toBe(0);
  });

  test("ignores ownerReplied=true with null ownerReplyAt", () => {
    expect(
      averageReplyLatencyHours([
        {
          ownerReplied: true,
          ownerReplyAt: null,
          postedAt: new Date(),
        },
      ]),
    ).toBeNull();
  });

  test("empty input returns null", () => {
    expect(averageReplyLatencyHours([])).toBeNull();
  });
});

describe("snapshot-write · yearsOnGoogle", () => {
  test("null input → null", () => {
    expect(yearsOnGoogle(null)).toBeNull();
  });

  test("future-dated firstSeen → 0", () => {
    expect(
      yearsOnGoogle(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)),
    ).toBe(0);
  });

  test("computes years for a known historical date", () => {
    const fiveYearsAgo = new Date(
      Date.now() - 5 * 365.25 * 24 * 60 * 60 * 1000,
    );
    const yrs = yearsOnGoogle(fiveYearsAgo);
    expect(yrs).not.toBeNull();
    expect(yrs!).toBeCloseTo(5, 1);
  });
});

describe("snapshot-write · hasAttribute", () => {
  test("null/undefined attributes → null (unknown)", () => {
    expect(hasAttribute(null, "anything")).toBeNull();
    expect(hasAttribute(undefined, "anything")).toBeNull();
  });

  test("non-object attributes → null", () => {
    expect(hasAttribute("string", "key")).toBeNull();
    expect(hasAttribute(42, "key")).toBeNull();
  });

  test("missing key → null", () => {
    expect(hasAttribute({}, "key")).toBeNull();
  });

  test("boolean value → boolean", () => {
    expect(hasAttribute({ k: true }, "k")).toBe(true);
    expect(hasAttribute({ k: false }, "k")).toBe(false);
  });

  test("non-empty string → true; empty string → false", () => {
    expect(hasAttribute({ k: "x" }, "k")).toBe(true);
    expect(hasAttribute({ k: "" }, "k")).toBe(false);
  });

  test("array length 0 → false; >0 → true", () => {
    expect(hasAttribute({ k: [] }, "k")).toBe(false);
    expect(hasAttribute({ k: ["a"] }, "k")).toBe(true);
  });

  test("nested object → key count > 0", () => {
    expect(hasAttribute({ k: {} }, "k")).toBe(false);
    expect(hasAttribute({ k: { x: 1 } }, "k")).toBe(true);
  });
});

describe("snapshot-write · todayUtcMidnight", () => {
  test("returns a Date at UTC midnight of today", () => {
    const today = todayUtcMidnight();
    expect(today.getUTCHours()).toBe(0);
    expect(today.getUTCMinutes()).toBe(0);
    expect(today.getUTCSeconds()).toBe(0);
    expect(today.getUTCMilliseconds()).toBe(0);
    // Date should be within the last 24h relative to wall clock
    const now = Date.now();
    const delta = now - today.getTime();
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  test("two calls in the same tick return identical millisecond values", () => {
    expect(todayUtcMidnight().getTime()).toBe(todayUtcMidnight().getTime());
  });
});
