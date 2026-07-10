// Pure logic for the leads workbench: filter eval, vs-cell delta formatting,
// match% derivation, pain-group mapping, sort, search, pagination windowing.
// Per .claude/rules/testing.md we test the invariants, not rendered DOM.

import { describe, expect, test } from "vitest";

import {
  COLUMNS,
  CSV_HEADERS,
  DEFAULT_ACTIVE_COLUMNS,
  GROUP_SIGNATURE_COLUMNS,
  columnsToAutoShow,
  defaultActiveColumnsForGoal,
  orderColumnsForGoal,
  csvEscape,
  csvLine,
  deriveMatchPct,
  fmtRelativeShort,
  evalFilter,
  filterLabel,
  fmtDelta,
  getPageNumbers,
  groupBySignals,
  matchesSearch,
  mergeSignalVerdicts,
  availableNumericFields,
  availableSignalKeys,
  filterBreakdown,
  filterSignalKey,
  fullyComputableSignalKeys,
  heavyFieldsForFilters,
  makeFilterForSignal,
  painGroupClass,
  passesFilters,
  reachabilityLabel,
  rowToCsvRecord,
  seedSignalFilters,
  sortRows,
  toneForPercentile,
  topCsvSignals,
  type LeadFilter,
  type ValueLeadFilter,
  type WorkbenchLeadRow,
} from "../leads-workbench";

function row(over: Partial<WorkbenchLeadRow> = {}): WorkbenchLeadRow {
  return {
    leadId: "l1",
    businessId: "b1",
    name: "Solea Brickell Spa",
    addr: "100 Main St · Medical spa · Miami",
    cell: "Medical spa · Miami",
    status: "NEW",
    match: 80,
    matchDerived: false,
    matchFromSignals: false,
    perSignal: {},
    pains: [],
    reachability: "RICH",
    reachable: true,
    builtOn: "Wix",
    bookingTool: null,
    website: "https://solea.com",
    pitchAngle: null,
    touch: "None",
    reviews: 120,
    rating: 4.4,
    perf: 42,
    seo: 88,
    metaAdCount: 0,
    googleAdCount: 0,
    serpRank: null,
    aiSummary: null,
    phones: ["+13055550100"],
    emails: ["maria@solea.com"],
    socials: [],
    lastContactedAt: null,
    ...over,
  };
}

describe("evalFilter / passesFilters", () => {
  test("each comparator", () => {
    const r = row({ perf: 42, reviews: 120 });
    expect(evalFilter(r, { field: "perf", op: "<", value: 50 })).toBe(true);
    expect(evalFilter(r, { field: "perf", op: "≤", value: 42 })).toBe(true);
    expect(evalFilter(r, { field: "perf", op: "=", value: 42 })).toBe(true);
    expect(evalFilter(r, { field: "perf", op: ">", value: 50 })).toBe(false);
    expect(evalFilter(r, { field: "reviews", op: "≥", value: 20 })).toBe(true);
    expect(
      evalFilter(r, {
        field: "reviews",
        op: "between",
        value: 100,
        value2: 200,
      }),
    ).toBe(true);
  });

  test("null backing value never matches", () => {
    const r = row({ perf: null });
    expect(evalFilter(r, { field: "perf", op: "<", value: 50 })).toBe(false);
  });

  // AUDIT B3 · the no-data bucket is opt-IN, never silent.
  test("includeNoData makes a null value match; data values still gate on the op", () => {
    const noData = row({ perf: null });
    const failing = row({ perf: 90 });
    const f: LeadFilter = {
      field: "perf",
      op: "<",
      value: 50,
      includeNoData: true,
    };
    expect(evalFilter(noData, f)).toBe(true); // null → included by the flag
    expect(evalFilter(failing, f)).toBe(false); // real value still fails the op
  });

  // AUDIT B2 · the four paid fields evaluate through the registry accessors.
  test("seo / serpRank / metaAdCount / googleAdCount are filterable", () => {
    const r = row({ seo: 60, serpRank: 5, metaAdCount: 0, googleAdCount: 2 });
    expect(evalFilter(r, { field: "seo", op: "<", value: 80 })).toBe(true);
    expect(evalFilter(r, { field: "serpRank", op: ">", value: 3 })).toBe(true);
    expect(evalFilter(r, { field: "metaAdCount", op: "=", value: 0 })).toBe(
      true,
    );
    expect(evalFilter(r, { field: "googleAdCount", op: "≥", value: 1 })).toBe(
      true,
    );
    // Absent heavy value (not serialized) reads null → no match without the flag.
    const bare = row({ seo: undefined });
    expect(evalFilter(bare, { field: "seo", op: "<", value: 80 })).toBe(false);
  });

  test("contactability filters read array length (emails / phones)", () => {
    const reachable = row({
      emails: ["a@x.com", "b@x.com"],
      phones: ["+13055550100"],
    });
    const noEmail = row({ emails: [], phones: ["+13055550100"] });
    // "has at least one email" — the filter the workbench was missing.
    expect(evalFilter(reachable, { field: "emails", op: "≥", value: 1 })).toBe(
      true,
    );
    expect(evalFilter(noEmail, { field: "emails", op: "≥", value: 1 })).toBe(
      false,
    );
    // count comparisons work too (≥2 emails).
    expect(evalFilter(reachable, { field: "emails", op: "≥", value: 2 })).toBe(
      true,
    );
    expect(evalFilter(noEmail, { field: "phones", op: "≥", value: 1 })).toBe(
      true,
    );
  });

  test("AND semantics across active filters", () => {
    const r = row({ perf: 42, reviews: 120 });
    const filters: LeadFilter[] = [
      { field: "perf", op: "<", value: 50 },
      { field: "reviews", op: "≥", value: 20 },
    ];
    expect(passesFilters(r, filters)).toBe(true);
    expect(
      passesFilters(r, [...filters, { field: "reviews", op: "≥", value: 999 }]),
    ).toBe(false);
  });

  test("filterLabel renders human chip text", () => {
    expect(filterLabel({ field: "perf", op: "<", value: 50 })).toBe(
      "Lighthouse perf < 50",
    );
    expect(
      filterLabel({ field: "reviews", op: "between", value: 10, value2: 20 }),
    ).toBe("Reviews 10–20");
  });

  test("signal filter matches on the per-lead verdict already on the row", () => {
    const matched = row({ perSignal: { no_booking: true } });
    const missed = row({ perSignal: { no_booking: false } });
    const notComputed = row({ perSignal: {} });
    const wantMatch = {
      kind: "signal" as const,
      sigKey: "no_booking",
      sigLabel: "No booking tool",
      want: "match" as const,
    };
    const wantMiss = { ...wantMatch, want: "miss" as const };
    expect(evalFilter(matched, wantMatch)).toBe(true);
    expect(evalFilter(missed, wantMatch)).toBe(false);
    expect(evalFilter(matched, wantMiss)).toBe(false);
    expect(evalFilter(missed, wantMiss)).toBe(true);
    // not-yet-computed (null/absent) never satisfies either — opt-in honesty.
    expect(evalFilter(notComputed, wantMatch)).toBe(false);
    expect(evalFilter(notComputed, wantMiss)).toBe(false);
  });

  test("filterLabel renders a signal-filter chip", () => {
    expect(
      filterLabel({
        kind: "signal",
        sigKey: "slow_site",
        sigLabel: "Slow site",
        want: "match",
      }),
    ).toBe("Slow site: matched");
  });
});

