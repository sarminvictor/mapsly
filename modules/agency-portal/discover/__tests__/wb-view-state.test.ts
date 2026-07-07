// Shareable-view URL params (WP4-13 · URL half): sort + filters serialize into
// searchParams and parse back defensively. Pure round-trip invariants — the
// localStorage half stays mostly untested per testing.md (the defensive parse
// mirrors the same vocabulary checks covered here); the ONE exception is the
// WB-COL-2 dismissedCols round-trip below (a new persisted field whose
// auto-show semantics depend on surviving save/load), run against a stubbed
// window.localStorage.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  LeadFilter,
  NumericLeadFilter,
  SignalLeadFilter,
} from "../leads-workbench";
import {
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  loadWorkbenchView,
  parseFieldStateParam,
  parseFilterParam,
  parseSignalParam,
  parseStatusParam,
  parseViewFromSearchParams,
  saveWorkbenchView,
  serializeFieldStateParam,
  serializeFilterParam,
  serializeSignalParam,
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

  // AUDIT B2 · the four new paid fields round-trip like any other field.
  test("new numeric fields (seo/serpRank/metaAdCount/googleAdCount) round-trip", () => {
    const filters: NumericLeadFilter[] = [
      { field: "seo", op: "<", value: 80 },
      { field: "serpRank", op: ">", value: 3 },
      { field: "metaAdCount", op: "=", value: 0 },
      { field: "googleAdCount", op: "≥", value: 1 },
    ];
    for (const f of filters) {
      expect(parseFilterParam(serializeFilterParam(f))).toEqual(f);
    }
  });

  // AUDIT B3 · includeNoData rides the op token as a `-n` suffix.
  test("includeNoData serializes as an op-token suffix and round-trips", () => {
    const f: NumericLeadFilter = {
      field: "perf",
      op: "<",
      value: 50,
      includeNoData: true,
    };
    expect(serializeFilterParam(f)).toBe("perf:lt-n:50");
    expect(parseFilterParam("perf:lt-n:50")).toEqual(f);
    expect(parseFilterParam("reviews:between-n:20:100")).toEqual({
      field: "reviews",
      op: "between",
      value: 20,
      value2: 100,
      includeNoData: true,
    });
  });

  test("old URLs (bare op tokens) decode WITHOUT includeNoData", () => {
    expect(parseFilterParam("perf:lt:50")).toEqual({
      field: "perf",
      op: "<",
      value: 50,
    });
    // A bare suffix with no base op is malformed, not a flag.
    expect(parseFilterParam("perf:-n:50")).toBeNull();
  });
});

// B16 · signal filters serialize to sg= so shared links keep them.
describe("serializeSignalParam / parseSignalParam", () => {
  test("round-trips key + want (label comes back as the key placeholder)", () => {
    const f: SignalLeadFilter = {
      kind: "signal",
      sigKey: "weak_seo",
      sigLabel: "Weak SEO",
      want: "miss",
    };
    expect(serializeSignalParam(f)).toBe("weak_seo:miss");
    expect(parseSignalParam("weak_seo:miss")).toEqual({
      kind: "signal",
      sigKey: "weak_seo",
      sigLabel: "weak_seo", // placeholder — the workbench re-labels on mount
      want: "miss",
    });
  });

  test("rejects malformed values", () => {
    expect(parseSignalParam("")).toBeNull();
    expect(parseSignalParam("weak_seo")).toBeNull();
    expect(parseSignalParam("weak_seo:maybe")).toBeNull();
    expect(parseSignalParam(":match")).toBeNull();
  });
});

// B5 · the status tab round-trips as a lowercase st= value.
describe("parseStatusParam", () => {
  test("accepts every LeadStatus, case-insensitively", () => {
    expect(parseStatusParam("new")).toBe("NEW");
    expect(parseStatusParam("HIDDEN")).toBe("HIDDEN");
    expect(parseStatusParam("Won")).toBe("WON");
  });
  test("rejects unknown / absent values", () => {
    expect(parseStatusParam(null)).toBeNull();
    expect(parseStatusParam("")).toBeNull();
    expect(parseStatusParam("archived")).toBeNull();
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
      hasFilterParams: true,
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
    expect(parseViewFromSearchParams(params)).toEqual({
      ...original,
      // Reading back a URL that carries f= params marks the filter dimension
      // as URL-expressed (seed-loss fix) — not part of the writable view.
      hasFilterParams: true,
    });
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
      hasFilterParams: true,
    });
  });
});

