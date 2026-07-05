// Pure unit tests for the family-coverage source of truth — the derivation the
// workbench dot-strip, the drawer accordions, and the batched coverage endpoint
// all share. Covers the boolean coverage map AND the "failed" derivation that
// distinguishes an errored family from a never-run one.

import { describe, expect, test } from "vitest";

import {
  anyEnrichmentRan,
  anyGroupRan,
  anyTypeRan,
  DATA_GROUP_KEYS,
  DATA_GROUPS,
  deriveFailedFamilies,
  deriveFamilyCoverage,
  deriveFamilyStates,
  deriveGroupStates,
  deriveTypeStates,
  enrichedFamilyCount,
  enrichedGroupCount,
  enrichTypesForGroups,
  ENRICHMENT_TYPE_KEYS,
  rollUpGroupState,
  type EnrichmentTypeKey,
  type TypeState,
} from "../family-coverage";

/** A fully not-run per-TYPE map, for building group-rollup fixtures. */
function allNotRun(): Record<EnrichmentTypeKey, TypeState> {
  const out = {} as Record<EnrichmentTypeKey, TypeState>;
  for (const k of ENRICHMENT_TYPE_KEYS) out[k] = "not_run";
  return out;
}

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

  test("meta_ads (cell run) and google_ads (per-business job) are DISTINCT types", () => {
    // B1 · Meta is cell-scoped (cellRan.metaAds); Google is now a per-business
    // GOOGLE_ADS job. Here the Meta cell ran + matched, and the Google job ran but
    // this business had 0 Google creatives → google_ads is "empty" (verified none).
    const s = deriveTypeStates({
      presence: { metaAds: true, googleAds: false },
      cellRan: { metaAds: true },
      doneJobFamilies: new Set(["GOOGLE_ADS"]),
    });
    expect(s.META_ADS).toBe("enriched");
    expect(s.GOOGLE_ADS).toBe("empty");
  });

  test("google_ads per-business job that landed creatives → enriched (B1)", () => {
    const s = deriveTypeStates({
      presence: { googleAds: true },
      doneJobFamilies: new Set(["GOOGLE_ADS"]),
    });
    expect(s.GOOGLE_ADS).toBe("enriched");
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

// C3 · the DATA GROUP roll-up — the ONE user-facing vocabulary (7 groups) and
// the single coverage denominator every workbench surface reads. The 9 billing
// types collapse into 7 groups; a group is "enriched" only when EVERY type in
// it has data, and rolls up running/failed as actionable-now signals first.
describe("DATA_GROUPS + roll-up", () => {
  test("exactly 7 groups covering all 9 types (each type in one group)", () => {
    expect(DATA_GROUPS).toHaveLength(7);
    expect(DATA_GROUP_KEYS).toHaveLength(7);
    const seen = DATA_GROUPS.flatMap((g) => g.types);
    // Every purchasable type appears exactly once across the groups.
    expect([...seen].sort()).toEqual([...ENRICHMENT_TYPE_KEYS].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("contacts+tech are ONE group; ads spans meta+google; search is SERP", () => {
    const byKey = Object.fromEntries(DATA_GROUPS.map((g) => [g.key, g]));
    expect(byKey.contacts_tech!.types).toEqual(["CONTACTS", "TECH"]);
    expect(byKey.ads!.types).toEqual(["META_ADS", "GOOGLE_ADS"]);
    expect(byKey.search!.types).toEqual(["SERP"]);
  });

  test("market groups are flagged basis=market (Meta/SERP run per cell)", () => {
    const byKey = Object.fromEntries(DATA_GROUPS.map((g) => [g.key, g]));
    expect(byKey.ads!.basis).toBe("market");
    expect(byKey.search!.basis).toBe("market");
    expect(byKey.reviews!.basis).toBe("lead");
    expect(byKey.contacts_tech!.basis).toBe("lead");
  });

  test("enrichTypesForGroups → lowercase enrichment tokens, de-duped", () => {
    expect(enrichTypesForGroups(["contacts_tech"]).sort()).toEqual([
      "contacts",
      "tech",
    ]);
    expect(enrichTypesForGroups(["ads"]).sort()).toEqual([
      "google_ads",
      "meta_ads",
    ]);
    expect(enrichTypesForGroups(["reviews"])).toEqual(["reviews"]);
  });

  test("rollUpGroupState: enriched only when EVERY type has data", () => {
    const contactsTech = DATA_GROUPS.find((g) => g.key === "contacts_tech")!;
    // Both enriched → group enriched.
    const both = { ...allNotRun(), CONTACTS: "enriched", TECH: "enriched" };
    expect(rollUpGroupState(both as never, contactsTech)).toBe("enriched");
    // One enriched, one not_run → NOT fully enriched → empty (partly ran),
    // never a false "not_run" that would re-charge the ran type.
    const partial = { ...allNotRun(), CONTACTS: "enriched" };
    expect(rollUpGroupState(partial as never, contactsTech)).toBe("empty");
    // All not_run → not_run.
    expect(rollUpGroupState(allNotRun(), contactsTech)).toBe("not_run");
  });

  test("rollUpGroupState precedence: running > failed > enriched/empty", () => {
    const ads = DATA_GROUPS.find((g) => g.key === "ads")!;
    // A running type wins over a done sibling.
    const running = {
      ...allNotRun(),
      META_ADS: "enriched",
      GOOGLE_ADS: "running",
    };
    expect(rollUpGroupState(running as never, ads)).toBe("running");
    // A failed type wins over a done sibling (none running).
    const failed = {
      ...allNotRun(),
      META_ADS: "enriched",
      GOOGLE_ADS: "failed",
    };
    expect(rollUpGroupState(failed as never, ads)).toBe("failed");
  });

  test("deriveGroupStates + enrichedGroupCount + anyGroupRan (the /7 denominator)", () => {
    // Nothing ran → all 7 groups not_run, count 0, anyGroupRan false.
    const none = deriveGroupStates(allNotRun());
    expect(Object.keys(none).sort()).toEqual([...DATA_GROUP_KEYS].sort());
    expect(enrichedGroupCount(none)).toBe(0);
    expect(anyGroupRan(none)).toBe(false);

    // Reviews enriched + contacts+tech enriched → 2 of 7 have data.
    const some = deriveGroupStates({
      ...allNotRun(),
      REVIEWS: "enriched",
      CONTACTS: "enriched",
      TECH: "enriched",
    });
    expect(enrichedGroupCount(some)).toBe(2);
    expect(anyGroupRan(some)).toBe(true);

    // A running type makes anyGroupRan true even with 0 groups enriched.
    const running = deriveGroupStates({ ...allNotRun(), SERP: "running" });
    expect(enrichedGroupCount(running)).toBe(0);
    expect(anyGroupRan(running)).toBe(true);
  });
});
