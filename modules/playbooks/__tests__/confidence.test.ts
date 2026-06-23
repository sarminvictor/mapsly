/**
 * Confidence tiering · invariant tests
 *
 * The tiering math IS the "NEVER an unverified accusation" promise in code, so
 * it gets 100% branch coverage (per .claude/rules/testing.md §"Signal scoring").
 * Cases cover: empty evidence, soft-only, single hard artifact, multi-kind +
 * hard + corroboration, and the maxConfidence cap.
 */

import { describe, expect, test } from "vitest";
import {
  capConfidence,
  HARD_EVIDENCE_KINDS,
  isHardEvidence,
  tierFromEvidence,
} from "../confidence";
import type { EvidenceItem } from "../types";

const hard = (kind: EvidenceItem["kind"]): EvidenceItem => ({
  kind,
  label: "hard",
  detail: "d",
  weight: 1,
});
const soft = (kind: EvidenceItem["kind"]): EvidenceItem => ({
  kind,
  label: "soft",
  detail: "d",
  weight: 0.5,
});

describe("isHardEvidence", () => {
  test("classifies the four hard kinds as hard", () => {
    for (const kind of HARD_EVIDENCE_KINDS) {
      expect(isHardEvidence(hard(kind))).toBe(true);
    }
  });

  test("classifies soft kinds as not hard", () => {
    for (const kind of [
      "review_quote",
      "ad_creative",
      "cell_percentile",
      "attribute",
      "nano_reading",
    ] as const) {
      expect(isHardEvidence(soft(kind))).toBe(false);
    }
  });
});

describe("tierFromEvidence", () => {
  test("empty evidence → low", () => {
    expect(tierFromEvidence([], 0)).toBe("low");
  });

  test("nano_reading-only → low", () => {
    expect(tierFromEvidence([soft("nano_reading")], 1)).toBe("low");
  });

  test("single soft signal → low", () => {
    expect(tierFromEvidence([soft("review_quote")], 1)).toBe("low");
  });

  test("two soft kinds (no hard) → low", () => {
    expect(
      tierFromEvidence([soft("review_quote"), soft("ad_creative")], 2),
    ).toBe("low");
  });

  test("single hard artifact → medium", () => {
    expect(tierFromEvidence([hard("failing_audit")], 1)).toBe("medium");
  });

  test("two hard artifacts of the SAME kind, corroboration 1 → medium", () => {
    // same kind = distinctKinds 1, so cannot reach high even with two items
    expect(
      tierFromEvidence([hard("failing_audit"), hard("failing_audit")], 1),
    ).toBe("medium");
  });

  test("hard + soft, two kinds, corroboration 2 → high", () => {
    expect(
      tierFromEvidence([hard("detected_script"), soft("review_quote")], 2),
    ).toBe("high");
  });

  test("two distinct hard kinds, corroboration 2 → high", () => {
    expect(
      tierFromEvidence([hard("detected_script"), hard("license_lookup")], 2),
    ).toBe("high");
  });

  test("multi-kind + hard but corroboration 1 → medium (not high)", () => {
    expect(
      tierFromEvidence([hard("dom_fingerprint"), soft("cell_percentile")], 1),
    ).toBe("medium");
  });
});

describe("capConfidence", () => {
  test("returns the lower of computed and max", () => {
    expect(capConfidence("high", "medium")).toBe("medium");
    expect(capConfidence("high", "low")).toBe("low");
    expect(capConfidence("medium", "high")).toBe("medium");
    expect(capConfidence("low", "high")).toBe("low");
  });

  test("equal tiers pass through", () => {
    expect(capConfidence("high", "high")).toBe("high");
    expect(capConfidence("medium", "medium")).toBe("medium");
    expect(capConfidence("low", "low")).toBe("low");
  });
});