// C5 · field-state filters round-trip through the same shareable-view URL as
// sort + filters (one `fs=group:state` param each), keyed by the 7-group
// vocabulary (2026-07-06 truth unification — the 5-family axis is retired).
describe("field-state filters (fs param)", () => {
  test("serialize / parse round-trips a field-state filter", () => {
    for (const f of [
      { group: "contacts_tech", state: "empty" },
      { group: "reviews", state: "failed" },
      { group: "site_speed", state: "enriched" },
      { group: "ai_brief", state: "enriched" },
      { group: "meta_ads", state: "empty" },
      { group: "google_ads", state: "failed" },
      { group: "search", state: "not_run" },
    ] as const) {
      expect(parseFieldStateParam(serializeFieldStateParam(f))).toEqual(f);
    }
  });

  test("rejects unknown groups and states — including 'running' (transient)", () => {
    expect(parseFieldStateParam("identity:enriched")).toBeNull(); // never a group
    expect(parseFieldStateParam("contacts_tech:bogus")).toBeNull();
    expect(parseFieldStateParam("contacts_tech:running")).toBeNull(); // not filterable
    expect(parseFieldStateParam("nope:empty")).toBeNull();
    expect(parseFieldStateParam("")).toBeNull();
    expect(parseFieldStateParam("contacts_tech")).toBeNull();
  });

  test("legacy 5-family fs values drop silently (URL-breaking by design)", () => {
    expect(parseFieldStateParam("contacts:empty")).toBeNull();
    expect(parseFieldStateParam("website:enriched")).toBeNull();
    expect(parseFieldStateParam("ads:failed")).toBeNull();
  });

  test("viewToSearchParams writes one fs per field-state filter", () => {
    const params = viewToSearchParams(
      {
        sortKey: DEFAULT_SORT_KEY,
        sortDir: DEFAULT_SORT_DIR,
        filters: [],
        fieldStates: [
          { group: "contacts_tech", state: "empty" },
          { group: "reviews", state: "failed" },
        ],
      },
      new URLSearchParams(),
    );
    expect(params.getAll("fs")).toEqual([
      "contacts_tech:empty",
      "reviews:failed",
    ]);
  });

  test("fs param alone (no sort/dir/f) still yields a view", () => {
    const view = parseViewFromSearchParams(
      new URLSearchParams("fs=contacts_tech:empty&fs=bad:state"),
    );
    expect(view).toEqual({
      sortKey: DEFAULT_SORT_KEY,
      sortDir: DEFAULT_SORT_DIR,
      filters: [],
      fieldStates: [{ group: "contacts_tech", state: "empty" }],
    });
  });

  test("an old URL with no fs param parses to an empty fieldStates", () => {
    const view = parseViewFromSearchParams(new URLSearchParams("f=perf:lt:50"));
    expect(view?.fieldStates).toEqual([]);
  });
});

