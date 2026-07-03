// Pure unit tests for the family-coverage source of truth — the derivation the
// workbench dot-strip, the drawer accordions, and the batched coverage endpoint
// all share. Covers the boolean coverage map AND the "failed" derivation that
// distinguishes an errored family from a never-run one.

import { describe, expect, test } from "vitest";

import { deriveFailedFamilies, deriveFamilyCoverage } from "../family-coverage";

describe("deriveFamilyCoverage", () => {
  test("identity is always covered; empty presence covers nothing else", () => {
    const cov = deriveFamilyCoverage({});
    expect(cov.identity).toBe(true);
    expect(cov.reviews).toBe(false);
    expect(cov.website).toBe(false);
    expect(cov.contacts).toBe(false);
    expect(cov.ads).toBe(false);
    expect(cov.search).toBe(false);
  });

  test("real-row presence covers a family", () => {
    const cov = deriveFamilyCoverage({ contacts: true, reviews: true });
    expect(cov.contacts).toBe(true);
    expect(cov.reviews).toBe(true);
    expect(cov.website).toBe(false);
  });

  test("a finished job covers a family even with no scalar row (contacts scan → 0 found)", () => {
    const cov = deriveFamilyCoverage({}, new Set(["CONTACTS"]));
    expect(cov.contacts).toBe(true);
  });

  test("website is covered by either TECH or LIGHTHOUSE job", () => {
    expect(deriveFamilyCoverage({}, new Set(["TECH"])).website).toBe(true);
    expect(deriveFamilyCoverage({}, new Set(["LIGHTHOUSE"])).website).toBe(
      true,
    );
  });
});

describe("deriveFailedFamilies", () => {
  test("no failed jobs → no failures", () => {
    const cov = deriveFamilyCoverage({});
    expect(deriveFailedFamilies(cov)).toEqual([]);
    expect(deriveFailedFamilies(cov, new Set())).toEqual([]);
  });

  test("a failed job on an UN-covered family reads as failed", () => {
    const cov = deriveFamilyCoverage({}); // nothing covered
    expect(deriveFailedFamilies(cov, new Set(["CONTACTS"]))).toEqual([
      "contacts",
    ]);
  });

  test("a failed job whose family is now COVERED (retry landed) is NOT failed", () => {
    // contacts covered by a real row, but a prior job also errored → not failed.
    const cov = deriveFamilyCoverage({ contacts: true });
    expect(deriveFailedFamilies(cov, new Set(["CONTACTS"]))).toEqual([]);
  });

  test("maps LIGHTHOUSE/TECH failures to the website family", () => {
    const cov = deriveFamilyCoverage({});
    expect(deriveFailedFamilies(cov, new Set(["LIGHTHOUSE"]))).toEqual([
      "website",
    ]);
  });
});
