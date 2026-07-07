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
  painGroupClass,
  passesFilters,
  reachabilityLabel,
  rowToCsvRecord,
  seedSignalFilters,
  sortRows,
  toneForPercentile,
  topCsvSignals,
  type LeadFilter,
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
      "Lighthouse < 50",
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

describe("availableSignalKeys (#2 · strict all-rows gating)", () => {
  const signals = [
    { key: "sig_a", title: "A" },
    { key: "sig_b", title: "B" },
    { key: "sig_c", title: "C" },
  ];

  test("a signal is available only when EVERY row has a verdict", () => {
    const rows = [
      row({ perSignal: { sig_a: true, sig_b: false } }),
      row({ perSignal: { sig_a: false, sig_b: null } }),
      // sig_c present on neither row.
    ];
    const avail = availableSignalKeys(rows, signals);
    expect(avail.has("sig_a")).toBe(true); // non-null on both rows
    expect(avail.has("sig_b")).toBe(false); // null on row 2 → hidden until enriched
    expect(avail.has("sig_c")).toBe(false); // never present
  });

  test("a single not-yet-computed lead hides the signal (honest gating)", () => {
    const rows = [
      row({ perSignal: { sig_a: true } }),
      row({ perSignal: { sig_a: true } }),
      row({ perSignal: {} }), // an absent/pruned key reads as no-data → hides it
    ];
    expect(availableSignalKeys(rows, signals).has("sig_a")).toBe(false);
  });

  test("all rows enriched → available (true AND false verdicts both count)", () => {
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

  test("empty when nothing has enriched yet (never hides un-enriched leads)", () => {
    const rows = [row({ perSignal: { sig_a: null, sig_b: null } })];
    expect(seedSignalFilters(rows, goalSignals)).toEqual([]);
  });

  test("empty when the goal carries no signals", () => {
    expect(seedSignalFilters([row()], [])).toEqual([]);
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
    expect(out.slice(0, 7)).toEqual([
      "biz",
      "match",
      "pains",
      "reviews",
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
