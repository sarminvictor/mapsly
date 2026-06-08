// Unit tests for the plan registry.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  getPriceId,
  getSmbPriceId,
  parseBillingTerm,
  PLANS,
  PlanSchema,
  planAudience,
} from "../plans";

describe("PlanSchema", () => {
  test("accepts all five canonical plan literals", () => {
    for (const plan of PLANS) {
      expect(PlanSchema.safeParse(plan).success).toBe(true);
    }
  });

  test("rejects unknown plan strings", () => {
    expect(PlanSchema.safeParse("enterprise").success).toBe(false);
    expect(PlanSchema.safeParse("").success).toBe(false);
    expect(PlanSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("planAudience", () => {
  test("smb_paid maps to smb", () => {
    expect(planAudience("smb_paid")).toBe("smb");
  });

  test("every agency_* plan maps to agency", () => {
    for (const plan of PLANS) {
      if (plan === "smb_paid") continue;
      expect(planAudience(plan)).toBe("agency");
    }
  });
});

describe("getPriceId", () => {
  // Snapshot the env vars we mutate so other tests aren't polluted.
  const ENV_KEYS = [
    "STRIPE_PRICE_SMB_PAID",
    "STRIPE_PRICE_AGENCY_SOLO",
    "STRIPE_PRICE_AGENCY_GROWTH",
    "STRIPE_PRICE_AGENCY_PRO",
    "STRIPE_PRICE_AGENCY_BOUTIQUE",
  ] as const;
  const snapshot: Partial<
    Record<(typeof ENV_KEYS)[number], string | undefined>
  > = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) snapshot[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = snapshot[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("returns the env-var value when set", () => {
    process.env.STRIPE_PRICE_SMB_PAID = "price_smb_test";
    expect(getPriceId("smb_paid")).toBe("price_smb_test");
  });

  test("reads env at call-time, not import-time (INC-07 lazy pattern)", () => {
    delete process.env.STRIPE_PRICE_AGENCY_SOLO;
    expect(() => getPriceId("agency_solo")).toThrow(/STRIPE_PRICE_AGENCY_SOLO/);
    process.env.STRIPE_PRICE_AGENCY_SOLO = "price_solo_late";
    expect(getPriceId("agency_solo")).toBe("price_solo_late");
  });

  test("each plan maps to its dedicated env var", () => {
    process.env.STRIPE_PRICE_SMB_PAID = "p_smb";
    process.env.STRIPE_PRICE_AGENCY_SOLO = "p_solo";
    process.env.STRIPE_PRICE_AGENCY_GROWTH = "p_growth";
    process.env.STRIPE_PRICE_AGENCY_PRO = "p_pro";
    process.env.STRIPE_PRICE_AGENCY_BOUTIQUE = "p_boutique";

    expect(getPriceId("smb_paid")).toBe("p_smb");
    expect(getPriceId("agency_solo")).toBe("p_solo");
    expect(getPriceId("agency_growth")).toBe("p_growth");
    expect(getPriceId("agency_pro")).toBe("p_pro");
    expect(getPriceId("agency_boutique")).toBe("p_boutique");
  });

  test("throws a clear error naming the missing env var", () => {
    delete process.env.STRIPE_PRICE_AGENCY_BOUTIQUE;
    expect(() => getPriceId("agency_boutique")).toThrow(
      /STRIPE_PRICE_AGENCY_BOUTIQUE/,
    );
  });

  test("empty string is treated as missing", () => {
    process.env.STRIPE_PRICE_SMB_PAID = "";
    expect(() => getPriceId("smb_paid")).toThrow(/STRIPE_PRICE_SMB_PAID/);
  });
});

describe("SMB billing term", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.STRIPE_PRICE_SMB_PAID = "p_smb_month";
    process.env.STRIPE_PRICE_SMB_PAID_YEAR = "p_smb_year";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  test("parseBillingTerm defaults to monthly; only 'annual' opts in", () => {
    expect(parseBillingTerm("annual")).toBe("annual");
    expect(parseBillingTerm("monthly")).toBe("monthly");
    expect(parseBillingTerm("")).toBe("monthly");
    expect(parseBillingTerm(null)).toBe("monthly");
    expect(parseBillingTerm("yearly")).toBe("monthly");
  });

  test("getSmbPriceId maps term → the right env price", () => {
    expect(getSmbPriceId("monthly")).toBe("p_smb_month");
    expect(getSmbPriceId("annual")).toBe("p_smb_year");
  });

  test("missing annual price throws naming the env var", () => {
    delete process.env.STRIPE_PRICE_SMB_PAID_YEAR;
    expect(() => getSmbPriceId("annual")).toThrow(/STRIPE_PRICE_SMB_PAID_YEAR/);
  });
});
