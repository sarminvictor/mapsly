/**
 * Hunter incremental refresh helpers · invariant tests · D.4
 *
 * The eval tests cover correctness; this file covers the change-detection
 * and refresh-delta logic the cron handler relies on to keep cost low.
 */

import { describe, expect, test } from "vitest";

import type { FilterRow } from "@/modules/signals/types";

import {
  CADENCE_RANK,
  computeRefreshDelta,
  describeSpec,
  hasChangedSince,
  selectChangedCandidates,
  strictestCadence,
  type ChangeCandidate,
} from "../incremental";
import type { FilterSpec } from "../types";

const r = (signalKey: string, comparator: string, value: unknown): FilterRow =>
  ({
    signalKey,
    comparator,
    value,
  }) as FilterRow;

// ─────────────────────────────────────────────────────────────────────────────
// describeSpec
// ─────────────────────────────────────────────────────────────────────────────

describe("describeSpec", () => {
  test("collects all referenced models", () => {
    const spec: FilterSpec = {
      rows: [
        r("rating", ">=", 4.0), // Business
        r("reply_rate", ">=", 0.5), // BusinessSnapshot
        r("lighthouse_performance", "<", 80), // LighthouseAudit
      ],
    };
    const { models } = describeSpec(spec);
    expect(models.has("Business")).toBe(true);
    expect(models.has("BusinessSnapshot")).toBe(true);
    expect(models.has("LighthouseAudit")).toBe(true);
    expect(models.size).toBe(3);
  });

  test("collects all referenced cadences", () => {
    const spec: FilterSpec = {
      rows: [
        r("rating", ">=", 4.0), // weekly
        r("lighthouse_performance", "<", 80), // weekly
        r("has_email", "is", true), // monthly
      ],
    };
    const { cadences } = describeSpec(spec);
    expect(cadences.has("weekly")).toBe(true);
    expect(cadences.has("monthly")).toBe(true);
  });

  test("records unknown signal keys", () => {
    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.0), r("removed_in_2027", "<", 10)],
    };
    const { unknownSignalKeys, models } = describeSpec(spec);
    expect(unknownSignalKeys).toEqual(["removed_in_2027"]);
    expect(models.has("Business")).toBe(true);
    expect(models.size).toBe(1);
  });

  test("includes exclusions in the analysis", () => {
    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.0)],
      exclusions: [r("is_claimed", "is", false)],
    };
    const { models } = describeSpec(spec);
    // Both reference Business — just one entry expected.
    expect(models.has("Business")).toBe(true);
    expect(models.size).toBe(1);
  });

  test("empty spec produces empty summary", () => {
    const { models, cadences, unknownSignalKeys } = describeSpec({});
    expect(models.size).toBe(0);
    expect(cadences.size).toBe(0);
    expect(unknownSignalKeys).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// strictestCadence + CADENCE_RANK
// ─────────────────────────────────────────────────────────────────────────────

describe("strictestCadence", () => {
  test("orders cadences correctly", () => {
    expect(CADENCE_RANK["on-demand"]).toBeLessThan(CADENCE_RANK.daily);
    expect(CADENCE_RANK.daily).toBeLessThan(CADENCE_RANK.weekly);
    expect(CADENCE_RANK.weekly).toBeLessThan(CADENCE_RANK.monthly);
    expect(CADENCE_RANK.monthly).toBeLessThan(CADENCE_RANK.static);
  });

  test("picks daily over weekly", () => {
    expect(strictestCadence(["weekly", "daily"])).toBe("daily");
  });

  test("picks on-demand over everything", () => {
    expect(strictestCadence(["monthly", "on-demand", "weekly"])).toBe(
      "on-demand",
    );
  });

  test("returns weekly when empty (platform baseline)", () => {
    expect(strictestCadence([])).toBe("weekly");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRefreshDelta
// ─────────────────────────────────────────────────────────────────────────────

describe("computeRefreshDelta", () => {
  test("classifies added / removed / stable correctly", () => {
    const prev = ["a", "b", "c"];
    const next = ["b", "c", "d", "e"];
    const delta = computeRefreshDelta(prev, next);
    expect(delta.added).toEqual(["d", "e"]);
    expect(delta.removed).toEqual(["a"]);
    expect(delta.stable).toEqual(["b", "c"]);
  });

  test("first-ever refresh (empty prev) classifies everything as added", () => {
    const delta = computeRefreshDelta([], ["x", "y"]);
    expect(delta.added).toEqual(["x", "y"]);
    expect(delta.removed).toEqual([]);
    expect(delta.stable).toEqual([]);
  });

  test("everyone removed (empty next)", () => {
    const delta = computeRefreshDelta(["x", "y"], []);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual(["x", "y"]);
    expect(delta.stable).toEqual([]);
  });

  test("identical sets → all stable", () => {
    const delta = computeRefreshDelta(["x", "y"], ["x", "y"]);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.stable).toEqual(["x", "y"]);
  });

  test("output arrays sorted for deterministic UI ordering", () => {
    const delta = computeRefreshDelta(["z", "a"], ["m", "a", "b"]);
    expect(delta.added).toEqual(["b", "m"]);
    expect(delta.removed).toEqual(["z"]);
    expect(delta.stable).toEqual(["a"]);
  });

  test("accepts Sets as input", () => {
    const delta = computeRefreshDelta(new Set(["a"]), new Set(["a", "b"]));
    expect(delta.added).toEqual(["b"]);
    expect(delta.stable).toEqual(["a"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasChangedSince + selectChangedCandidates
// ─────────────────────────────────────────────────────────────────────────────

describe("hasChangedSince", () => {
  const since = new Date("2026-05-15T00:00:00Z");
  const sinceISO = since.toISOString();

  const baseCandidate: ChangeCandidate = { id: "biz_1" };

  test("null since (first run) returns true for everyone", () => {
    expect(hasChangedSince(baseCandidate, null, new Set(["Business"]))).toBe(
      true,
    );
  });

  test("malformed since string returns true (don't filter)", () => {
    expect(
      hasChangedSince(baseCandidate, "not-a-date", new Set(["Business"])),
    ).toBe(true);
  });

  test("returns false when nothing newer", () => {
    const candidate: ChangeCandidate = {
      id: "biz_1",
      business: {
        lastRefreshedAt: new Date("2026-05-10T00:00:00Z"),
        updatedAt: new Date("2026-05-01T00:00:00Z"),
      },
    };
    expect(hasChangedSince(candidate, since, new Set(["Business"]))).toBe(
      false,
    );
  });

  test("Business.lastRefreshedAt newer than since → true", () => {
    const candidate: ChangeCandidate = {
      id: "biz_1",
      business: { lastRefreshedAt: new Date("2026-05-19T00:00:00Z") },
    };
    expect(hasChangedSince(candidate, since, new Set(["Business"]))).toBe(true);
  });

  test("snapshot newer than since with BusinessSnapshot in scope", () => {
    const candidate: ChangeCandidate = {
      id: "biz_1",
      snapshot: { snapshotDate: new Date("2026-05-19T00:00:00Z") },
    };
    expect(
      hasChangedSince(candidate, since, new Set(["BusinessSnapshot"])),
    ).toBe(true);
  });

  test("snapshot change ignored when BusinessSnapshot NOT in scope", () => {
    const candidate: ChangeCandidate = {
      id: "biz_1",
      snapshot: { snapshotDate: new Date("2026-05-19T00:00:00Z") },
    };
    // Spec only references Business — ignore snapshot timestamp
    expect(hasChangedSince(candidate, since, new Set(["Business"]))).toBe(
      false,
    );
  });

  test("lighthouse newer than since with LighthouseAudit in scope", () => {
    const candidate: ChangeCandidate = {
      id: "biz_1",
      lighthouseAudit: { auditedAt: "2026-05-19T00:00:00Z" },
    };
    expect(
      hasChangedSince(candidate, since, new Set(["LighthouseAudit"])),
    ).toBe(true);
  });

  test("review/serp/ad latest timestamps wired in", () => {
    expect(
      hasChangedSince(
        { id: "x", latestReviewAt: "2026-05-19T00:00:00Z" },
        since,
        new Set(["Review"]),
      ),
    ).toBe(true);
    expect(
      hasChangedSince(
        { id: "x", latestSerpAt: "2026-05-19T00:00:00Z" },
        since,
        new Set(["SerpResult"]),
      ),
    ).toBe(true);
    expect(
      hasChangedSince(
        { id: "x", latestAdLibraryAt: "2026-05-19T00:00:00Z" },
        since,
        new Set(["AdLibraryEntry"]),
      ),
    ).toBe(true);
  });

  test("accepts string since (ISO)", () => {
    const candidate: ChangeCandidate = {
      id: "biz_1",
      business: { lastRefreshedAt: "2026-05-19T00:00:00Z" },
    };
    expect(hasChangedSince(candidate, sinceISO, new Set(["Business"]))).toBe(
      true,
    );
  });

  test("null/undefined timestamps treated as 'not newer'", () => {
    const candidate: ChangeCandidate = {
      id: "biz_1",
      business: { lastRefreshedAt: null, updatedAt: undefined },
      snapshot: null,
    };
    expect(
      hasChangedSince(
        candidate,
        since,
        new Set(["Business", "BusinessSnapshot"]),
      ),
    ).toBe(false);
  });
});

describe("selectChangedCandidates", () => {
  test("filters candidates to those with relevant changes", () => {
    const since = new Date("2026-05-15T00:00:00Z");
    const candidates: ChangeCandidate[] = [
      // Changed business
      {
        id: "a",
        business: { lastRefreshedAt: new Date("2026-05-19T00:00:00Z") },
      },
      // Stale
      {
        id: "b",
        business: { lastRefreshedAt: new Date("2026-05-10T00:00:00Z") },
      },
      // Snapshot changed (in scope)
      { id: "c", snapshot: { snapshotDate: new Date("2026-05-19T00:00:00Z") } },
      // Lighthouse changed (NOT in scope for this spec)
      {
        id: "d",
        lighthouseAudit: { auditedAt: new Date("2026-05-19T00:00:00Z") },
      },
    ];

    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.0), r("reply_rate", ">=", 0.5)],
    };

    const changed = selectChangedCandidates(candidates, since, spec);
    expect(changed.map((c) => c.id).sort()).toEqual(["a", "c"]);
  });

  test("first run (since=null) returns all candidates", () => {
    const candidates: ChangeCandidate[] = [{ id: "a" }, { id: "b" }];
    const spec: FilterSpec = { rows: [r("rating", ">=", 4.0)] };
    expect(selectChangedCandidates(candidates, null, spec)).toHaveLength(2);
  });

  test("empty candidates returns empty", () => {
    expect(
      selectChangedCandidates([], new Date(), {
        rows: [r("rating", ">=", 4.0)],
      }),
    ).toEqual([]);
  });
});
