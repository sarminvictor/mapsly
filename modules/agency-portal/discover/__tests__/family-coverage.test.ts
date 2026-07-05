// Pure unit tests for the family-coverage source of truth — the derivation the
// workbench dot-strip, the drawer accordions, and the batched coverage endpoint
// all share. Covers the boolean coverage map AND the "failed" derivation that
// distinguishes an errored family from a never-run one.

import { describe, expect, test } from "vitest";

import {
  anyEnrichmentRan,
  anyTypeRan,
  deriveFailedFamilies,
  deriveFamilyCoverage,
  deriveFamilyStates,
  deriveTypeStates,
  enrichedFamilyCount,
  ENRICHMENT_TYPE_KEYS,
} from "../family-coverage";

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

// AUDIT §3 · the honest run-state model — the invariant every workbench surface
// reads. The whole point is that "enriched" comes from a RUN, and a completed
// run with no data reads "empty" (not "not_run"), while presence without a run
// never fakes "enriched".
describe("deriveFamilyStates", () => {
  test("nothing ran → every enrichment family is not_run (identity aside)", () => {
    const s = deriveFamilyStates({ presence: {} });
    expect(s.identity).toBe("enriched");
    for (const f of [
      "reviews",
      "website",
      "contacts",
      "ads",
      "search",
    ] as const)
      expect(s[f]).toBe("not_run");
  });

  test("job DONE + data → enriched; job DONE + NO data → empty (ran, none)", () => {
    const done = new Set(["CONTACTS"]);
    expect(
      deriveFamilyStates({
        presence: { contacts: true },
        doneJobFamilies: done,
      }).contacts,
    ).toBe("enriched");
    expect(
      deriveFamilyStates({
        presence: { contacts: false },
        doneJobFamilies: done,
      }).contacts,
    ).toBe("empty");
  });

  test("presence WITHOUT a run never fakes enriched — the reviewCount bug", () => {
    // A discovery-only business carries reviewCount but no reviews job ran.
    expect(deriveFamilyStates({ presence: { reviews: true } }).reviews).toBe(
      "not_run",
    );
  });

  test("job FAILED (and not done) → failed", () => {
    expect(
      deriveFamilyStates({
        presence: {},
        failedJobFamilies: new Set(["CONTACTS"]),
      }).contacts,
    ).toBe("failed");
  });

  test("ads/search are cell-scoped: a completed cell run with 0 matches → empty, not not_run", () => {
    // The Kelowna case: the ad/SERP cell ran but matched nothing for this biz.
    const ran = deriveFamilyStates({
      presence: { ads: false, search: false },
      cellRan: { ads: true, search: true },
    });
    expect(ran.ads).toBe("empty");
    expect(ran.search).toBe("empty");
    // With data present → enriched.
    const withData = deriveFamilyStates({
      presence: { ads: true, search: true },
      cellRan: { ads: true, search: true },
    });
    expect(withData.ads).toBe("enriched");
    expect(withData.search).toBe("enriched");
    // A failed cell run (never completed) → failed.
    expect(
      deriveFamilyStates({ presence: {}, cellFailed: { ads: true } }).ads,
    ).toBe("failed");
  });

  test("anyEnrichmentRan / enrichedFamilyCount reflect the states", () => {
    const none = deriveFamilyStates({ presence: {} });
    expect(anyEnrichmentRan(none)).toBe(false);
    expect(enrichedFamilyCount(none)).toBe(0);

    const some = deriveFamilyStates({
      presence: { contacts: true },
      doneJobFamilies: new Set(["CONTACTS"]),
      cellRan: { ads: true }, // ran, no data → empty (counts as "ran")
    });
    expect(anyEnrichmentRan(some)).toBe(true);
    expect(enrichedFamilyCount(some)).toBe(1); // only contacts has DATA
  });
});

