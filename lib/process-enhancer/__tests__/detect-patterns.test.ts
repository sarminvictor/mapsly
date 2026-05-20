/**
 * detect-patterns · invariant tests for the process-enhancer pure detector.
 *
 * Per `.claude/rules/testing.md` § "Signal scoring + computed metrics": the
 * detector is pure logic shipping behavior the dashboard depends on (signals
 * render as auto-enhance cards). Wrong cluster threshold = the dashboard
 * over-alerts or never alerts; both erode the meta-loop's value.
 *
 * H.6 validation gate: the dry-run script EXITS 1 if 0 signals are returned
 * on the current incidents.md. These tests pin the contract so a future
 * regression (e.g. someone bumps CLUSTER_THRESHOLD to 5 by accident) is
 * caught before the script silently starts failing CI.
 */

import { describe, expect, test } from "vitest";

import {
  CLUSTER_THRESHOLD,
  RECURRENCE_THRESHOLD,
  detectPatterns,
  mergeSignals,
  parseBuildLogCitations,
  parseIncidents,
  type EnhanceSignal,
  type IncidentEntry,
} from "../detect-patterns";

const FIXED_NOW = new Date("2026-05-20T12:00:00.000Z");
const ctx = { now: () => FIXED_NOW };

// ─────────────────────────────────────────────────────────────────────────────
// parseIncidents
// ─────────────────────────────────────────────────────────────────────────────