describe("fmtDelta", () => {
  test("above median (higher better) → green up", () => {
    const d = fmtDelta(200, 100, true);
    expect(d.dir).toBe("up");
    expect(d.text).toContain("▲");
    expect(d.text).toContain("+100");
  });

  test("below median (higher better) → red down", () => {
    const d = fmtDelta(40, 100, true);
    expect(d.dir).toBe("dn");
    expect(d.text).toContain("▼");
  });

  test("lower-is-better flips the color", () => {
    // value below median is GOOD when higherIsBetter=false
    expect(fmtDelta(40, 100, false).dir).toBe("up");
    expect(fmtDelta(200, 100, false).dir).toBe("dn");
  });

  test("within tolerance → ≈ flat", () => {
    expect(fmtDelta(101, 100, true)).toEqual({ text: "≈", dir: "flat" });
  });
});

describe("deriveMatchPct", () => {
  test("stored 0–1 fraction scales to 0–100", () => {
    expect(deriveMatchPct(0.87, 0)).toEqual({ match: 87, derived: false });
  });

  test("stored 0–100 passes through clamped", () => {
    expect(deriveMatchPct(73, 0)).toEqual({ match: 73, derived: false });
    expect(deriveMatchPct(140, 0)).toEqual({ match: 100, derived: false });
  });

  test("derives from pain count when no stored score, capped at 95", () => {
    expect(deriveMatchPct(null, 0)).toEqual({ match: 40, derived: true });
    expect(deriveMatchPct(null, 1).match).toBe(60);
    expect(deriveMatchPct(null, 2).match).toBe(75);
    expect(deriveMatchPct(null, 3).match).toBe(85);
    expect(deriveMatchPct(undefined, 9)).toEqual({ match: 92, derived: true });
  });
});

describe("painGroupClass", () => {
  test("maps known groups to .ppchip modifiers", () => {
    expect(painGroupClass("website")).toBe("weak-web");
    expect(painGroupClass("Ad spend")).toBe("wasting");
    expect(painGroupClass("reputation")).toBe("reputation");
    expect(painGroupClass("search visibility")).toBe("under");
    expect(painGroupClass("growth")).toBe("growing");
  });

  test("unknown → neutral more chip", () => {
    expect(painGroupClass("whatever")).toBe("more");
  });
});

describe("toneForPercentile", () => {
  test("buckets", () => {
    expect(toneForPercentile(90)).toBe("g");
    expect(toneForPercentile(50)).toBe("a");
    expect(toneForPercentile(10)).toBe("r");
  });
});

describe("availableSignalKeys (2026-07-10 · any-row availability)", () => {
  const signals = [
    { key: "sig_a", title: "A" },
    { key: "sig_b", title: "B" },
    { key: "sig_c", title: "C" },
  ];

  test("a signal is available when ANY row has a verdict; never-computed stays hidden", () => {
    const rows = [
      row({ perSignal: { sig_a: true, sig_b: false } }),
      row({ perSignal: { sig_a: false, sig_b: null } }),
      // sig_c present on neither row.
    ];
    const avail = availableSignalKeys(rows, signals);
    expect(avail.has("sig_a")).toBe(true); // non-null on both rows
    expect(avail.has("sig_b")).toBe(true); // computable on row 1 → offered
    expect(avail.has("sig_c")).toBe(false); // never present anywhere → hidden
  });

  test("one dead/failed lead no longer hides the signal for the whole view", () => {
    // The OLD every-row gate collapsed the picker to free-Maps signals the
    // moment one lead (a dead-site "None" row) lacked data. evalFilter treats
    // null verdicts as never-matching, so offering the signal is honest.
    const rows = [
      row({ perSignal: { sig_a: true } }),
      row({ perSignal: { sig_a: true } }),
      row({ perSignal: {} }), // absent/pruned key on one lead
    ];
    expect(availableSignalKeys(rows, signals).has("sig_a")).toBe(true);
  });

  test("true AND false verdicts both count as computable", () => {
    const rows = [
      row({ perSignal: { sig_a: true } }),
      row({ perSignal: { sig_a: false } }),
    ];
    expect(availableSignalKeys(rows, signals).has("sig_a")).toBe(true);
  });

  test("no rows → nothing available", () => {
    expect(availableSignalKeys([], signals).size).toBe(0);
  });
});

