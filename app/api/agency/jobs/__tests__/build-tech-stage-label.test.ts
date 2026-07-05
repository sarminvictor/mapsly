// The Enriching checklist's "tech" row shares ONE display bucket for two
// distinct families that feed the same stage: the DOM/tech fingerprint (rides
// the CONTACTS fetch, no rows of its own) and the per-business Lighthouse audit
// (its own EnrichmentJob family). The label must name only what THIS run
// actually requested — never both by default — or a Lighthouse-only run (e.g.
// the default Website-redesign goal) falsely implies a tech/DOM scan happened.

import { describe, expect, test } from "vitest";

import { buildTechStageLabel, STAGE_DEFS } from "../stage-label";

describe("buildTechStageLabel", () => {
  test("Lighthouse only → names only Lighthouse", () => {
    expect(buildTechStageLabel(false, true)).toBe("Site speed (Lighthouse)");
  });

  test("tech only → names only tech, never Lighthouse", () => {
    expect(buildTechStageLabel(true, false)).toBe("Website & tech signals");
  });

  test("both requested → the combined label", () => {
    expect(buildTechStageLabel(true, true)).toBe(
      "Website & tech signals + Lighthouse",
    );
  });
});

// C4 · the Enriching checklist must be HONEST at the source: "Draft first
// touches" is a separate Touchpoints action, never an enrichment stage, so it
// must never appear in the candidate stage list buildEnrichStages emits from.
describe("STAGE_DEFS (enriching checklist honesty)", () => {
  test('never includes a "touches" / "Draft first touches" stage', () => {
    expect(STAGE_DEFS.some((s) => s.key === "touches")).toBe(false);
    expect(STAGE_DEFS.some((s) => /draft first touches/i.test(s.label))).toBe(
      false,
    );
  });

  test("the discovery step is labelled as the free find-businesses step", () => {
    const mapped = STAGE_DEFS.find((s) => s.key === "mapped");
    expect(mapped).toBeDefined();
    // Reads as the free step, not a paid research the user was charged for.
    expect(mapped!.label).toBe("Find businesses · free");
    expect(mapped!.label.toLowerCase()).toContain("free");
  });

  test("only the real enrichment stages are candidates (no overclaim keys)", () => {
    expect(STAGE_DEFS.map((s) => s.key)).toEqual([
      "mapped",
      "contacts",
      "tech",
      "reviews",
      "expert",
    ]);
  });
});
