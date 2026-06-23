/**
 * ADA web-accessibility detector · golden tests
 *
 * Covers the full tier ladder (0/1/2/3 serious audits + node thresholds),
 * the moderate-audits-never-alone rule, the no-website guard, evidence shape
 * (one failing_audit item per serious failure), and the exposure-framing
 * invariant on the emitted explanation.
 */

import { describe, expect, test } from "vitest";
import { assertExposurePhrasing } from "../copy-lint";
import { runSignal } from "../driver";
import { adaWebRisk } from "../signals/shared/ada";
import type { EvidenceBundle } from "../types";

type Audits = NonNullable<EvidenceBundle["lighthouseAudits"]>;

function bundle(
  audits: Audits,
  website: string | null = "https://x.example",
): EvidenceBundle {
  return {
    business: {
      id: "b1",
      slug: "acme",
      categorySlugs: ["restaurant"],
      website,
      services: [],
    },
    tech: null,
    lighthouseAudits: audits,
    reviews: [],
  };
}

const fail = (nodes: number) => ({ score: 0, failingNodes: nodes });
const pass = () => ({ score: 1, failingNodes: 0 });

describe("adaWebRisk · tiers", () => {
  test("0 serious failures → null (not a finding)", () => {
    const v = runSignal(adaWebRisk, bundle({ "image-alt": pass() }));
    expect(v).toBeNull();
  });

  test("1 serious audit, <10 nodes → low", () => {
    const v = runSignal(adaWebRisk, bundle({ "image-alt": fail(4) }));
    expect(v?.value).toBe("low");
    expect(v?.confidence).toBe("low");
    expect(v?.evidence).toHaveLength(1);
    expect(v?.evidence[0].kind).toBe("failing_audit");
  });

  test("2 serious audits → medium (regardless of node count)", () => {
    const v = runSignal(
      adaWebRisk,
      bundle({ "image-alt": fail(2), label: fail(2) }),
    );
    expect(v?.value).toBe("medium");
    expect(v?.confidence).toBe("medium");
    expect(v?.evidence).toHaveLength(2);
  });

  test("1 serious audit but ≥10 nodes → medium (node threshold)", () => {
    const v = runSignal(adaWebRisk, bundle({ "color-contrast": fail(18) }));
    expect(v?.value).toBe("medium");
  });

  test("3 serious audits AND ≥25 nodes → high", () => {
    const v = runSignal(
      adaWebRisk,
      bundle({
        "image-alt": fail(10),
        label: fail(10),
        "color-contrast": fail(10),
      }),
    );
    expect(v?.value).toBe("high");
    expect(v?.confidence).toBe("high");
    expect(v?.evidence).toHaveLength(3);
  });

  test("3 serious audits but <25 nodes → medium (not high)", () => {
    const v = runSignal(
      adaWebRisk,
      bundle({
        "image-alt": fail(2),
        label: fail(2),
        "button-name": fail(2),
      }),
    );
    expect(v?.value).toBe("medium");
  });
});

describe("adaWebRisk · moderate audits never raise risk alone", () => {
  test("moderate-only failures → null", () => {
    const v = runSignal(
      adaWebRisk,
      bundle({
        "tap-targets": fail(50),
        "document-title": fail(1),
        "html-has-lang": fail(1),
      }),
    );
    expect(v).toBeNull();
  });

  test("moderate audits added as soft corroboration when a serious fails", () => {
    const v = runSignal(
      adaWebRisk,
      bundle({ "image-alt": fail(4), "tap-targets": fail(10) }),
    );
    // value still driven by the single serious audit (1 audit, 4 nodes → low)
    expect(v?.value).toBe("low");
    // but the moderate audit appears as extra evidence
    expect(v?.evidence.length).toBe(2);
  });
});

describe("adaWebRisk · guards", () => {
  test("no website → null (not checked)", () => {
    const v = runSignal(adaWebRisk, bundle({ "image-alt": fail(30) }, null));
    expect(v).toBeNull();
  });
});

describe("adaWebRisk · copy is exposure-framed", () => {
  test("explanation passes assertExposurePhrasing", () => {
    const v = runSignal(
      adaWebRisk,
      bundle({
        "image-alt": fail(10),
        label: fail(10),
        "color-contrast": fail(10),
      }),
    );
    expect(v).not.toBeNull();
    expect(() => assertExposurePhrasing(v!.explanation)).not.toThrow();
  });
});
