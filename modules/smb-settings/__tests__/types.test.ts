// EMPTY shape parity tests (INC-25).
//
// Per `.claude/rules/cache-components.md` Pattern 1, the EMPTY constant
// must include every field of the declared interface. If a future
// schema change adds a field but forgets to update EMPTY, Vercel build
// would surface it at the `'use cache'` Prisma short-circuit's
// literal-shape comparison. This test catches the same problem locally.

import { describe, expect, test } from "vitest";

import { EMPTY_SMB_SETTINGS, type SmbSettingsData } from "../types";

describe("EMPTY_SMB_SETTINGS shape parity", () => {
  test("contains every field of SmbSettingsData", () => {
    const required: ReadonlyArray<keyof SmbSettingsData> = [
      "ownedBusinessId",
      "businessName",
      "businessAddress",
      "businessCity",
      "businessProvince",
      "businessCategory",
      "businessWebsite",
      "businessPhone",
      "isClaimed",
      "userEmail",
      "userName",
    ];
    for (const k of required) {
      expect(EMPTY_SMB_SETTINGS).toHaveProperty(k);
    }
  });

  test("ownedBusinessId is empty string sentinel (no business connected)", () => {
    // Empty string is the sentinel callers check against; null/undefined
    // would conflict with real cuid values and complicate the type.
    expect(EMPTY_SMB_SETTINGS.ownedBusinessId).toBe("");
  });

  test("nullable fields default to null, not undefined", () => {
    // Prisma optional columns come back as `T | null` — match exactly to
    // avoid surprises when comparing to query results.
    expect(EMPTY_SMB_SETTINGS.businessAddress).toBeNull();
    expect(EMPTY_SMB_SETTINGS.businessCity).toBeNull();
    expect(EMPTY_SMB_SETTINGS.businessProvince).toBeNull();
    expect(EMPTY_SMB_SETTINGS.businessCategory).toBeNull();
    expect(EMPTY_SMB_SETTINGS.businessWebsite).toBeNull();
    expect(EMPTY_SMB_SETTINGS.businessPhone).toBeNull();
    expect(EMPTY_SMB_SETTINGS.userName).toBeNull();
  });

  test("non-nullable strings default to empty string", () => {
    expect(EMPTY_SMB_SETTINGS.businessName).toBe("");
    expect(EMPTY_SMB_SETTINGS.userEmail).toBe("");
  });

  test("isClaimed defaults to false", () => {
    expect(EMPTY_SMB_SETTINGS.isClaimed).toBe(false);
  });
});