describe("availableNumericFields", () => {
  test("match is always available; reviews/perf gated on non-null", () => {
    const rows = [row({ reviews: null, rating: null, perf: null })];
    const a = availableNumericFields(rows);
    expect(a.has("match")).toBe(true); // derived for every row
    expect(a.has("reviews")).toBe(false); // all null
    expect(a.has("perf")).toBe(false);
  });

  test("a single enriched row unlocks that field", () => {
    const rows = [
      row({ reviews: null, perf: null }),
      row({ reviews: 30, perf: 55 }),
    ];
    const a = availableNumericFields(rows);
    expect(a.has("reviews")).toBe(true);
    expect(a.has("perf")).toBe(true);
  });

  test("contact fields need ≥1 actual contact (an all-empty column is not filterable)", () => {
    const noContacts = [row({ emails: [], phones: [] })];
    const a0 = availableNumericFields(noContacts);
    expect(a0.has("emails")).toBe(false);
    expect(a0.has("phones")).toBe(false);

    const withContacts = [
      row({ emails: [], phones: [] }),
      row({ emails: ["x@y.com"], phones: [] }),
    ];
    const a1 = availableNumericFields(withContacts);
    expect(a1.has("emails")).toBe(true);
    expect(a1.has("phones")).toBe(false); // still no phone anywhere
  });

  // AUDIT B2 · an UN-hydrated heavy field is "unknown", not "no data" — the
  // picker offers it (adding the filter triggers the lazy hydration); once
  // loaded it gates on real data like everything else.
  test("un-hydrated heavy fields are offered; hydrated-but-absent are not", () => {
    const rows = [row({ seo: undefined, serpRank: undefined })];
    // Nothing hydrated → both offered (unknown).
    const none = availableNumericFields(rows, new Set());
    expect(none.has("seo")).toBe(true);
    expect(none.has("serpRank")).toBe(true);
    // seo hydrated but null everywhere → genuinely no data → not offered;
    // serpRank still un-hydrated → still offered.
    const seoLoaded = availableNumericFields(
      [row({ seo: null, serpRank: undefined })],
      new Set(["seo"]),
    );
    expect(seoLoaded.has("seo")).toBe(false);
    expect(seoLoaded.has("serpRank")).toBe(true);
    // Hydrated WITH data → offered on the data path.
    const withData = availableNumericFields(
      [row({ seo: 70 })],
      new Set(["seo", "serpRank", "metaAdCount", "googleAdCount"]),
    );
    expect(withData.has("seo")).toBe(true);
    // No param (legacy callers) → strict old behavior.
    expect(availableNumericFields(rows).has("seo")).toBe(false);
  });
});

// AUDIT B2 · applied filters on heavy fields hydrate like activated columns.
describe("heavyFieldsForFilters", () => {
  test("maps heavy filter fields to their row fields; core fields map to none", () => {
    const heavy = heavyFieldsForFilters([
      { field: "seo", op: "<", value: 80 },
      { field: "serpRank", op: ">", value: 3 },
      { field: "reviews", op: "≥", value: 20 }, // CORE — always serialized
      { kind: "signal", sigKey: "s", sigLabel: "S", want: "match" },
    ]);
    expect(heavy).toEqual(new Set(["seo", "serpRank"]));
    expect(heavyFieldsForFilters([])).toEqual(new Set());
  });
});

// AUDIT B3 · the chip's honest "N match · M no data" breakdown.
describe("filterBreakdown", () => {
  test("numeric: splits data-matches from the no-data bucket", () => {
    const rows = [
      row({ perf: 42 }), // matches < 50
      row({ perf: 90 }), // has data, fails the op
      row({ perf: null }), // no data
      row({ perf: undefined }), // not serialized → no data too
    ];
    expect(
      filterBreakdown(rows, { field: "perf", op: "<", value: 50 }),
    ).toEqual({ match: 1, noData: 2 });
    // includeNoData must NOT inflate the match count — the buckets stay split.
    expect(
      filterBreakdown(rows, {
        field: "perf",
        op: "<",
        value: 50,
        includeNoData: true,
      }),
    ).toEqual({ match: 1, noData: 2 });
  });

  test("signal: counts want-consistent verdicts and null verdicts", () => {
    const rows = [
      row({ perSignal: { s: true } }),
      row({ perSignal: { s: false } }),
      row({ perSignal: { s: null } }),
      row({ perSignal: {} }), // pruned/absent reads as no data
    ];
    expect(
      filterBreakdown(rows, {
        kind: "signal",
        sigKey: "s",
        sigLabel: "S",
        want: "match",
      }),
    ).toEqual({ match: 1, noData: 2 });
    expect(
      filterBreakdown(rows, {
        kind: "signal",
        sigKey: "s",
        sigLabel: "S",
        want: "miss",
      }),
    ).toEqual({ match: 1, noData: 2 });
  });
});