// AUDIT A2 · the per-TYPE run-state model — the honesty invariant for the
// workbench "Enriched" column (the 9 things Tom pays for). The same
// enriched-vs-empty split as the family model, plus a `running` state, keyed by
// the 9 EnrichmentFamily values (PLAYBOOK excluded).
describe("deriveTypeStates", () => {
  test("covers exactly the 9 purchasable types", () => {
    const s = deriveTypeStates({ presence: {} });
    expect(Object.keys(s).sort()).toEqual([...ENRICHMENT_TYPE_KEYS].sort());
    expect(ENRICHMENT_TYPE_KEYS).toHaveLength(9);
    expect(ENRICHMENT_TYPE_KEYS).not.toContain("PLAYBOOK");
  });

  test("nothing ran → every type is not_run", () => {
    const s = deriveTypeStates({ presence: {} });
    for (const k of ENRICHMENT_TYPE_KEYS) expect(s[k]).toBe("not_run");
  });

  test("job DONE + data → enriched; job DONE + NO data → empty", () => {
    const done = new Set(["CONTACTS"]);
    expect(
      deriveTypeStates({ presence: { contacts: true }, doneJobFamilies: done })
        .CONTACTS,
    ).toBe("enriched");
    expect(
      deriveTypeStates({ presence: { contacts: false }, doneJobFamilies: done })
        .CONTACTS,
    ).toBe("empty");
  });

  test("QUEUED/RUNNING job → running (wins over a data row)", () => {
    // A running job takes precedence even if a stale row is present.
    const s = deriveTypeStates({
      presence: { reviews: true },
      runningJobFamilies: new Set(["REVIEWS"]),
    });
    expect(s.REVIEWS).toBe("running");
  });

  test("FAILED job (not done/running) → failed", () => {
    expect(
      deriveTypeStates({
        presence: {},
        failedJobFamilies: new Set(["AI_RESEARCH"]),
      }).AI_RESEARCH,
    ).toBe("failed");
  });

  test("presence WITHOUT a run never fakes enriched (the reviewCount-style bug)", () => {
    expect(deriveTypeStates({ presence: { services: true } }).SERVICES).toBe(
      "not_run",
    );
  });

  test("services derives from its own presence + job, independent of contacts", () => {
    const s = deriveTypeStates({
      presence: { services: true, contacts: false },
      doneJobFamilies: new Set(["SERVICES"]),
    });
    expect(s.SERVICES).toBe("enriched");
    expect(s.CONTACTS).toBe("not_run");
  });

  test("meta_ads and google_ads are DISTINCT types from separate cell runs", () => {
    // Meta cell ran and matched this business; Google cell ran but matched none.
    const s = deriveTypeStates({
      presence: { metaAds: true, googleAds: false },
      cellRan: { metaAds: true, googleAds: true },
    });
    expect(s.META_ADS).toBe("enriched");
    expect(s.GOOGLE_ADS).toBe("empty");
  });

  test("serp is cell-scoped: completed cell, 0 matches → empty; failed cell → failed", () => {
    expect(
      deriveTypeStates({ presence: { serp: false }, cellRan: { serp: true } })
        .SERP,
    ).toBe("empty");
    expect(
      deriveTypeStates({ presence: {}, cellFailed: { serp: true } }).SERP,
    ).toBe("failed");
  });

  test("tech and lighthouse are distinct types (were one 'website' family)", () => {
    const s = deriveTypeStates({
      presence: { tech: true, lighthouse: false },
      doneJobFamilies: new Set(["TECH", "LIGHTHOUSE"]),
    });
    expect(s.TECH).toBe("enriched");
    expect(s.LIGHTHOUSE).toBe("empty");
  });

  test("anyTypeRan reflects any non-not_run state", () => {
    expect(anyTypeRan(deriveTypeStates({ presence: {} }))).toBe(false);
    expect(
      anyTypeRan(
        deriveTypeStates({
          presence: {},
          runningJobFamilies: new Set(["CONTACTS"]),
        }),
      ),
    ).toBe(true);
    expect(
      anyTypeRan(deriveTypeStates({ presence: {}, cellRan: { serp: true } })),
    ).toBe(true);
  });
});
