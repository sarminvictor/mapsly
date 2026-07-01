// discoveryPhaseWhere backs the Preview "~N passing so-far" match KPI: a cheap
// WHERE fragment over the signals evaluable from the Google/Maps listing alone.
// These lock the mapping + the null contract (no discovery-evaluable signal →
// null → UI shows "computed after enrichment", never a whole-cell overcount).

import { describe, expect, test } from "vitest";

import {
  DISCOVERY_PHASE_SIGNAL_KEYS,
  discoveryPhaseWhere,
} from "../discovery-phase-match";

describe("discoveryPhaseWhere", () => {
  test("a single discovery-evaluable signal returns its bare predicate", () => {
    expect(discoveryPhaseWhere(["has_website"])).toEqual({
      website: { not: null },
    });
    expect(discoveryPhaseWhere(["open_status"])).toEqual({
      openStatus: "OPEN",
    });
  });

  test("multiple discovery-evaluable signals AND together", () => {
    const w = discoveryPhaseWhere(["has_website", "open_status"]);
    expect(w).toEqual({
      AND: [{ website: { not: null } }, { openStatus: "OPEN" }],
    });
  });

  test("phone_only maps to phone-present + no-website", () => {
    expect(discoveryPhaseWhere(["phone_only"])).toEqual({
      phone: { not: null },
      website: null,
    });
  });

  test("enrichment-only signals contribute no predicate → null", () => {
    // perf_savings_ms (lighthouse), reviews_trending (reviews) etc. can't be
    // evaluated at discovery, so a goal of only those yields null.
    expect(discoveryPhaseWhere(["perf_savings_ms"])).toBeNull();
    expect(discoveryPhaseWhere(["reviews_trending", "ads_running"])).toBeNull();
  });

  test("mixed set keeps only the discovery-evaluable predicates", () => {
    // has_website is evaluable now; perf_savings_ms is not → only the website
    // predicate survives (an upper bound over what we can already check).
    expect(discoveryPhaseWhere(["has_website", "perf_savings_ms"])).toEqual({
      website: { not: null },
    });
  });

  test("empty signal list → null", () => {
    expect(discoveryPhaseWhere([])).toBeNull();
  });

  test("every advertised discovery-phase key actually resolves to a predicate", () => {
    for (const k of DISCOVERY_PHASE_SIGNAL_KEYS) {
      expect(discoveryPhaseWhere([k])).not.toBeNull();
    }
  });
});