describe("seedSignalFilters (goal-step default filters)", () => {
  const goalSignals = [
    { key: "sig_a", title: "Signal A" },
    { key: "sig_b", title: "Signal B" },
  ];

  test("seeds only goal signals with data on EVERY lead, each as a 'match' filter", () => {
    // sig_a computed on both leads; sig_b never computed → excluded (P0-B guard:
    // auto-applying a partially-enriched signal would hide not-yet-computed leads).
    const rows = [
      row({ perSignal: { sig_a: true, sig_b: null } }),
      row({ perSignal: { sig_a: false, sig_b: null } }),
    ];
    const seed = seedSignalFilters(rows, goalSignals);
    expect(seed).toEqual([
      { kind: "signal", sigKey: "sig_a", sigLabel: "Signal A", want: "match" },
    ]);
  });

  // 2026-07-10 · the picker gate relaxed to any-row, but the AUTO-APPLY seed
  // must stay strict: a signal computable on only SOME rows never seeds (it
  // would silently hide every not-yet-enriched lead on mount — P0-B).
  test("a PARTIALLY-computed goal signal never seeds (strict gate, not the relaxed picker gate)", () => {
    const rows = [
      row({ perSignal: { sig_a: true } }),
      row({ perSignal: {} }), // one un-enriched lead
    ];
    // Sanity: the relaxed PICKER gate would offer it…
    expect(availableSignalKeys(rows, goalSignals).has("sig_a")).toBe(true);
    // …but the seed must not auto-apply it.
    expect(seedSignalFilters(rows, goalSignals)).toEqual([]);
    expect(fullyComputableSignalKeys(rows, goalSignals).has("sig_a")).toBe(
      false,
    );
  });

  test("a platform-kind goal signal seeds as a VALUE filter at its default mode", () => {
    const goal = [{ key: "no_booking", title: "No online booking tool" }];
    const rows = [row({ perSignal: { no_booking: true } })];
    expect(seedSignalFilters(rows, goal)).toEqual([
      {
        kind: "value",
        sigKey: "no_booking",
        field: "bookingTool",
        label: "Booking tool",
        mode: "none",
      },
    ]);
  });

  test("empty when nothing has enriched yet (never hides un-enriched leads)", () => {
    const rows = [row({ perSignal: { sig_a: null, sig_b: null } })];
    expect(seedSignalFilters(rows, goalSignals)).toEqual([]);
  });

  test("empty when the goal carries no signals", () => {
    expect(seedSignalFilters([row()], [])).toEqual([]);
  });
});

// ── 2026-07-10 · value filters (Built on / Booking tool · Any/specific/none) ─
describe("value filters (Any / specific / none)", () => {
  const techRan = (r: WorkbenchLeadRow) => r.perSignal.__tech === true;
  const scanned = { __tech: true };
  const builtOnAny: ValueLeadFilter = {
    kind: "value",
    sigKey: "diy_platform",
    field: "builtOn",
    label: "Built on",
    mode: "any",
  };
  const bookingNone: ValueLeadFilter = {
    kind: "value",
    sigKey: "no_booking",
    field: "bookingTool",
    label: "Booking tool",
    mode: "none",
  };

  test("mode 'any' — a detected value matches, null doesn't", () => {
    expect(evalFilter(row({ builtOn: "Wix" }), builtOnAny)).toBe(true);
    expect(evalFilter(row({ builtOn: null }), builtOnAny)).toBe(false);
  });

  test("mode 'is' — case-insensitive equality on the detected value", () => {
    const isWix: ValueLeadFilter = {
      ...builtOnAny,
      mode: "is" as const,
      value: "wix",
    };
    expect(evalFilter(row({ builtOn: "Wix" }), isWix)).toBe(true);
    expect(evalFilter(row({ builtOn: "WordPress" }), isWix)).toBe(false);
    expect(evalFilter(row({ builtOn: null }), isWix)).toBe(false);
    // A malformed "is" without a value matches nothing (never everything).
    expect(
      evalFilter(row({ builtOn: "Wix" }), {
        ...builtOnAny,
        mode: "is" as const,
      }),
    ).toBe(false);
  });

  test("mode 'none' — only a SCANNED lead with nothing detected matches", () => {
    // Scanned + nothing detected → verified none → match.
    expect(
      evalFilter(
        row({ bookingTool: null, perSignal: scanned }),
        bookingNone,
        techRan,
      ),
    ).toBe(true);
    // Un-scanned null = unknown, never "none" (the honesty rule).
    expect(evalFilter(row({ bookingTool: null }), bookingNone, techRan)).toBe(
      false,
    );
    // No techRan supplied at all (legacy caller) → opt-in honesty → no match.
    expect(
      evalFilter(row({ bookingTool: null, perSignal: scanned }), bookingNone),
    ).toBe(false);
    // A detected tool is never "none", scanned or not.
    expect(
      evalFilter(
        row({ bookingTool: "Calendly", perSignal: scanned }),
        bookingNone,
        techRan,
      ),
    ).toBe(false);
  });

  test("an un-hydrated heavy field (undefined) never matches any mode", () => {
    const r = row({ bookingTool: undefined, perSignal: scanned });
    expect(
      evalFilter(r, { ...bookingNone, mode: "any" as const }, techRan),
    ).toBe(false);
    expect(evalFilter(r, bookingNone, techRan)).toBe(false);
    expect(
      evalFilter(
        r,
        { ...bookingNone, mode: "is" as const, value: "Calendly" },
        techRan,
      ),
    ).toBe(false);
  });

  test("passesFilters threads techRan through to value filters", () => {
    const r = row({ bookingTool: null, perSignal: scanned });
    expect(passesFilters(r, [bookingNone], techRan)).toBe(true);
    expect(passesFilters(r, [bookingNone])).toBe(false);
  });

  test("filterBreakdown buckets: hydrating + un-scanned nulls are no-data; scanned nulls are data", () => {
    const rows = [
      row({ bookingTool: "Calendly", perSignal: scanned }), // detected → not "none"
      row({ bookingTool: null, perSignal: scanned }), // verified none → match
      row({ bookingTool: null }), // un-scanned → no data
      row({ bookingTool: undefined }), // not hydrated → no data
    ];
    expect(filterBreakdown(rows, bookingNone, techRan)).toEqual({
      match: 1,
      noData: 2,
    });
    // Same rows through "any": the detected row matches; the verified-none row
    // is DATA that fails the mode (not the no-data bucket).
    expect(
      filterBreakdown(rows, { ...bookingNone, mode: "any" as const }, techRan),
    ).toEqual({ match: 1, noData: 2 });
  });

  test("filterLabel speaks the mode", () => {
    expect(filterLabel(builtOnAny)).toBe("Built on: any");
    expect(
      filterLabel({ ...builtOnAny, mode: "is" as const, value: "Wix" }),
    ).toBe("Built on: Wix");
    // The none wording comes from the registry (builtOn = custom-built).
    expect(filterLabel({ ...builtOnAny, mode: "none" as const })).toBe(
      "Built on: custom / none detected",
    );
    expect(filterLabel(bookingNone)).toBe("Booking tool: none");
  });

  test("makeFilterForSignal routes platform-kind signals to value filters", () => {
    expect(
      makeFilterForSignal("diy_platform", "Built on DIY platform"),
    ).toEqual({
      kind: "value",
      sigKey: "diy_platform",
      field: "builtOn",
      label: "Built on",
      mode: "any",
    });
    expect(makeFilterForSignal("no_booking", "No online booking tool")).toEqual(
      {
        kind: "value",
        sigKey: "no_booking",
        field: "bookingTool",
        label: "Booking tool",
        mode: "none",
      },
    );
    // Everything else stays a match/miss verdict filter.
    expect(makeFilterForSignal("thin_seo", "Thin SEO")).toEqual({
      kind: "signal",
      sigKey: "thin_seo",
      sigLabel: "Thin SEO",
      want: "match",
    });
  });

  test("filterSignalKey claims signal + value filters, not numeric ones", () => {
    expect(filterSignalKey(builtOnAny)).toBe("diy_platform");
    expect(
      filterSignalKey({
        kind: "signal",
        sigKey: "s",
        sigLabel: "S",
        want: "match",
      }),
    ).toBe("s");
    expect(filterSignalKey({ field: "perf", op: "<", value: 50 })).toBe(null);
  });

  test("a Booking-tool value filter auto-requests its heavy field; Built-on (core) doesn't", () => {
    expect(heavyFieldsForFilters([bookingNone])).toEqual(
      new Set(["bookingTool"]),
    );
    expect(heavyFieldsForFilters([builtOnAny])).toEqual(new Set());
  });
});