describe("parseIncidents", () => {
  test("extracts INC- id + tags from canonical entry block", () => {
    const md = `
# Incidents

### INC-2026-05-19-01 · sandbox stuff

**Symptom:** something
**Tags:** sandbox, git, filesystem-permissions

### INC-2026-05-19-02 · prisma stuff

**Tags:** prisma, prisma-7
`;
    const got = parseIncidents(md);
    expect(got).toHaveLength(2);
    expect(got[0]?.id).toBe("INC-2026-05-19-01");
    expect(got[0]?.tags).toEqual(["sandbox", "git", "filesystem-permissions"]);
    expect(got[1]?.id).toBe("INC-2026-05-19-02");
    expect(got[1]?.tags).toEqual(["prisma", "prisma-7"]);
  });

  test("skips blocks without an INC- header", () => {
    const md = `# Title only\n\n## Subsection\n\nSome prose.`;
    expect(parseIncidents(md)).toEqual([]);
  });

  test("entries missing Tags line parse with empty tags array", () => {
    const md = `### INC-2026-05-19-03 · no-tags entry\n\nbody only\n`;
    const got = parseIncidents(md);
    expect(got).toHaveLength(1);
    expect(got[0]?.tags).toEqual([]);
  });

  test("handles real-world incidents.md with 30+ entries (no throws)", () => {
    // synth realistic shape — confirms regex resilience across many entries
    const blocks: string[] = [];
    for (let i = 1; i <= 31; i++) {
      const id = `INC-2026-05-${i < 20 ? "19" : "20"}-${String(i).padStart(2, "0")}`;
      blocks.push(`### ${id} · synthetic\n\n**Tags:** tag${i % 5}, common\n`);
    }
    const got = parseIncidents(blocks.join("\n"));
    expect(got.length).toBe(31);
    expect(got.every((e) => e.tags.includes("common"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseBuildLogCitations
// ─────────────────────────────────────────────────────────────────────────────

describe("parseBuildLogCitations", () => {
  test("counts each INC- occurrence", () => {
    const text =
      "Cited INC-2026-05-19-14 here. And INC-2026-05-19-14 again. And INC-2026-05-19-02.";
    const got = parseBuildLogCitations(text);
    expect(got.total).toBe(3);
    expect(got.citationCount.get("INC-2026-05-19-14")).toBe(2);
    expect(got.citationCount.get("INC-2026-05-19-02")).toBe(1);
  });

  test("empty text returns zero counts", () => {
    expect(parseBuildLogCitations("").total).toBe(0);
  });

  test("ignores malformed near-matches", () => {
    const text = "INC-26-05-19-01 missing year digits. INC-2026-05-19-01 ok.";
    const got = parseBuildLogCitations(text);
    expect(got.total).toBe(1);
    expect(got.citationCount.get("INC-2026-05-19-01")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectPatterns
// ─────────────────────────────────────────────────────────────────────────────

describe("detectPatterns", () => {
  test("returns no signals when nothing crosses a threshold", () => {
    const incidents = [
      { id: "INC-2026-05-19-01", tags: ["a"], body: "" },
      { id: "INC-2026-05-19-02", tags: ["a", "b"], body: "" },
      // tag "a" count = 2 (< CLUSTER_THRESHOLD=3)
    ];
    const buildLog = {
      citationCount: new Map([["INC-2026-05-19-01", 2]]), // < RECURRENCE
      total: 2,
    };
    const signals = detectPatterns(incidents, buildLog, ctx);
    expect(signals).toEqual([]);
  });

  test("emits a recurrence signal at exactly RECURRENCE_THRESHOLD", () => {
    const buildLog = {
      citationCount: new Map([["INC-2026-05-19-14", RECURRENCE_THRESHOLD]]),
      total: RECURRENCE_THRESHOLD,
    };
    const signals = detectPatterns([], buildLog, ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.category).toBe("incident-recurrence");
    expect(signals[0]?.severity).toBe("warn");
    expect(signals[0]?.id).toBe("ENH.2026-05-20.recurring-INC-2026-05-19-14");
    expect(signals[0]?.headline).toContain("3 times");
  });

  test("emits a cluster signal at exactly CLUSTER_THRESHOLD", () => {
    const incidents = Array.from({ length: CLUSTER_THRESHOLD }, (_, i) => ({
      id: `INC-2026-05-19-${String(i + 1).padStart(2, "0")}`,
      tags: ["prisma"],
      body: "",
    }));
    const signals = detectPatterns(
      incidents,
      { citationCount: new Map(), total: 0 },
      ctx,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]?.category).toBe("incident-cluster");
    expect(signals[0]?.severity).toBe("info");
    expect(signals[0]?.id).toBe("ENH.2026-05-20.tag-prisma");
    expect(signals[0]?.headline).toContain("3 incidents");
    expect(signals[0]?.headline).toContain("prisma");
  });

  test("cluster signals are sorted by frequency desc, then alpha", () => {
    const incidents = [
      // tag "z" appears 3, "a" appears 4, "m" appears 3
      ...Array(4)
        .fill(null)
        .map((_, i) => ({
          id: `INC-A-${i}`,
          tags: ["a"],
          body: "",
        })),
      ...Array(3)
        .fill(null)
        .map((_, i) => ({
          id: `INC-M-${i}`,
          tags: ["m"],
          body: "",
        })),
      ...Array(3)
        .fill(null)
        .map((_, i) => ({
          id: `INC-Z-${i}`,
          tags: ["z"],
          body: "",
        })),
    ];
    const signals = detectPatterns(
      incidents,
      { citationCount: new Map(), total: 0 },
      ctx,
    );
    expect(signals.map((s) => s.id)).toEqual([
      "ENH.2026-05-20.tag-a", // 4
      "ENH.2026-05-20.tag-m", // 3, alpha before z
      "ENH.2026-05-20.tag-z", // 3
    ]);
  });

  test("deterministic timestamps via ctx.now override", () => {
    const buildLog = {
      citationCount: new Map([["INC-2026-05-19-14", 5]]),
      total: 5,
    };
    const a = detectPatterns([], buildLog, ctx);
    const b = detectPatterns([], buildLog, ctx);
    expect(a).toEqual(b);
    expect(a[0]?.detected).toBe(FIXED_NOW.toISOString());
  });

  test("H.6 acceptance · realistic incidents shape produces ≥1 signal", () => {
    // Simulate the actual shape: ≥3 incidents tagged "prisma" exists in
    // the real file today (9). Any healthy state of the repo should keep
    // producing at least one cluster signal — if this fails, the detector
    // has drifted from .claude/memory/incidents.md.
    const incidents = [
      { id: "INC-2026-05-19-02", tags: ["prisma", "prisma-7"], body: "" },
      { id: "INC-2026-05-19-03", tags: ["prisma", "adapter-neon"], body: "" },
      {
        id: "INC-2026-05-19-06",
        tags: ["prisma", "vercel", "build"],
        body: "",
      },
      {
        id: "INC-2026-05-19-07",
        tags: ["vercel", "env-vars", "prisma"],
        body: "",
      },
    ];
    const signals = detectPatterns(
      incidents,
      { citationCount: new Map(), total: 0 },
      ctx,
    );
    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals.some((s) => s.id.includes("tag-prisma"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPERSEDED INC suppression (v0.6.27)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectPatterns · ♻️ SUPERSEDED INCs", () => {
  test("does NOT emit incident-recurrence for a SUPERSEDED INC", () => {
    const signals = detectPatterns(
      [
        {
          id: "INC-2026-05-19-14",
          tags: ["sandbox", "fuse"],
          status: "♻️ SUPERSEDED BY INC-31 — Loop runs from /tmp.",
          body: "",
        },
      ],
      {
        citationCount: new Map([["INC-2026-05-19-14", 5]]),
        total: 5,
      },
      ctx,
    );
    expect(
      signals.filter((s) => s.category === "incident-recurrence"),
    ).toHaveLength(0);
  });

  test("DOES emit incident-recurrence for an active (non-superseded) INC", () => {
    const signals = detectPatterns(
      [
        {
          id: "INC-2026-05-20-32",
          tags: ["prisma"],
          status: "✅ FIXED + ENCODED",
          body: "",
        },
      ],
      {
        citationCount: new Map([["INC-2026-05-20-32", 5]]),
        total: 5,
      },
      ctx,
    );
    expect(
      signals.some((s) => s.id.includes("recurring-INC-2026-05-20-32")),
    ).toBe(true);
  });

  test("treats missing status as active (signal fires)", () => {
    const signals = detectPatterns(
      [
        // Pre-v0.6.25 INC with no Status line
        { id: "INC-2026-05-19-01", tags: ["sandbox"], body: "" },
      ],
      {
        citationCount: new Map([["INC-2026-05-19-01", 4]]),
        total: 4,
      },
      ctx,
    );
    expect(
      signals.some((s) => s.id.includes("recurring-INC-2026-05-19-01")),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TAG_TO_RULE coverage suppression (v0.6.27)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectPatterns · TAG_TO_RULE coverage", () => {
  const threeIncidents = (tag: string): IncidentEntry[] => [
    { id: "INC-2026-05-19-01", tags: [tag], body: "" },
    { id: "INC-2026-05-19-02", tags: [tag], body: "" },
    { id: "INC-2026-05-19-03", tags: [tag], body: "" },
  ];

  test("silences incident-cluster signal when TAG_TO_RULE rule exists", () => {
    const signals = detectPatterns(
      threeIncidents("prisma"),
      { citationCount: new Map(), total: 0 },
      { ...ctx, ruleExists: (rel) => rel === "prisma.md" },
    );
    expect(signals.some((s) => s.id.includes("tag-prisma"))).toBe(false);
  });

  test("emits incident-cluster signal when rule file missing", () => {
    const signals = detectPatterns(
      threeIncidents("prisma"),
      { citationCount: new Map(), total: 0 },
      { ...ctx, ruleExists: () => false },
    );
    expect(signals.some((s) => s.id.includes("tag-prisma"))).toBe(true);
  });

  test("emits incident-cluster signal for an unknown tag (not in TAG_TO_RULE map)", () => {
    const signals = detectPatterns(
      threeIncidents("brand-new-domain"),
      { citationCount: new Map(), total: 0 },
      { ...ctx, ruleExists: () => true /* irrelevant, tag not mapped */ },
    );
    expect(signals.some((s) => s.id.includes("tag-brand-new-domain"))).toBe(
      true,
    );
  });

  test("TAG_TO_RULE silences multiple tags pointing to same rule", () => {
    const signals = detectPatterns(
      [
        { id: "INC-A", tags: ["cacheComponents"], body: "" },
        { id: "INC-B", tags: ["cacheComponents"], body: "" },
        { id: "INC-C", tags: ["cacheComponents"], body: "" },
        { id: "INC-D", tags: ["cache-components"], body: "" },
        { id: "INC-E", tags: ["cache-components"], body: "" },
        { id: "INC-F", tags: ["cache-components"], body: "" },
      ],
      { citationCount: new Map(), total: 0 },
      { ...ctx, ruleExists: (rel) => rel === "cache-components.md" },
    );
    expect(signals.some((s) => s.headline.includes("cacheComponents"))).toBe(
      false,
    );
    expect(signals.some((s) => s.headline.includes("cache-components"))).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeSignals
// ─────────────────────────────────────────────────────────────────────────────

describe("mergeSignals", () => {
  const base = (id: string): EnhanceSignal => ({
    id,
    category: "incident-cluster",
    detected: FIXED_NOW.toISOString(),
    severity: "info",
    headline: id,
    evidence: "—",
    action: "—",
  });

  test("idempotent · same fresh signal replaces existing with same id", () => {
    const existing = [base("ENH.A"), base("ENH.B")];
    const fresh = [{ ...base("ENH.A"), headline: "updated" }];
    const merged = mergeSignals(existing, fresh);
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.id === "ENH.A")?.headline).toBe("updated");
    expect(merged.find((s) => s.id === "ENH.B")?.headline).toBe("ENH.B");
  });

  test("preserves prDrafted/prUrl on stale signals not re-detected", () => {
    const existing: EnhanceSignal[] = [
      {
        ...base("ENH.A"),
        prDrafted: true,
        prUrl: "https://github.com/sarminvictor/mapsly/pull/42",
      },
    ];
    const merged = mergeSignals(existing, [base("ENH.B")]);
    expect(merged.find((s) => s.id === "ENH.A")?.prDrafted).toBe(true);
    expect(merged.find((s) => s.id === "ENH.A")?.prUrl).toContain("/pull/42");
  });

  test("empty fresh keeps existing untouched", () => {
    const existing = [base("ENH.A"), base("ENH.B")];
    expect(mergeSignals(existing, [])).toEqual(existing);
  });
});
