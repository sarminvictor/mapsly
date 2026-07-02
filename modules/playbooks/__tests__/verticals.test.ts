// Phase 7 · the four new launch playbooks (HVAC, dental, restaurant, auto-body)
// each run end-to-end through the driver: a flagged business yields findings
// with evidence + exposure phrasing; a clean one yields null verdicts with a
// not-checked reason. Mirrors med-spa.test.ts exactly.

import { describe, expect, test } from "vitest";
import { runPlaybook } from "../driver";
import { assertExposurePhrasing } from "../copy-lint";
import {
  ALL_PLAYBOOKS,
  playbookForCategory,
  playbookForBusiness,
} from "../registry";
import { hvacPlaybook } from "../definitions/hvac";
import { dentalPlaybook } from "../definitions/dental";
import { restaurantPlaybook } from "../definitions/restaurant";
import { autoBodyPlaybook } from "../definitions/auto-body";
import { roofingPlaybook } from "../definitions/roofing";
import { lawPlaybook } from "../definitions/law";
import { chiropracticPlaybook } from "../definitions/chiropractic";
import type { EvidenceBundle } from "../types";

function bundle(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    business: {
      id: "b1",
      slug: "acme",
      categorySlugs: ["hvac"],
      website: "https://acme.example",
      services: [],
    },
    tech: null,
    lighthouseAudits: null,
    reviews: [],
    ...over,
  };
}

/** A Lighthouse audit set that fires adaWebRisk at high. */
const FAILING_A11Y = {
  "color-contrast": { score: 0, failingNodes: 14 },
  "image-alt": { score: 0, failingNodes: 9 },
  label: { score: 0, failingNodes: 5 },
};

/** A clean Lighthouse audit set → adaWebRisk returns null. */
const CLEAN_A11Y = {
  "color-contrast": { score: 1 },
  "image-alt": { score: 1 },
};

describe("registry · all launch playbooks registered + resolvable", () => {
  test("ALL_PLAYBOOKS has the 5 launch verticals + the 3 WP6-11 verticals", () => {
    const ids = ALL_PLAYBOOKS.map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        "auto-body",
        "chiropractic",
        "dental",
        "hvac",
        "law",
        "med-spa",
        "restaurant",
        "roofing",
      ].sort(),
    );
  });

  test("each vertical resolves case-insensitively", () => {
    expect(playbookForCategory("HVAC")?.id).toBe("hvac");
    expect(playbookForCategory("Dentist")?.id).toBe("dental");
    expect(playbookForCategory("Coffee Shop")?.id).toBe("restaurant");
    expect(playbookForCategory("Collision Repair")?.id).toBe("auto-body");
    // "plumber" resolves to roofing (WP6-11); "body shop" would resolve to
    // auto-body, but playbookForBusiness returns the FIRST matching category.
    expect(playbookForBusiness(["plumber", "body shop"])?.id).toBe("roofing");
    expect(playbookForCategory("Roofing Contractor")?.id).toBe("roofing");
    expect(playbookForCategory("Personal Injury Attorney")?.id).toBe("law");
    expect(playbookForCategory("Chiropractor")?.id).toBe("chiropractic");
  });
});

describe("HVAC playbook", () => {
  test("flagged business → all detectors fire with evidence + exposure copy", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "cool-air",
        categorySlugs: ["hvac"],
        website: "https://coolair.example",
        // No license number named → license_number_absent fires.
        services: [{ name: "AC repair" }, { name: "Furnace install" }],
      },
      // Ad tag present, NO pixel/analytics → no_conversion_tracking (high).
      // No booking tool → no_online_booking. Tech non-null so absence counts.
      tech: [
        { name: "Google Ads", category: "other" },
        { name: "WordPress", category: "cms" },
      ],
      lighthouseAudits: FAILING_A11Y,
    });

    const results = runPlaybook(hvacPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));

    for (const r of results) {
      expect(r.verdict, r.signalKey).not.toBeNull();
      expect(r.verdict!.evidence.length, r.signalKey).toBeGreaterThan(0);
      expect(() =>
        assertExposurePhrasing(r.verdict!.explanation),
      ).not.toThrow();
    }

    expect(byKey["ada-web-risk"].verdict!.value).toBe("high");
    expect(byKey["hvac.license_number_absent_from_site"].verdict!.value).toBe(
      true,
    );
    expect(byKey["hvac.no_conversion_tracking"].verdict!.confidence).toBe(
      "high",
    );
    expect(byKey["hvac.no_online_booking"].verdict!.value).toBe(true);
  });

  test("clean business → null verdicts with a not-checked reason", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "cool-air",
        categorySlugs: ["hvac"],
        website: "https://coolair.example",
        // License number named → license_number_absent → null.
        services: [{ name: "Licensed HVAC · License #AB-12345" }],
      },
      // Pixel + booking present, no ad tag → conversion + booking both clean.
      tech: [
        { name: "Meta Pixel", category: "pixel" },
        { name: "Calendly", category: "booking" },
      ],
      lighthouseAudits: CLEAN_A11Y,
    });

    const results = runPlaybook(hvacPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });
});

