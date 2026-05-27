/**
 * Tests for /admin/cron-runs query helpers.
 *
 * Focus on the PURE LOGIC pieces · `categorizeJob` (string mapping) +
 * `extractBusinessId` (via integration through getTriggerChain isn't
 * needed — we test it indirectly via the rules). The heavy queries
 * (`getCronRunsView`, `getTriggerChain`) require live DB; covered by
 * the smoke test in production rather than unit tests here.
 */

import { describe, expect, test } from "vitest";

import { categorizeJob, CATEGORY_META } from "../queries";

describe("categorizeJob", () => {
  test("scheduled · daily/weekly/monthly prefixes", () => {
    expect(categorizeJob("daily:brand-hijack-scan")).toBe("scheduled");
    expect(categorizeJob("weekly:reviews-delta")).toBe("scheduled");
    expect(categorizeJob("weekly:business-profile-refresh")).toBe("scheduled");
    expect(categorizeJob("monthly:keyword-volume-refresh")).toBe("scheduled");
  });

  test("manual · admin/manual prefixes", () => {
    expect(categorizeJob("admin:reviews-trigger-bulk")).toBe("manual");
    expect(categorizeJob("admin:qualify-one")).toBe("manual");
    expect(categorizeJob("admin:qualify-bulk")).toBe("manual");
    expect(categorizeJob("manual:smb-regenerate-reply")).toBe("manual");
  });

  test("worker · worker: prefix", () => {
    expect(categorizeJob("worker:reviews-trigger")).toBe("worker");
  });

  test("pingback · *:pingback-handler suffix", () => {
    expect(categorizeJob("reviews:pingback-handler")).toBe("pingback");
    expect(categorizeJob("dataforseo:pingback")).toBe("pingback");
  });

  test("internal · process-enhancer + internal:/system:/audit: prefixes", () => {
    expect(categorizeJob("process-enhancer")).toBe("internal");
    expect(categorizeJob("internal:self-check")).toBe("internal");
    expect(categorizeJob("system:gc")).toBe("internal");
    expect(categorizeJob("audit:cost-budget")).toBe("internal");
  });

  test("other · unknown shapes don't crash", () => {
    expect(categorizeJob("some-random-job")).toBe("other");
    expect(categorizeJob("")).toBe("other");
    expect(categorizeJob("review-delta")).toBe("other"); // no colon
  });
});

describe("CATEGORY_META", () => {
  test("every category has label + description + icon", () => {
    for (const cat of [
      "scheduled",
      "manual",
      "worker",
      "pingback",
      "internal",
      "other",
    ] as const) {
      const meta = CATEGORY_META[cat];
      expect(meta).toBeDefined();
      expect(meta.label).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.icon).toBeTruthy();
    }
  });

  test("label matches what the UI tabs render", () => {
    // Catches accidental rename · the tabs are stable navigation.
    expect(CATEGORY_META.scheduled.label).toBe("Scheduled");
    expect(CATEGORY_META.manual.label).toBe("Manual");
    expect(CATEGORY_META.worker.label).toBe("Worker");
    expect(CATEGORY_META.pingback.label).toBe("Pingbacks");
    expect(CATEGORY_META.internal.label).toBe("Internal");
    expect(CATEGORY_META.other.label).toBe("Other");
  });
});
