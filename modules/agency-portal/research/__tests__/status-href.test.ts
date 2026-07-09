// Pure research-lifecycle logic: status derivation + the "Open" deep-link that
// resumes the flow at the right step (or the workbench when enriched). These
// lock the routing invariants a returning user depends on.

import { describe, expect, test } from "vitest";

import {
  buildResearchHref,
  deriveResearchStatus,
  type EnrichInfo,
  type ResearchHrefInput,
} from "../status";

const NONE: EnrichInfo = { phase: "none" };

describe("deriveResearchStatus", () => {
  test("done enrichment → enriched (regardless of discovery status)", () => {
    expect(deriveResearchStatus("READY", { phase: "done" })).toBe("enriched");
    expect(deriveResearchStatus("PARTIAL", { phase: "done" })).toBe("enriched");
  });

  // WP4-2 · a completed-but-PARTIAL enrichment (some leads couldn't finish) is
  // its own status (amber pill) — but still routes to the workbench.
  test("done + partial enrichment → partial", () => {
    expect(
      deriveResearchStatus("READY", { phase: "done", partial: true }),
    ).toBe("partial");
    expect(
      deriveResearchStatus("READY", { phase: "done", partial: false }),
    ).toBe("enriched");
  });

  test("active enrichment → enriching", () => {
    expect(
      deriveResearchStatus("READY", { phase: "active", activeRunId: "r1" }),
    ).toBe("enriching");
  });

  // FT-2 · a delivered "Search everywhere" (OK run, scopeKind "search") is its
  // own status and wins over the generic "done → enriched" mapping.
  test("delivered search → delivered (beats done→enriched)", () => {
    expect(
      deriveResearchStatus("READY", { phase: "done", delivered: true }),
    ).toBe("delivered");
  });

  test("mapped + no enrichment → discovered", () => {
    expect(deriveResearchStatus("READY", NONE)).toBe("discovered");
    expect(deriveResearchStatus("PARTIAL", NONE)).toBe("discovered");
  });

  test("still mapping / failed + no enrichment → draft", () => {
    expect(deriveResearchStatus("PENDING", NONE)).toBe("draft");
    expect(deriveResearchStatus("RUNNING", NONE)).toBe("draft");
    expect(deriveResearchStatus("FAILED", NONE)).toBe("draft");
  });
});

describe("buildResearchHref", () => {
  const catMap = new Map([["dental_clinic", "cat_abc"]]);
  const base: ResearchHrefInput = {
    id: "disc_1",
    status: "READY",
    cellKeys: ["dental_clinic|calgary|CA"],
    signalsJson: {
      signals: [{ key: "overdue_redesign" }],
      goalName: "Website redesign",
      goalBase: "website",
    },
    totalBusinesses: 731,
  };

  test("enriched → the workbench (no flow resume)", () => {
    expect(buildResearchHref(base, "enriched", { phase: "done" }, catMap)).toBe(
      "/discover/disc_1",
    );
  });

  // WP4-2 · partial also opens the workbench (there ARE leads to work).
  test("partial → the workbench (no flow resume)", () => {
    expect(
      buildResearchHref(
        base,
        "partial",
        { phase: "done", partial: true },
        catMap,
      ),
    ).toBe("/discover/disc_1");
  });

  // FT-2 · a delivered search opens its leads LIST directly (it never enriched).
  test("delivered → the leads list (falls back to workbench if no listId)", () => {
    expect(
      buildResearchHref(
        base,
        "delivered",
        { phase: "done", delivered: true, listId: "list_7" },
        catMap,
      ),
    ).toBe("/discover/disc_1/lists/list_7");
    expect(
      buildResearchHref(
        base,
        "delivered",
        { phase: "done", delivered: true },
        catMap,
      ),
    ).toBe("/discover/disc_1");
  });

  test("discovered → resume at Preview with d + goal + cells", () => {
    const href = buildResearchHref(base, "discovered", NONE, catMap);
    const url = new URL(href, "https://x.test");
    expect(url.pathname).toBe("/discover");
    expect(url.searchParams.get("step")).toBe("preview");
    expect(url.searchParams.get("d")).toBe("disc_1");
    expect(url.searchParams.get("cells")).toBe("calgary:cat_abc");
    expect(url.searchParams.get("g")).toBeTruthy(); // reconstructed goal
  });

  test("draft → resume at Preview WITHOUT d (re-maps idempotently)", () => {
    const href = buildResearchHref(
      { ...base, status: "PENDING" },
      "draft",
      NONE,
      catMap,
    );
    const url = new URL(href, "https://x.test");
    expect(url.searchParams.get("step")).toBe("preview");
    expect(url.searchParams.get("d")).toBeNull();
    expect(url.searchParams.get("cells")).toBe("calgary:cat_abc");
  });

  test("enriching → the Enriching step with run + n", () => {
    const href = buildResearchHref(
      base,
      "enriching",
      { phase: "active", activeRunId: "run_9", activeUnits: 613 },
      catMap,
    );
    const url = new URL(href, "https://x.test");
    expect(url.searchParams.get("step")).toBe("enriching");
    expect(url.searchParams.get("d")).toBe("disc_1");
    expect(url.searchParams.get("run")).toBe("run_9");
    expect(url.searchParams.get("n")).toBe("613");
  });

  test("a cell whose category no longer resolves is dropped from cells", () => {
    const href = buildResearchHref(
      { ...base, cellKeys: ["gone_slug|miami|US", "dental_clinic|calgary|CA"] },
      "discovered",
      NONE,
      catMap,
    );
    const url = new URL(href, "https://x.test");
    // Only the resolvable cell survives.
    expect(url.searchParams.get("cells")).toBe("calgary:cat_abc");
  });
});