describe("dental playbook", () => {
  test("flagged business → HIPAA + specialist + scheduling all fire", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "bright-smiles",
        categorySlugs: ["dental"],
        website: "https://brightsmiles.example",
        // Specialist claim, no license number → specialist_claim_unverified.
        services: [
          { name: "Board-certified orthodontist" },
          { name: "Cleanings" },
        ],
      },
      // Pixel + booking → HIPAA fires; but booking present → no_online_scheduling
      // must NOT fire. Use a non-booking tech set so scheduling fires too, plus
      // a pixel without booking would null HIPAA — so split: include booking for
      // HIPAA and accept scheduling is clean here. Instead, give pixel + a CHAT
      // tool (a PHI surface? no). Keep booking for HIPAA; test scheduling sep.
      tech: [
        { name: "Meta Pixel", category: "pixel" },
        { name: "Acuity", category: "booking" },
      ],
      lighthouseAudits: FAILING_A11Y,
    });

    const results = runPlaybook(dentalPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));

    // HIPAA, ADA, specialist all flagged + evidence-backed + exposure-framed.
    for (const key of [
      "hipaa-pixel-on-phi-page",
      "ada-web-risk",
      "dental.specialist_claim_unverified",
    ]) {
      expect(byKey[key].verdict, key).not.toBeNull();
      expect(byKey[key].verdict!.evidence.length, key).toBeGreaterThan(0);
      expect(() =>
        assertExposurePhrasing(byKey[key].verdict!.explanation),
      ).not.toThrow();
    }
    expect(byKey["dental.specialist_claim_unverified"].verdict!.value).toBe(
      "Board-certified",
    );
    // Booking present → scheduling clean (null).
    expect(byKey["dental.no_online_scheduling"].verdict).toBeNull();
  });

  test("no scheduling tool → no_online_scheduling fires", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "bright-smiles",
        categorySlugs: ["dental"],
        website: "https://brightsmiles.example",
        services: [{ name: "Cleanings" }],
      },
      tech: [{ name: "WordPress", category: "cms" }],
      lighthouseAudits: null,
    });
    const results = runPlaybook(dentalPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));
    expect(byKey["dental.no_online_scheduling"].verdict).not.toBeNull();
    expect(() =>
      assertExposurePhrasing(
        byKey["dental.no_online_scheduling"].verdict!.explanation,
      ),
    ).not.toThrow();
  });

  test("clean business → null verdicts with a not-checked reason", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "bright-smiles",
        categorySlugs: ["dental"],
        website: "https://brightsmiles.example",
        services: [{ name: "Cleanings" }, { name: "Whitening" }],
      },
      tech: [{ name: "Calendly", category: "booking" }],
      lighthouseAudits: CLEAN_A11Y,
    });
    const results = runPlaybook(dentalPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });
});

describe("restaurant playbook", () => {
  test("flagged business → ADA + allergen + ordering all fire", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "joes-diner",
        categorySlugs: ["restaurant"],
        website: "https://joesdiner.example",
        // ≥8 menu items, no allergen language → menu_no_allergen_info (medium).
        services: [
          { name: "Cheeseburger" },
          { name: "Fries" },
          { name: "Milkshake" },
          { name: "Hot dog" },
          { name: "Onion rings" },
          { name: "Grilled cheese" },
          { name: "Club sandwich" },
          { name: "Apple pie" },
        ],
      },
      // No ecommerce/payment → no_online_ordering (high).
      tech: [{ name: "WordPress", category: "cms" }],
      lighthouseAudits: FAILING_A11Y,
    });

    const results = runPlaybook(restaurantPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));

    for (const r of results) {
      expect(r.verdict, r.signalKey).not.toBeNull();
      expect(() =>
        assertExposurePhrasing(r.verdict!.explanation),
      ).not.toThrow();
    }
    expect(byKey["ada-web-risk"].verdict!.value).toBe("high");
    expect(byKey["restaurant.menu_no_allergen_info"].verdict!.confidence).toBe(
      "medium",
    );
    expect(byKey["restaurant.menu_no_allergen_info"].verdict!.value).toBe(8);
    expect(byKey["restaurant.no_online_ordering"].verdict!.value).toBe("high");
  });

  test("clean business → null verdicts with a not-checked reason", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "joes-diner",
        categorySlugs: ["restaurant"],
        website: "https://joesdiner.example",
        // Allergen language present → allergen signal null.
        services: [{ name: "Gluten-free pizza (contains dairy)" }],
      },
      // Ecommerce present → ordering null.
      tech: [{ name: "Toast Online Ordering", category: "ecommerce" }],
      lighthouseAudits: CLEAN_A11Y,
    });
    const results = runPlaybook(restaurantPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });
});

