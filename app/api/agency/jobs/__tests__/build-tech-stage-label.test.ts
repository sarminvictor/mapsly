// The Enriching checklist's "tech" row shares ONE display bucket for two
// distinct families that feed the same stage: the DOM/tech fingerprint (rides
// the CONTACTS fetch, no rows of its own) and the per-business Lighthouse audit
// (its own EnrichmentJob family). The label must name only what THIS run
// actually requested — never both by default — or a Lighthouse-only run (e.g.
// the default Website-redesign goal) falsely implies a tech/DOM scan happened.

import { describe, expect, test } from "vitest";

import { buildTechStageLabel } from "../stage-label";

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
