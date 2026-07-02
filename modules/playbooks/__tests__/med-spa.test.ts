// Phase 7 · the med-spa playbook composes the shared HIPAA + ADA detectors
// with a med-spa reputation detector, runs end-to-end through the driver, and
// every emitted explanation stays exposure-framed (no banned absolutes).

import { describe, expect, test } from "vitest";
import { runPlaybook } from "../driver";
import { assertExposurePhrasing } from "../copy-lint";
import { medSpaPlaybook } from "../definitions/med-spa";
import { playbookForCategory, playbookForBusiness } from "../registry";
import type { EvidenceBundle } from "../types";

function bundle(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    business: {
      id: "b1",
      slug: "glow-med-spa",
      categorySlugs: ["med-spa"],
      website: "https://glowmedspa.com",
      services: [{ name: "Botox" }, { name: "Filler" }],
    },
    tech: null,
    lighthouseAudits: null,
    reviews: [],
    ...over,
  };
}

describe("playbook registry", () => {
  test("resolves med-spa categories (case-insensitive)", () => {
    expect(playbookForCategory("Medical Spa")?.id).toBe("med-spa");
    expect(playbookForCategory("med-spa")?.id).toBe("med-spa");
    // "florist" is claimed by no playbook (plumber → roofing since WP6-11).
    expect(playbookForCategory("florist")).toBeNull();
    expect(playbookForBusiness(["florist", "med spa"])?.id).toBe("med-spa");
  });
});

describe("med-spa playbook · flagged business", () => {
  const ev = bundle({
    tech: [
      { name: "Meta Pixel", category: "PIXEL" },
      { name: "Calendly", category: "BOOKING" },
    ],
    lighthouseAudits: {
      "color-contrast": { score: 0, failingNodes: 14 },
      "image-alt": { score: 0, failingNodes: 9 },
      label: { score: 0, failingNodes: 5 },
    },
    reviews: [
      {
        text: "They botched my filler and refused a refund",
        stars: 1,
        postedAt: new Date("2026-05-01"),
      },
      {
        text: "Got a burn from the laser, terrible",
        stars: 1,
        postedAt: new Date("2026-04-15"),
      },
      {
        text: "Infection after my treatment, avoid",
        stars: 1,
        postedAt: new Date("2026-03-20"),
      },
      {
        text: "Lovely staff, great results",
        stars: 5,
        postedAt: new Date("2026-02-01"),
      },
    ],
  });

  test("all three detectors fire with evidence + exposure phrasing", () => {
    const results = runPlaybook(medSpaPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));

    // Every signal in the playbook produced a verdict (not "not checked").
    for (const r of results) {
      expect(r.verdict, r.signalKey).not.toBeNull();
      expect(r.verdict!.evidence.length, r.signalKey).toBeGreaterThan(0);
      // Exposure-framed — no banned absolutes.
      expect(() =>
        assertExposurePhrasing(r.verdict!.explanation),
      ).not.toThrow();
    }

    // HIPAA: pixel + booking present → flagged (high or medium confidence).
    const hipaa =
      byKey["hipaa.tracking_pixel_on_phi_page"] ??
      results.find((r) => r.signalKey.includes("hipaa"));
    expect(hipaa?.verdict).not.toBeNull();

    // Review complaint cluster: 3 serious complaints.
    expect(byKey["medspa.review_complaint_cluster"].verdict!.value).toBe(3);
  });
});

describe("med-spa playbook · clean business", () => {
  const ev = bundle({
    tech: [{ name: "GoDaddy Website Builder", category: "CMS" }],
    lighthouseAudits: {
      "color-contrast": { score: 1 },
      "image-alt": { score: 1 },
    },
    reviews: [
      {
        text: "Wonderful experience, highly recommend",
        stars: 5,
        postedAt: new Date("2026-05-01"),
      },
    ],
  });

  test("nothing flagged → null verdicts with a not-checked reason", () => {
    const results = runPlaybook(medSpaPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });
});