describe("mergeSignalVerdicts (#2 · library ∪ goal, goal wins)", () => {
  test("goal verdicts win and are kept even when null; non-goal nulls pruned", () => {
    const lib = { sig_a: true, sig_b: false, sig_c: null };
    const goal = { sig_a: false, sig_d: null };
    const out = mergeSignalVerdicts(lib, goal, new Set(["sig_a", "sig_d"]));
    // goal sig_a wins over the library's true; goal sig_d kept as null (column).
    expect(out.sig_a).toBe(false);
    expect(out.sig_d).toBe(null);
    // non-goal library verdicts: keep non-null (sig_b), prune null (sig_c).
    expect(out.sig_b).toBe(false);
    expect("sig_c" in out).toBe(false);
  });

  test("every goal key is present even absent from both maps (columns need it)", () => {
    const out = mergeSignalVerdicts({}, {}, new Set(["g1", "g2"]));
    expect(out).toEqual({ g1: null, g2: null });
  });
});

describe("groupBySignals (#5 · segment by verdict combination)", () => {
  const axes = [
    { sigKey: "seo", sigLabel: "Weak SEO" },
    { sigKey: "booking", sigLabel: "No booking" },
  ];

  test("buckets rows by their verdict tuple with ✓/✗/— labels", () => {
    const rows = [
      row({ leadId: "a", perSignal: { seo: true, booking: true } }),
      row({ leadId: "b", perSignal: { seo: true, booking: false } }),
      row({ leadId: "c", perSignal: { seo: true, booking: true } }),
      row({ leadId: "d", perSignal: { seo: true } }), // booking absent → —
    ];
    const groups = groupBySignals(rows, axes);
    // 3 distinct combinations: (✓✓)×2, (✓✗)×1, (✓—)×1.
    expect(groups).toHaveLength(3);
    const bothMatched = groups.find(
      (g) => g.label === "Weak SEO ✓ · No booking ✓",
    );
    expect(bothMatched?.rows.map((r) => r.leadId)).toEqual(["a", "c"]);
    expect(groups.some((g) => g.label === "Weak SEO ✓ · No booking ✗")).toBe(
      true,
    );
    expect(groups.some((g) => g.label === "Weak SEO ✓ · No booking —")).toBe(
      true,
    );
  });

  test("orders strongest-first: most matched, then fewest unknown", () => {
    const rows = [
      row({ leadId: "miss", perSignal: { seo: false, booking: false } }),
      row({ leadId: "unknown", perSignal: {} }), // — —
      row({ leadId: "match", perSignal: { seo: true, booking: true } }),
    ];
    const labels = groupBySignals(rows, axes).map((g) => g.label);
    // both-matched leads first; both-unknown last.
    expect(labels[0]).toBe("Weak SEO ✓ · No booking ✓");
    expect(labels[labels.length - 1]).toBe("Weak SEO — · No booking —");
  });

  test("no axes → no groups (caller falls back to flat)", () => {
    expect(groupBySignals([row()], [])).toEqual([]);
  });
});

