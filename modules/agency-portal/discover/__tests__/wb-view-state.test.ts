// Shareable-view URL params (WP4-13 · URL half): sort + filters serialize into
// searchParams and parse back defensively. Pure round-trip invariants — the
// localStorage half needs a window and stays untested per testing.md (the
// defensive parse there mirrors the same vocabulary checks covered here).

import { describe, expect, test } from "vitest";

import type { LeadFilter, NumericLeadFilter } from "../leads-workbench";
import {
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  parseFieldStateParam,
  parseFilterParam,
  parseViewFromSearchParams,
  serializeFieldStateParam,
  serializeFilterParam,
  viewToSearchParams,
} from "../wb-view-state";

describe("serializeFilterParam / parseFilterParam", () => {
  test("round-trips every op token", () => {
    const filters: NumericLeadFilter[] = [
      { field: "perf", op: "<", value: 50 },
      { field: "reviews", op: "≥", value: 20 },
      { field: "rating", op: "≤", value: 4 },
      { field: "match", op: "=", value: 80 },
      { field: "perf", op: ">", value: 10 },
      { field: "reviews", op: "between", value: 20, value2: 100 },
    ];
    for (const f of filters) {
      expect(parseFilterParam(serializeFilterParam(f))).toEqual(f);
    }
  });

  test("serializes to ASCII tokens (no ≤/≥ in the URL)", () => {
    expect(serializeFilterParam({ field: "perf", op: "<", value: 50 })).toBe(
      "perf:lt:50",
    );
    expect(
      serializeFilterParam({
        field: "reviews",
        op: "between",
        value: 20,
        value2: 100,
      }),
    ).toBe("reviews:between:20:100");
  });

  test("rejects unknown fields, unknown ops, and NaNs", () => {
    expect(parseFilterParam("bogus:lt:50")).toBeNull();
    expect(parseFilterParam("perf:almost:50")).toBeNull();
    expect(parseFilterParam("perf:lt:banana")).toBeNull();
    expect(parseFilterParam("perf:between:1:banana")).toBeNull();
    expect(parseFilterParam("")).toBeNull();
  });
});

describe("viewToSearchParams", () => {
  test("default sort writes no sort/dir; filters write one f each", () => {
    const params = viewToSearchParams(
      {
        sortKey: DEFAULT_SORT_KEY,
        sortDir: DEFAULT_SORT_DIR,
        filters: [
          { field: "perf", op: "<", value: 50 },
          { field: "reviews", op: "≥", value: 20 },
        ],
      },
      new URLSearchParams(),
    );
    expect(params.get("sort")).toBeNull();
    expect(params.get("dir")).toBeNull();
    expect(params.getAll("f")).toEqual(["perf:lt:50", "reviews:gte:20"]);
  });

  test("non-default sort writes sort + dir", () => {
    const params = viewToSearchParams(
      { sortKey: "reviews", sortDir: 1, filters: [] },
      new URLSearchParams(),
    );
    expect(params.get("sort")).toBe("reviews");
    expect(params.get("dir")).toBe("asc");
  });

  test("clears stale view params but preserves lead/page", () => {
    const params = viewToSearchParams(
      { sortKey: DEFAULT_SORT_KEY, sortDir: DEFAULT_SORT_DIR, filters: [] },
      new URLSearchParams("lead=b1&page=2&sort=perf&dir=asc&f=perf:lt:50"),
    );
    expect(params.get("lead")).toBe("b1");
    expect(params.get("page")).toBe("2");
    expect(params.get("sort")).toBeNull();
    expect(params.get("dir")).toBeNull();
    expect(params.getAll("f")).toEqual([]);
  });
});

describe("parseViewFromSearchParams", () => {
  test("no view params → null (caller falls back to localStorage)", () => {
    expect(parseViewFromSearchParams(new URLSearchParams())).toBeNull();
    expect(
      parseViewFromSearchParams(new URLSearchParams("lead=b1&page=3")),
    ).toBeNull();
  });

  test("any view param → a COMPLETE view (absent pieces = defaults)", () => {
    // A shared link with only filters must reproduce the DEFAULT sort, never
    // half-merge with the receiver's saved sort.
    const view = parseViewFromSearchParams(new URLSearchParams("f=perf:lt:50"));
    expect(view).toEqual({
      sortKey: DEFAULT_SORT_KEY,
      sortDir: DEFAULT_SORT_DIR,
      filters: [{ field: "perf", op: "<", value: 50 }],
      fieldStates: [],
    });
  });

  test("full round-trip: serialize → parse reproduces the view", () => {
    const original = {
      sortKey: "reviews",
      sortDir: 1 as const,
      filters: [
        { field: "perf", op: "<", value: 50 },
        { field: "reviews", op: "between", value: 20, value2: 100 },
      ] as LeadFilter[],
      fieldStates: [],
    };
    const params = viewToSearchParams(original, new URLSearchParams());
    expect(parseViewFromSearchParams(params)).toEqual(original);
  });

  test("invalid sort key / dir fall back to defaults; bad filters drop", () => {
    const view = parseViewFromSearchParams(
      new URLSearchParams("sort=nope&dir=sideways&f=perf:lt:50&f=bad:x:y"),
    );
    expect(view).toEqual({
      sortKey: DEFAULT_SORT_KEY,
      sortDir: DEFAULT_SORT_DIR,
      filters: [{ field: "perf", op: "<", value: 50 }],
      fieldStates: [],
    });
  });
});

// C5 · field-state filters round-trip through the same shareable-view URL as
// sort + filters (one `fs=family:state` param each), backward-compatible.
describe("field-state filters (fs param)", () => {
  test("serialize / parse round-trips a field-state filter", () => {
    for (const f of [
      { family: "contacts", state: "empty" },
      { family: "reviews", state: "failed" },
      { family: "website", state: "enriched" },
      { family: "search", state: "not_run" },
    ] as const) {
      expect(parseFieldStateParam(serializeFieldStateParam(f))).toEqual(f);
    }
  });

  test("rejects unknown families and states", () => {
    expect(parseFieldStateParam("identity:enriched")).toBeNull(); // not enrichable
    expect(parseFieldStateParam("contacts:bogus")).toBeNull();
    expect(parseFieldStateParam("nope:empty")).toBeNull();
    expect(parseFieldStateParam("")).toBeNull();
    expect(parseFieldStateParam("contacts")).toBeNull();
  });

  test("viewToSearchParams writes one fs per field-state filter", () => {
    const params = viewToSearchParams(
      {
        sortKey: DEFAULT_SORT_KEY,
        sortDir: DEFAULT_SORT_DIR,
        filters: [],
        fieldStates: [
          { family: "contacts", state: "empty" },
          { family: "reviews", state: "failed" },
        ],
      },
      new URLSearchParams(),
    );
    expect(params.getAll("fs")).toEqual(["contacts:empty", "reviews:failed"]);
  });

  test("fs param alone (no sort/dir/f) still yields a view", () => {
    const view = parseViewFromSearchParams(
      new URLSearchParams("fs=contacts:empty&fs=bad:state"),
    );
    expect(view).toEqual({
      sortKey: DEFAULT_SORT_KEY,
      sortDir: DEFAULT_SORT_DIR,
      filters: [],
      fieldStates: [{ family: "contacts", state: "empty" }],
    });
  });

  test("an old URL with no fs param parses to an empty fieldStates", () => {
    const view = parseViewFromSearchParams(new URLSearchParams("f=perf:lt:50"));
    expect(view?.fieldStates).toEqual([]);
  });
});
