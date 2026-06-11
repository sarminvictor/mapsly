/**
 * Tests · signal-token threshold logic (Miami launch).
 *
 * Pure helpers only — buildTokens itself hits Prisma and is covered by the
 * cron's integration path. The thresholds ARE the cohort router (see
 * personalization.ts header), so they get locked here.
 */
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
  normalizeName,
  rankHint,
  slowSecondsFromLcp,
} from "../personalization";

describe("slowSecondsFromLcp", () => {
  test("empty below the 4s credibility floor", () => {
    expect(slowSecondsFromLcp(null)).toBe("");
    expect(slowSecondsFromLcp(2.9)).toBe("");
    expect(slowSecondsFromLcp(3.99)).toBe("");
  });

  test("rounds whole seconds at/above 4s", () => {
    expect(slowSecondsFromLcp(4.0)).toBe("4");
    expect(slowSecondsFromLcp(10.547)).toBe("11");
    expect(slowSecondsFromLcp(19.591)).toBe("20");
  });
});

describe("rankHint · never flatter, never lie", () => {
  test("empty for page-1 businesses (organic ≤ 10)", () => {
    expect(rankHint(10, 7, null)).toBe("");
    expect(rankHint(10, 1, 15)).toBe("");
  });

  test("empty for 3-pack businesses (maps ≤ 3)", () => {
    expect(rankHint(10, 35, 2)).toBe("");
  });

  test("empty when too few tracked keywords (data artifact guard)", () => {
    expect(rankHint(2, null, null)).toBe("");
    expect(rankHint(0, null, null)).toBe("");
  });

  test("page 2 when best organic lands 11-20", () => {
    expect(rankHint(5, 11, null)).toBe("page 2");
    expect(rankHint(5, 20, 8)).toBe("page 2");
  });

  test("page 3 or deeper when worse or absent entirely", () => {
    expect(rankHint(5, 21, null)).toBe("page 3 or deeper");
    expect(rankHint(5, null, null)).toBe("page 3 or deeper");
  });
});

describe("normalizeName · self-exclusion matching", () => {
  test("case + punctuation insensitive", () => {
    expect(normalizeName("Azala Skin Clinic")).toBe(
      normalizeName("AZALA - Skin & Clinic!"),
    );
  });

  test("distinct businesses stay distinct", () => {
    expect(normalizeName("Glow Lab Medspa")).not.toBe(
      normalizeName("Glow Med Spa Miami"),
    );
  });
});
