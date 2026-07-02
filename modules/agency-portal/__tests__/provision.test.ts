// agencyNameFromEmail (WP2-1) — the pure slug/name derivation behind
// self-serve agency creation. Per .claude/rules/testing.md: invariants only —
// the DB-bound provisioning path (idempotency via upsert + P2002 retry) is
// exercised end-to-end at sign-in, not re-mocked here.

import { describe, expect, test } from "vitest";

import { agencyNameFromEmail } from "../provision";

describe("agencyNameFromEmail", () => {
  test("brand domain wins", () => {
    expect(agencyNameFromEmail("tom@anchorlocal.com")).toEqual({
      name: "Anchorlocal",
      slug: "anchorlocal",
    });
  });

  test("free-mail falls back to the local part", () => {
    expect(agencyNameFromEmail("tom.smith@gmail.com")).toEqual({
      name: "Tom Smith",
      slug: "tom-smith",
    });
  });

  test("+tag sub-addressing is stripped", () => {
    expect(agencyNameFromEmail("sarminvictor+e2etest@gmail.com").slug).toBe(
      "sarminvictor",
    );
  });

  test("multi-label domains use the first label", () => {
    expect(agencyNameFromEmail("kim@studio-nine.co.uk").slug).toBe(
      "studio-nine",
    );
  });

  test("never returns an empty slug", () => {
    expect(agencyNameFromEmail("@@@").slug).toBe("agency");
    expect(agencyNameFromEmail("").slug).toBe("agency");
  });

  test("slug is url-safe and bounded", () => {
    const { slug } = agencyNameFromEmail(
      `owner@${"x".repeat(80)}verylongdomain.com`,
    );
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});