// B16 · the URL-wins-wholesale contract: sg/st/nt are view params too.
describe("sg / st / nt params (B16 + B5)", () => {
  test("viewToSearchParams writes sg per signal filter, st + nt when active", () => {
    const params = viewToSearchParams(
      {
        sortKey: DEFAULT_SORT_KEY,
        sortDir: DEFAULT_SORT_DIR,
        filters: [
          {
            kind: "signal",
            sigKey: "weak_seo",
            sigLabel: "Weak SEO",
            want: "match",
          },
          { field: "perf", op: "<", value: 50 },
        ],
        fieldStates: [],
        statusTab: "NEW",
        notTouched: true,
      },
      new URLSearchParams(),
    );
    expect(params.getAll("sg")).toEqual(["weak_seo:match"]);
    expect(params.getAll("f")).toEqual(["perf:lt:50"]);
    expect(params.get("st")).toBe("new");
    expect(params.get("nt")).toBe("1");
  });

  test("no status tab / not-touched → no st/nt params (clean URLs)", () => {
    const params = viewToSearchParams(
      {
        sortKey: DEFAULT_SORT_KEY,
        sortDir: DEFAULT_SORT_DIR,
        filters: [],
        fieldStates: [],
      },
      new URLSearchParams("st=new&nt=1&sg=weak_seo:match"),
    );
    expect(params.get("st")).toBeNull();
    expect(params.get("nt")).toBeNull();
    expect(params.getAll("sg")).toEqual([]);
  });

  test("sg alone counts as a view param (URL wins wholesale)", () => {
    const view = parseViewFromSearchParams(
      new URLSearchParams("sg=weak_seo:match"),
    );
    expect(view).not.toBeNull();
    expect(view?.filters).toEqual([
      {
        kind: "signal",
        sigKey: "weak_seo",
        sigLabel: "weak_seo",
        want: "match",
      },
    ]);
  });

  test("st/nt alone count as view params; invalid st falls back to no tab", () => {
    const view = parseViewFromSearchParams(new URLSearchParams("nt=1"));
    expect(view).not.toBeNull();
    expect(view?.notTouched).toBe(true);
    expect(view?.statusTab).toBeUndefined();
    const bad = parseViewFromSearchParams(new URLSearchParams("st=bogus"));
    expect(bad).not.toBeNull();
    expect(bad?.statusTab).toBeUndefined();
  });

  // Code-review fix (seed-loss regression) · a URL that never mentions f=/sg=
  // must NOT read as "the sender chose zero filters" — the mount effect keys
  // the filters dimension off hasFilterParams. One status-tab click + reload
  // used to freeze filters: [] into the blob and destroy the goal seed.
  test("hasFilterParams · true only when f=/sg= are actually present", () => {
    expect(
      parseViewFromSearchParams(new URLSearchParams("st=new"))?.hasFilterParams,
    ).toBeUndefined();
    expect(
      parseViewFromSearchParams(new URLSearchParams("sort=reviews&dir=asc"))
        ?.hasFilterParams,
    ).toBeUndefined();
    expect(
      parseViewFromSearchParams(new URLSearchParams("fs=reviews:not_run"))
        ?.hasFilterParams,
    ).toBeUndefined();
    expect(
      parseViewFromSearchParams(new URLSearchParams("f=reviews:gte:20"))
        ?.hasFilterParams,
    ).toBe(true);
    expect(
      parseViewFromSearchParams(new URLSearchParams("sg=weak_seo:match"))
        ?.hasFilterParams,
    ).toBe(true);
    // Presence of the RAW param counts even when every token is invalid —
    // the sender DID express a filter choice; it just drops to none.
    expect(
      parseViewFromSearchParams(new URLSearchParams("f=bogus"))
        ?.hasFilterParams,
    ).toBe(true);
  });

  // Code-review gap · Enriched-only is part of anyNarrowing, so a shared link
  // must reproduce it (eo=1) — and it counts as a view param on its own.
  test("eo param · round-trips Enriched-only and counts as a view param", () => {
    const params = viewToSearchParams(
      {
        sortKey: "match",
        sortDir: -1,
        filters: [],
        fieldStates: [],
        enrichedOnly: true,
      },
      new URLSearchParams(),
    );
    expect(params.get("eo")).toBe("1");
    const view = parseViewFromSearchParams(new URLSearchParams("eo=1"));
    expect(view).not.toBeNull();
    expect(view?.enrichedOnly).toBe(true);
    expect(view?.hasFilterParams).toBeUndefined();
    // Off → no param (clean URLs).
    const off = viewToSearchParams(
      { sortKey: "match", sortDir: -1, filters: [], fieldStates: [] },
      new URLSearchParams("eo=1"),
    );
    expect(off.get("eo")).toBeNull();
  });
});

// ── WB-COL-2 · dismissedCols persistence (the localStorage blob) ─────────────
// Auto-show-after-research must never re-add a column Tom explicitly hid —
// which only holds if the dismissal SURVIVES a reload. Stub window.localStorage
// (node env) and run the real save/load pair.
describe("dismissedCols persistence (wb blob)", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseView = {
    vsCell: true,
    group: "none" as const,
    activeCols: ["biz", "match"],
    sortKey: DEFAULT_SORT_KEY,
    sortDir: DEFAULT_SORT_DIR,
    pageSize: 20,
  };

  test("dismissedCols survives a save/load round-trip", () => {
    saveWorkbenchView("d1", { ...baseView, dismissedCols: ["rating", "seo"] });
    const loaded = loadWorkbenchView("d1");
    expect(loaded?.dismissedCols).toEqual(["rating", "seo"]);
  });

  test("stale/unknown dismissed keys are dropped on load (defensive)", () => {
    store.set(
      "mapsly:wb:d2",
      JSON.stringify({
        ...baseView,
        dismissedCols: ["rating", "retired_column", 42, null],
      }),
    );
    const loaded = loadWorkbenchView("d2");
    expect(loaded?.dismissedCols).toEqual(["rating"]);
  });

  test("a legacy blob without the key yields no dismissedCols field", () => {
    store.set("mapsly:wb:d3", JSON.stringify(baseView));
    const loaded = loadWorkbenchView("d3");
    expect(loaded).not.toBeNull();
    expect(loaded).not.toHaveProperty("dismissedCols");
  });
});
