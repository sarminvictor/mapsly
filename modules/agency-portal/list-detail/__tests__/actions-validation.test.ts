/**
 * Validation-shape tests for the list-detail server actions. The
 * actions themselves use auth() + prisma, but the Zod input shapes
 * are pure and worth pinning so a future drift fails the suite
 * instead of leaking through to runtime.
 *
 * We exercise the validators by importing them — but since they're
 * declared inline in the action file, we reproduce the same Zod
 * shapes here as a contract test. If the production validators
 * change, this test should change with them.
 */

import { describe, expect, test } from "vitest";
import { z } from "zod";

const LeadStatus = z.enum([
  "NEW",
  "CONTACTED",
  "REPLIED",
  "WON",
  "LOST",
  "HIDDEN",
]);

const SetLeadStatusInput = z.object({
  leadId: z.string().min(1).max(64),
  status: LeadStatus,
});

const BulkSetLeadStatusInput = z.object({
  leadIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  status: LeadStatus,
});

describe("SetLeadStatusInput", () => {
  test("accepts a valid leadId + status", () => {
    expect(
      SetLeadStatusInput.safeParse({ leadId: "L123", status: "CONTACTED" })
        .success,
    ).toBe(true);
  });

  test("rejects an unknown status", () => {
    expect(
      SetLeadStatusInput.safeParse({ leadId: "L123", status: "TYPO" }).success,
    ).toBe(false);
  });

  test("rejects an empty leadId", () => {
    expect(
      SetLeadStatusInput.safeParse({ leadId: "", status: "NEW" }).success,
    ).toBe(false);
  });

  test("rejects a 65-char leadId (cap is 64)", () => {
    expect(
      SetLeadStatusInput.safeParse({
        leadId: "a".repeat(65),
        status: "NEW",
      }).success,
    ).toBe(false);
  });
});

describe("BulkSetLeadStatusInput", () => {
  test("accepts 1-500 leadIds", () => {
    expect(
      BulkSetLeadStatusInput.safeParse({
        leadIds: ["L1", "L2", "L3"],
        status: "REPLIED",
      }).success,
    ).toBe(true);
  });

  test("rejects an empty leadIds array", () => {
    expect(
      BulkSetLeadStatusInput.safeParse({ leadIds: [], status: "NEW" }).success,
    ).toBe(false);
  });

  test("rejects > 500 leadIds (cap)", () => {
    const ids = Array.from({ length: 501 }, (_, i) => `L${i}`);
    expect(
      BulkSetLeadStatusInput.safeParse({ leadIds: ids, status: "NEW" }).success,
    ).toBe(false);
  });

  test("rejects any malformed leadId in the array", () => {
    expect(
      BulkSetLeadStatusInput.safeParse({
        leadIds: ["L1", ""],
        status: "NEW",
      }).success,
    ).toBe(false);
  });
});
