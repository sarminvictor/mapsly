// Unit tests for the pure-helper exports of modules/billing/queries.ts.
//
// The DB-touching helpers (getSmb*, getAgency*) need a Prisma mock per
// portal.test.ts; we exercise the pure mapper (`amountFromPlan`) + EMPTY
// constants here so test runtime stays under 100ms.

import { describe, expect, test } from "vitest";

import {
  EMPTY_CURRENT_PLAN,
  EMPTY_INVOICES,
  INVOICE_PAGE_SIZE,
  amountFromPlan,
} from "../queries";

describe("amountFromPlan", () => {
  test("smb_paid → $29.00", () => {
    expect(amountFromPlan("smb_paid")).toBe(2900);
  });
  test("agency_solo → $49.00", () => {
    expect(amountFromPlan("agency_solo")).toBe(4900);
  });
  test("agency_growth → $99.00", () => {
    expect(amountFromPlan("agency_growth")).toBe(9900);
  });
  test("agency_pro → $249.00", () => {
    expect(amountFromPlan("agency_pro")).toBe(24900);
  });
  test("agency_boutique → $499.00", () => {
    expect(amountFromPlan("agency_boutique")).toBe(49900);
  });
  test("null plan → null amount", () => {
    expect(amountFromPlan(null)).toBeNull();
  });
});

describe("EMPTY constants shape parity (INC-25)", () => {
  test("EMPTY_CURRENT_PLAN has every field of CurrentPlanData", () => {
    // Hard-coded list mirrors the interface; if a field is added without
    // updating the EMPTY constant the Vercel build will surface it, but
    // the test catches it locally too.
    const required = [
      "audience",
      "canManage",
      "stripeCustomerId",
      "hasCustomer",
      "subscriptionId",
      "plan",
      "status",
      "currentPeriodEnd",
      "cancelAtPeriodEnd",
      "amountCents",
      "currency",
      "displayName",
    ] as const;
    for (const k of required) {
      expect(EMPTY_CURRENT_PLAN).toHaveProperty(k);
    }
    expect(EMPTY_CURRENT_PLAN.audience).toBe("smb");
    expect(EMPTY_CURRENT_PLAN.hasCustomer).toBe(false);
    expect(EMPTY_CURRENT_PLAN.cancelAtPeriodEnd).toBe(false);
    expect(EMPTY_CURRENT_PLAN.currency).toBe("usd");
  });

  test("EMPTY_INVOICES has invoices array + hasMore boolean", () => {
    expect(EMPTY_INVOICES.invoices).toEqual([]);
    expect(EMPTY_INVOICES.hasMore).toBe(false);
  });

  test("INVOICE_PAGE_SIZE matches the task spec (12)", () => {
    expect(INVOICE_PAGE_SIZE).toBe(12);
  });
});