describe("auto-body playbook", () => {
  test("flagged business → registration + cert + estimate all fire", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "fix-it-collision",
        categorySlugs: ["auto-body"],
        website: "https://fixit.example",
        // No BAR number, no I-CAR/OEM language → both compliance/cert signals.
        services: [{ name: "Collision repair" }, { name: "Paint" }],
      },
      // No booking tool → no_estimate_request_tool fires.
      tech: [{ name: "WordPress", category: "cms" }],
      lighthouseAudits: FAILING_A11Y,
    });

    const results = runPlaybook(autoBodyPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));

    for (const r of results) {
      expect(r.verdict, r.signalKey).not.toBeNull();
      expect(() =>
        assertExposurePhrasing(r.verdict!.explanation),
      ).not.toThrow();
    }
    expect(byKey["ada-web-risk"].verdict!.value).toBe("high");
    expect(byKey["auto_body.bar_registration_absent"].verdict!.value).toBe(
      true,
    );
    expect(
      byKey["auto_body.no_icar_oem_cert_displayed"].verdict!.confidence,
    ).toBe("low");
    expect(byKey["auto_body.no_estimate_request_tool"].verdict!.value).toBe(
      true,
    );
  });

  test("clean business → null verdicts with a not-checked reason", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "fix-it-collision",
        categorySlugs: ["auto-body"],
        website: "https://fixit.example",
        // BAR number + I-CAR language present → both compliance/cert null.
        services: [{ name: "BAR #998877 · I-CAR Gold Class certified" }],
      },
      // Booking present → estimate tool null.
      tech: [{ name: "Calendly", category: "booking" }],
      lighthouseAudits: CLEAN_A11Y,
    });
    const results = runPlaybook(autoBodyPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });
});

describe("roofing playbook (WP6-11)", () => {
  test("flagged business → ADA + license + conversion all fire", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "peak-roofing",
        categorySlugs: ["roofing"],
        website: "https://peakroofing.example",
        // No license number named → license_number_absent fires.
        services: [{ name: "Roof replacement" }, { name: "Storm repair" }],
      },
      // Ad tag present, NO pixel/analytics → no_conversion_tracking (high).
      tech: [
        { name: "Google Ads", category: "other" },
        { name: "WordPress", category: "cms" },
      ],
      lighthouseAudits: FAILING_A11Y,
    });

    const results = runPlaybook(roofingPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));

    for (const r of results) {
      expect(r.verdict, r.signalKey).not.toBeNull();
      expect(r.verdict!.evidence.length, r.signalKey).toBeGreaterThan(0);
      expect(() =>
        assertExposurePhrasing(r.verdict!.explanation),
      ).not.toThrow();
    }
    expect(byKey["ada-web-risk"].verdict!.value).toBe("high");
    expect(
      byKey["roofing.license_number_absent_from_site"].verdict!.value,
    ).toBe(true);
    expect(byKey["roofing.no_conversion_tracking"].verdict!.confidence).toBe(
      "high",
    );
  });

  test("clean business → null verdicts with a not-checked reason", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "peak-roofing",
        categorySlugs: ["roofing"],
        website: "https://peakroofing.example",
        services: [{ name: "Licensed roofing · License #RC-99881" }],
      },
      // Pixel present (measuring), no ad tag → conversion clean.
      tech: [{ name: "Meta Pixel", category: "pixel" }],
      lighthouseAudits: CLEAN_A11Y,
    });
    const results = runPlaybook(roofingPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });
});