describe("reachabilityLabel", () => {
  test("maps each tier to a label + tone", () => {
    expect(reachabilityLabel("RICH")).toEqual({ text: "Rich", tone: "green" });
    expect(reachabilityLabel("MULTI")).toEqual({
      text: "Multi",
      tone: "green",
    });
    expect(reachabilityLabel("EMAIL_ONLY")).toEqual({
      text: "Email",
      tone: "amber",
    });
    expect(reachabilityLabel("PHONE_ONLY")).toEqual({
      text: "Phone",
      tone: "amber",
    });
    expect(reachabilityLabel("UNREACHABLE")).toEqual({
      text: "None",
      tone: "red",
    });
  });

  test("UNKNOWN / unmapped → muted 'not scanned' state", () => {
    expect(reachabilityLabel("UNKNOWN").tone).toBe("muted");
    expect(reachabilityLabel("").tone).toBe("muted");
    expect(reachabilityLabel("SOMETHING_NEW").tone).toBe("muted");
  });
});

describe("sortRows", () => {
  test("sorts by match desc then asc; nulls sink", () => {
    const rows = [
      row({ leadId: "a", match: 40 }),
      row({ leadId: "b", match: 90 }),
    ];
    expect(sortRows(rows, "match", -1).map((r) => r.leadId)).toEqual([
      "b",
      "a",
    ]);
    expect(sortRows(rows, "match", 1).map((r) => r.leadId)).toEqual(["a", "b"]);
    const withNull = [
      row({ leadId: "x", reviews: null }),
      row({ leadId: "y", reviews: 5 }),
    ];
    expect(sortRows(withNull, "reviews", -1).map((r) => r.leadId)).toEqual([
      "y",
      "x",
    ]);
  });

  test("sorts by lastContactedAt desc; never-contacted sinks", () => {
    const rows = [
      row({ leadId: "never", lastContactedAt: null }),
      row({ leadId: "old", lastContactedAt: "2026-01-01T00:00:00.000Z" }),
      row({ leadId: "recent", lastContactedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    // The UI passes the column KEY ("lastContactedAt"), not its kind ("lastC").
    // The old test used "lastC" — which matched the buggy case and masked a
    // silent dead sort. Assert the real key sorts.
    expect(sortRows(rows, "lastContactedAt", -1).map((r) => r.leadId)).toEqual([
      "recent",
      "old",
      "never",
    ]);
    // Guard the regression: the kind must NOT be a live sort key.
    expect(sortRows(rows, "lastC", -1).map((r) => r.leadId)).toEqual([
      "never",
      "old",
      "recent",
    ]);
  });
});

describe("matchesSearch", () => {
  test("matches name / addr / builtOn, case-insensitive", () => {
    const r = row();
    expect(matchesSearch(r, "")).toBe(true);
    expect(matchesSearch(r, "solea")).toBe(true);
    expect(matchesSearch(r, "main st")).toBe(true);
    expect(matchesSearch(r, "wix")).toBe(true);
    expect(matchesSearch(r, "nope")).toBe(false);
  });
});

describe("getPageNumbers", () => {
  test("no ellipsis when ≤ 7 pages", () => {
    expect(getPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test("windows with ellipsis on both sides for the middle", () => {
    expect(getPageNumbers(5, 10)).toEqual([
      1,
      "ellipsis",
      4,
      5,
      6,
      "ellipsis",
      10,
    ]);
  });

  test("first page → trailing ellipsis only", () => {
    expect(getPageNumbers(1, 10)).toEqual([1, 2, "ellipsis", 10]);
  });

  test("last page → leading ellipsis only", () => {
    expect(getPageNumbers(10, 10)).toEqual([1, "ellipsis", 9, 10]);
  });
});

describe("column registry", () => {
  test("the first-scan default set (2026-07-06): identity + reviews + contacts + workflow", () => {
    // Exact-equal (not arrayContaining) so BOTH the membership AND the
    // registry render order are pinned: identity anchor → decision signal
    // (reviews, the revenue proxy) → contact/action data → workflow state.
    expect(DEFAULT_ACTIVE_COLUMNS).toEqual([
      "biz",
      "match",
      "pains",
      "reviews",
      "website",
      "phones",
      "emails",
      "status",
      "touch",
    ]);
  });

  test("reachable + lastContactedAt are demoted to addable (duplicate ink)", () => {
    expect(COLUMNS.find((c) => c.key === "reachable")?.defaultOn).toBe(false);
    expect(COLUMNS.find((c) => c.key === "lastContactedAt")?.defaultOn).toBe(
      false,
    );
  });

  test("rating stays off by default (near-constant in healthy cells)", () => {
    expect(COLUMNS.find((c) => c.key === "rating")?.defaultOn).toBe(false);
  });

  test("research-detail span keeps group members adjacent (registry order)", () => {
    // The span between the contact anchors and the workflow tail — every
    // data-group's columns must sit together so the .gstart cluster
    // boundaries (and the goal-first reorder) hold.
    const keys = COLUMNS.map((c) => c.key);
    const span = COLUMNS.slice(keys.indexOf("emails") + 1, keys.indexOf("cov"));
    const seen = new Set<string>();
    let prev: string | undefined;
    for (const c of span) {
      const g = c.group ?? "none";
      if (g !== prev && seen.has(g)) {
        throw new Error(`group ${g} appears in two non-adjacent runs`);
      }
      seen.add(g);
      prev = g;
    }
  });
});

// ── CSV export mapping (WP4-4 · shared by client export + server route) ──────

describe("csvEscape / csvLine", () => {
  test("quote-wraps and doubles inner quotes", () => {
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
  });

  test("null/undefined → empty cell", () => {
    expect(csvEscape(null)).toBe('""');
    expect(csvEscape(undefined)).toBe('""');
  });

  test("commas and newlines survive inside one cell", () => {
    expect(csvLine(["a,b", "c\nd", 5])).toBe('"a,b","c\nd","5"');
  });
});

describe("rowToCsvRecord", () => {
  const goalSignals = [
    { key: "slow_site", title: "Slow site (Lighthouse)" },
    { key: "no_pixel", title: "No tracking pixel" },
  ];

  test("maps the 13 columns in CSV_HEADERS order", () => {
    const r = row({
      perSignal: { slow_site: true, no_pixel: false },
      pitchAngle: "Site loads in 9s",
    });
    const record = rowToCsvRecord(r, goalSignals);
    expect(record).toHaveLength(CSV_HEADERS.length);
    expect(record).toEqual([
      "Solea Brickell Spa",
      "100 Main St · Medical spa · Miami",
      80,
      "NEW",
      "Yes",
      "maria@solea.com",
      "+13055550100",
      "https://solea.com",
      4.4,
      120,
      42,
      "Slow site (Lighthouse)",
      "Site loads in 9s",
    ]);
  });

  test("multi-value contacts are semicolon-joined", () => {
    const r = row({
      emails: ["a@x.com", "b@x.com"],
      phones: ["+1", "+2", "+3"],
    });
    const record = rowToCsvRecord(r, []);
    expect(record[5]).toBe("a@x.com; b@x.com");
    expect(record[6]).toBe("+1; +2; +3");
  });

  test("null facts export as empty cells after escaping", () => {
    const r = row({
      website: null,
      rating: null,
      reviews: null,
      perf: null,
      pitchAngle: null,
      emails: [],
      phones: [],
      reachable: false,
    });
    const line = csvLine(rowToCsvRecord(r, []));
    expect(line).toContain('"No"');
    expect(line.endsWith('"","",""')).toBe(true); // perf, top signals, pitch
  });
});

describe("topCsvSignals", () => {
  const goalSignals = [
    { key: "a", title: "A" },
    { key: "b", title: "B" },
    { key: "c", title: "C" },
    { key: "d", title: "D" },
  ];

  test("prefers FIRED goal signals (true verdicts only)", () => {
    const r = row({
      perSignal: { a: true, b: false, c: null, d: true },
      pains: [{ group: "more", label: "Pain", title: "Pain" }],
    });
    expect(topCsvSignals(r, goalSignals)).toBe("A; D");
  });

  test("falls back to pain labels when nothing fired", () => {
    const r = row({
      perSignal: { a: false, b: null },
      pains: [
        { group: "more", label: "Slow site", title: "t" },
        { group: "more", label: "No pixel", title: "t" },
      ],
    });
    expect(topCsvSignals(r, goalSignals)).toBe("Slow site; No pixel");
  });

  test("caps at 3", () => {
    const r = row({ perSignal: { a: true, b: true, c: true, d: true } });
    expect(topCsvSignals(r, goalSignals)).toBe("A; B; C");
  });

  test("empty when no signals and no pains", () => {
    expect(topCsvSignals(row(), [])).toBe("");
  });
});

// ── WB-COL-1 · goal columns default ON ───────────────────────────────────────
describe("defaultActiveColumnsForGoal", () => {
  test("no researches (discovery-only) → exactly DEFAULT_ACTIVE_COLUMNS", () => {
    expect(defaultActiveColumnsForGoal([])).toEqual(DEFAULT_ACTIVE_COLUMNS);
  });

  test("['lighthouse'] adds the site-speed columns (perf + seo)", () => {
    const cols = defaultActiveColumnsForGoal(["lighthouse"]);
    expect(cols).toContain("perf");
    expect(cols).toContain("seo");
    // still a superset of the defaults (additive, never drops a default)
    for (const d of DEFAULT_ACTIVE_COLUMNS) expect(cols).toContain(d);
  });

  test("['reviews'] adds reviews + rating", () => {
    const cols = defaultActiveColumnsForGoal(["reviews"]);
    expect(cols).toContain("reviews");
    expect(cols).toContain("rating");
  });

  test("['meta_ads'] adds metaAdCount but NOT googleAdCount", () => {
    const cols = defaultActiveColumnsForGoal(["meta_ads"]);
    expect(cols).toContain("metaAdCount");
    expect(cols).not.toContain("googleAdCount");
  });

  test("preserves COLUMNS render order + 'biz' stays first, no dupes", () => {
    const cols = defaultActiveColumnsForGoal(["lighthouse", "reviews"]);
    expect(cols[0]).toBe("biz");
    expect(new Set(cols).size).toBe(cols.length);
    // order matches the COLUMNS registry order
    const order = COLUMNS.map((c) => c.key);
    const idx = cols.map((k) => order.indexOf(k));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});

// ── WB-COL-2 · auto-show after a run ─────────────────────────────────────────
describe("columnsToAutoShow", () => {
  test("maps a token to its group's signature columns", () => {
    expect(columnsToAutoShow(["meta_ads"], [], [])).toEqual({
      cols: ["metaAdCount"],
      groups: ["meta_ads"],
    });
    expect(columnsToAutoShow(["lighthouse"], [], [])).toEqual({
      cols: ["perf", "seo"],
      groups: ["site_speed"],
    });
  });

  test("ai_research AND services both collapse to the ai_brief group (once)", () => {
    expect(columnsToAutoShow(["ai_research"], [], [])).toEqual({
      cols: ["aiSummary"],
      groups: ["ai_brief"],
    });
    expect(columnsToAutoShow(["services"], [], [])).toEqual({
      cols: ["aiSummary"],
      groups: ["ai_brief"],
    });
    // Both tokens in one run → one group, one column, no dupes.
    expect(columnsToAutoShow(["ai_research", "services"], [], [])).toEqual({
      cols: ["aiSummary"],
      groups: ["ai_brief"],
    });
  });

  test("subtracts already-active columns", () => {
    expect(columnsToAutoShow(["lighthouse"], ["perf"], [])).toEqual({
      cols: ["seo"],
      groups: ["site_speed"],
    });
  });

  test("subtracts dismissed columns (an explicit hide is never re-added)", () => {
    expect(columnsToAutoShow(["reviews"], [], ["rating"])).toEqual({
      cols: ["reviews"],
      groups: ["reviews"],
    });
    expect(columnsToAutoShow(["reviews"], [], ["reviews", "rating"])).toEqual({
      cols: [],
      groups: [],
    });
  });

  test("groups excludes an all-visible group (no toast noise)", () => {
    // contacts_tech's signature minus the defaults leaves only builtOn; with
    // builtOn also visible the whole group contributes nothing.
    expect(
      columnsToAutoShow(
        ["contacts", "tech"],
        [...DEFAULT_ACTIVE_COLUMNS, "builtOn"],
        [],
      ),
    ).toEqual({ cols: [], groups: [] });
    // With the defaults only, the tech half (builtOn) still surfaces.
    expect(
      columnsToAutoShow(["contacts", "tech"], DEFAULT_ACTIVE_COLUMNS, []),
    ).toEqual({ cols: ["builtOn"], groups: ["contacts_tech"] });
  });

  test("cols come back in COLUMNS render order regardless of token order", () => {
    const { cols } = columnsToAutoShow(["serp", "lighthouse"], [], []);
    // perf/seo precede serpRank in the registry.
    expect(cols).toEqual(["perf", "seo", "serpRank"]);
  });

  test("unknown tokens are ignored; empty tokens → empty result", () => {
    expect(columnsToAutoShow(["bogus_type"], [], [])).toEqual({
      cols: [],
      groups: [],
    });
    expect(columnsToAutoShow([], [], [])).toEqual({ cols: [], groups: [] });
  });

  test("every signature column exists in the registry", () => {
    const valid = new Set(COLUMNS.map((c) => c.key));
    for (const cols of Object.values(GROUP_SIGNATURE_COLUMNS)) {
      for (const key of cols) expect(valid.has(key)).toBe(true);
    }
  });
});

// ── WB-COL-3 · goal-first column order ───────────────────────────────────────
describe("orderColumnsForGoal", () => {
  const keys = (defs: readonly { key: string }[]) => defs.map((d) => d.key);

  test("no goal → exactly the registry", () => {
    expect(orderColumnsForGoal([])).toEqual(COLUMNS);
  });

  test("unrecognizable tokens → exactly the registry", () => {
    expect(orderColumnsForGoal(["bogus"])).toEqual(COLUMNS);
  });

  test("goal clusters lead the research span, in goal-token order", () => {
    const out = keys(orderColumnsForGoal(["lighthouse", "serp"]));
    const spanStart = out.indexOf("emails") + 1;
    // site_speed (perf, seo) then search (serpRank) lead the span; the
    // non-goal clusters follow in registry order.
    expect(out.slice(spanStart, spanStart + 3)).toEqual([
      "perf",
      "seo",
      "serpRank",
    ]);
  });

  test("identity/contact head + workflow tail never move", () => {
    const out = keys(orderColumnsForGoal(["meta_ads", "ai_research"]));
    // Owner 2026-07-06 · rating anchors IMMEDIATELY after reviews (the
    // reputation pair reads together), ahead of the contact anchors.
    expect(out.slice(0, 8)).toEqual([
      "biz",
      "match",
      "pains",
      "reviews",
      "rating",
      "website",
      "phones",
      "emails",
    ]);
    expect(out.slice(-4)).toEqual([
      "cov",
      "status",
      "touch",
      "lastContactedAt",
    ]);
  });

  test("whole clusters move — members stay adjacent", () => {
    const out = keys(orderColumnsForGoal(["contacts"]));
    // contacts_tech's span extras (builtOn · bookingTool · socials · reachable)
    // move to the front of the span AS ONE RUN.
    const spanStart = out.indexOf("emails") + 1;
    expect(out.slice(spanStart, spanStart + 4)).toEqual([
      "builtOn",
      "bookingTool",
      "socials",
      "reachable",
    ]);
  });

  test("deterministic — same goal, same order, same registry entries", () => {
    const a = orderColumnsForGoal(["reviews", "lighthouse"]);
    const b = orderColumnsForGoal(["reviews", "lighthouse"]);
    expect(keys(a)).toEqual(keys(b));
    // A permutation of the registry — nothing added or dropped.
    expect([...keys(a)].sort()).toEqual(COLUMNS.map((c) => c.key).sort());
  });
});

// ── Compact relative date (Last contacted) ───────────────────────────────────
describe("fmtRelativeShort", () => {
  const NOW = Date.parse("2026-07-06T12:00:00.000Z");
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

  test("null now (SSR pass) → the deterministic absolute form", () => {
    expect(fmtRelativeShort("2026-01-05T00:00:00.000Z", null)).toBe("Jan 5");
    expect(fmtRelativeShort("2026-01-05T00:00:00.000Z")).toBe("Jan 5");
  });

  test("same day → today; < 7 days → Nd; ≤ 30 days → Nw", () => {
    expect(fmtRelativeShort(daysAgo(0), NOW)).toBe("today");
    expect(fmtRelativeShort(daysAgo(3), NOW)).toBe("3d");
    expect(fmtRelativeShort(daysAgo(14), NOW)).toBe("2w");
    expect(fmtRelativeShort(daysAgo(30), NOW)).toBe("4w");
  });

  test("beyond 30 days → the absolute month-day", () => {
    expect(fmtRelativeShort("2026-01-05T00:00:00.000Z", NOW)).toBe("Jan 5");
  });

  test("malformed input → em dash", () => {
    expect(fmtRelativeShort("not-a-date", NOW)).toBe("—");
  });
});
