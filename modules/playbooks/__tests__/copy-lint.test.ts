/**
 * Copy lint · invariant tests
 *
 * The banned-absolute guard is load-bearing for the product promise: it's the
 * mechanical wall between "exposure worth checking" and an unverified legal
 * accusation. Every banned phrase is tested + the happy path returns text.
 */

import { describe, expect, test } from "vitest";
import {
  assertExposurePhrasing,
  BANNED_ABSOLUTE_PATTERNS,
  ExposurePhrasingError,
} from "../copy-lint";

describe("assertExposurePhrasing", () => {
  const banned = [
    "This business is violating the rule",
    "It violates the law here",
    "That setup is illegal",
    "The site is non-compliant",
    "They are non compliant with WCAG",
    "The owner is guilty of this",
    "This breaks the law",
    // case-insensitivity
    "ILLEGAL tracker",
    "Is Violating something",
  ];

  test.each(banned)("throws on banned phrase: %s", (text) => {
    expect(() => assertExposurePhrasing(text)).toThrow(ExposurePhrasingError);
  });

  test("returns exposure-framed copy unchanged", () => {
    const ok =
      "A potential patient-privacy exposure worth checking before outreach.";
    expect(assertExposurePhrasing(ok)).toBe(ok);
  });

  test("does not match benign substrings of unrelated words", () => {
    // "compliant" alone is fine; only "non-compliant" is banned.
    const ok = "Their site is compliant-friendly and worth a closer look.";
    expect(() => assertExposurePhrasing(ok)).not.toThrow();
  });

  test("exposes the pattern list for downstream tooling", () => {
    expect(BANNED_ABSOLUTE_PATTERNS.length).toBeGreaterThanOrEqual(6);
  });
});