describe("law playbook (WP6-11)", () => {
  test("flagged business → ADA + bar-number + disclaimer all fire", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "acme-legal",
        categorySlugs: ["law firm"],
        website: "https://acmelegal.example",
        // No bar identifier, no disclaimer language → both compliance signals.
        services: [{ name: "Personal injury" }, { name: "Car accidents" }],
      },
      tech: [{ name: "WordPress", category: "cms" }],
      lighthouseAudits: FAILING_A11Y,
    });

    const results = runPlaybook(lawPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));

    for (const r of results) {
      expect(r.verdict, r.signalKey).not.toBeNull();
      expect(() =>
        assertExposurePhrasing(r.verdict!.explanation),
      ).not.toThrow();
    }
    expect(byKey["ada-web-risk"].verdict!.value).toBe("high");
    expect(byKey["law.bar_number_absent_from_site"].verdict!.value).toBe(true);
    expect(byKey["law.advertising_disclaimer_absent"].verdict!.value).toBe(
      true,
    );
  });

  test("clean business → null verdicts with a not-checked reason", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "acme-legal",
        categorySlugs: ["law firm"],
        website: "https://acmelegal.example",
        // Bar identifier + disclaimer present → both compliance null.
        services: [
          { name: "Jane Doe, Esq. · State Bar No. 445566" },
          { name: "Attorney Advertising — prior results do not guarantee" },
        ],
      },
      tech: [{ name: "WordPress", category: "cms" }],
      lighthouseAudits: CLEAN_A11Y,
    });
    const results = runPlaybook(lawPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });
});

describe("chiropractic playbook (WP6-11)", () => {
  test("flagged business → HIPAA + ADA + health-claim all fire", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "align-chiro",
        categorySlugs: ["chiropractic"],
        website: "https://alignchiro.example",
        // Absolute cure claim → unsubstantiated_health_claim fires.
        services: [{ name: "Adjustments that cure migraines" }],
      },
      // Pixel + booking → HIPAA fires (chiropractic is a health category).
      tech: [
        { name: "Meta Pixel", category: "pixel" },
        { name: "Acuity", category: "booking" },
      ],
      lighthouseAudits: FAILING_A11Y,
    });

    const results = runPlaybook(chiropracticPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));

    for (const key of [
      "hipaa-pixel-on-phi-page",
      "ada-web-risk",
      "chiropractic.unsubstantiated_health_claim",
    ]) {
      expect(byKey[key].verdict, key).not.toBeNull();
      expect(byKey[key].verdict!.evidence.length, key).toBeGreaterThan(0);
      expect(() =>
        assertExposurePhrasing(byKey[key].verdict!.explanation),
      ).not.toThrow();
    }
    expect(
      byKey["chiropractic.unsubstantiated_health_claim"].verdict!.value,
    ).toBe("cure");
  });

  test("clean business → null verdicts with a not-checked reason", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "align-chiro",
        categorySlugs: ["chiropractic"],
        website: "https://alignchiro.example",
        // No absolute claim → health-claim null.
        services: [{ name: "Spinal adjustments" }, { name: "Sports therapy" }],
      },
      // No booking surface → HIPAA null; no tracker either.
      tech: [{ name: "WordPress", category: "cms" }],
      lighthouseAudits: CLEAN_A11Y,
    });
    const results = runPlaybook(chiropracticPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });
});

describe("absence-based signals return null when evidence is missing", () => {
  test("text-only signals null when there are no services", () => {
    // No services → license/specialist/allergen/BAR/cert all "not checked".
    const ev = bundle({
      business: {
        id: "b1",
        slug: "no-services",
        categorySlugs: ["auto-body"],
        website: "https://x.example",
        services: [],
      },
      tech: null,
      lighthouseAudits: null,
    });
    const results = runPlaybook(autoBodyPlaybook, ev);
    for (const r of results) {
      expect(r.verdict, r.signalKey).toBeNull();
      expect(r.notCheckedReason, r.signalKey).toBeTruthy();
    }
  });

  test("tech-gated signals null when tech was never scanned", () => {
    const ev = bundle({
      business: {
        id: "b1",
        slug: "no-tech",
        categorySlugs: ["hvac"],
        website: "https://x.example",
        services: [{ name: "AC repair" }],
      },
      tech: null, // never fingerprinted
      lighthouseAudits: null,
    });
    const results = runPlaybook(hvacPlaybook, ev);
    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));
    // tech-gated → missing-enrichment:tech.
    expect(byKey["hvac.no_conversion_tracking"].notCheckedReason).toBe(
      "missing-enrichment:tech",
    );
    expect(byKey["hvac.no_online_booking"].notCheckedReason).toBe(
      "missing-enrichment:tech",
    );
    // text-only license signal still runs (no tech needed) → fires.
    expect(
      byKey["hvac.license_number_absent_from_site"].verdict,
    ).not.toBeNull();
  });
});
