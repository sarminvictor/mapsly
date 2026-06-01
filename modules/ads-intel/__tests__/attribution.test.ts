// Unit tests for Meta-ad → business attribution. The invariant under test:
// every ad is assigned to AT MOST ONE business (externalAdId is globally
// unique, so a one-to-many assignment collides on insert — the bug this guards).

import { describe, expect, test } from "vitest";
import { assignMetaAdsToBusinesses, __test } from "../collect-ads-intel";

const { matchStrength, nameMatches } = __test;

type Ad = {
  id: string;
  pageId?: string | null;
  pageName?: string | null;
  resolvedFromUrl?: string | null;
};
type Biz = {
  id: string;
  name: string;
  fbPageId: string | null;
  fbPageHandle?: string | null;
};

const biz = (
  id: string,
  name: string,
  fbPageId: string | null = null,
): Biz => ({
  id,
  name,
  fbPageId,
});

describe("matchStrength", () => {
  test("full containment beats a shared token", () => {
    const contained = matchStrength(
      "The Injectionist & Aesthetics",
      "The Injectionist",
    );
    const token = matchStrength("Injectionist Clinic YYC", "The Injectionist");
    expect(contained).toBeGreaterThan(token);
    expect(token).toBeGreaterThan(0);
  });

  test("a generic word is not a match", () => {
    // "botox" appears in the page but shares no ≥5-char token with the name.
    expect(matchStrength("Botox Deals Calgary", "Leah V Skin Care")).toBe(0);
  });

  test("generic industry tokens don't match (the Merz / Legacy bugs)", () => {
    // "Merz Aesthetics" (a global brand) must NOT match on "aesthetics".
    expect(
      matchStrength("Merz Aesthetics", "The Injectionist & Aesthetics"),
    ).toBe(0);
    // "Legacy Laser & Skin Clinic" must NOT match on "laser"/"skin"/"clinic".
    expect(
      matchStrength(
        "Legacy Laser & Skin Clinic",
        "Leah V Skin Care & Laser Clinic",
      ),
    ).toBe(0);
  });

  test("a distinctive token still matches a real page variant", () => {
    // A genuine "The Injectionist YYC" page matches on "injectionist".
    expect(
      matchStrength("The Injectionist YYC", "The Injectionist & Aesthetics"),
    ).toBeGreaterThan(0);
    // Exact page name matches via containment.
    expect(
      matchStrength(
        "The Injectionist & Aesthetics",
        "The Injectionist & Aesthetics",
      ),
    ).toBeGreaterThanOrEqual(100);
  });

  test("a short shared token (<5 chars) is ignored", () => {
    // "Salon Bar" vs "Sports Bar Grill" share only "bar" (3) — below the
    // ≥5-char significance threshold — and "salon" isn't in the page → no match.
    expect(matchStrength("Sports Bar Grill", "Salon Bar")).toBe(0);
    // "Skin Care Clinic" vs "Skin Deep Spa": "skin"/"care" are <5 or absent,
    // "clinic" isn't in the page → no match.
    expect(nameMatches("Skin Deep Spa", "Skin Care Clinic")).toBe(false);
  });
});

describe("assignMetaAdsToBusinesses", () => {
  const businesses = [
    biz("inj", "The Injectionist & Aesthetics"),
    biz("leah", "Leah V Skin Care & Laser Clinic"),
    biz("arlo", "Arlo Medical Injections"),
  ];

  test("each ad lands in at most one business (no duplicate assignment)", () => {
    const ads: Ad[] = [
      { id: "a1", pageName: "The Injectionist & Aesthetics" },
      { id: "a2", pageName: "Leah V Skin Care & Laser Clinic" },
      { id: "a3", pageName: "Arlo Medical Injections" },
    ];
    const map = assignMetaAdsToBusinesses(ads, businesses);
    const seen = new Set<string>();
    for (const rows of map.values()) {
      for (const r of rows) {
        expect(seen.has(r.id)).toBe(false); // never assigned twice
        seen.add(r.id);
      }
    }
    expect(seen.size).toBe(3);
    expect(map.get("inj")?.map((a) => a.id)).toEqual(["a1"]);
    expect(map.get("leah")?.map((a) => a.id)).toEqual(["a2"]);
  });

  test("an ad matching two names goes to the STRONGER match only", () => {
    // "Injections" (≥5) is shared by Arlo's name; the page is fully Arlo's.
    // It must not also be attributed to The Injectionist (token "injectionist").
    const ads: Ad[] = [{ id: "x", pageName: "Arlo Medical Injections" }];
    const map = assignMetaAdsToBusinesses(ads, businesses);
    const owners = [...map.entries()].filter(([, v]) =>
      v.some((a) => a.id === "x"),
    );
    expect(owners).toHaveLength(1);
    expect(owners[0][0]).toBe("arlo");
  });

  test("fbPageId exact match wins over any name match", () => {
    const withPage = [
      biz("inj", "Totally Different Name", "PAGE_123"),
      ...businesses,
    ];
    const ads: Ad[] = [
      {
        id: "p",
        pageId: "PAGE_123",
        pageName: "The Injectionist & Aesthetics",
      },
    ];
    const map = assignMetaAdsToBusinesses(ads, withPage);
    expect(map.get("inj")?.map((a) => a.id)).toEqual(["p"]);
    // Not also attributed to the name-matching business.
    const all = [...map.values()].flat();
    expect(all).toHaveLength(1);
  });

  test("ads with no plausible owner are dropped", () => {
    const ads: Ad[] = [{ id: "noise", pageName: "Botox Deals Calgary" }];
    const map = assignMetaAdsToBusinesses(ads, businesses);
    expect([...map.values()].flat()).toHaveLength(0);
  });

  test("brand-noise ads (Merz Aesthetics) are NOT attributed to anyone", () => {
    // The exact bug: 110 Merz Aesthetics ads were wrongly assigned to The
    // Injectionist via the "aesthetics" token. They must now be dropped.
    const ads: Ad[] = [
      { id: "merz1", pageId: "234830070396045", pageName: "Merz Aesthetics" },
      { id: "merz2", pageId: "234830070396045", pageName: "Merz Aesthetics" },
    ];
    const map = assignMetaAdsToBusinesses(ads, businesses);
    expect([...map.values()].flat()).toHaveLength(0);
  });

  test("resolvedFromUrl attributes even when the name has no distinctive token", () => {
    // "Leah V Skin Care & Laser Clinic" has NO distinctive token (all generic /
    // short), so name-matching can't place her ads. But because we sent her
    // handle, the actor echoes it back as resolvedFromUrl → exact attribution.
    const withHandle = [
      {
        id: "leah",
        name: "Leah V Skin Care & Laser Clinic",
        fbPageId: null,
        fbPageHandle: "leahvskincare",
      },
      ...businesses,
    ];
    const ads: Ad[] = [
      {
        id: "L1",
        pageId: "55501",
        pageName: "Leah V",
        resolvedFromUrl: "leahvskincare",
      },
      {
        id: "L2",
        pageId: "55501",
        pageName: "Leah V",
        resolvedFromUrl: "LeahVSkinCare",
      },
    ];
    const map = assignMetaAdsToBusinesses(ads, withHandle);
    expect(
      map
        .get("leah")
        ?.map((a) => a.id)
        .sort(),
    ).toEqual(["L1", "L2"]);
  });

  test("a cached fbPageId outranks resolvedFromUrl and name", () => {
    const biz2 = [
      { id: "inj", name: "X", fbPageId: "999", fbPageHandle: "somethingelse" },
    ];
    const ads: Ad[] = [
      { id: "z", pageId: "999", pageName: "whatever", resolvedFromUrl: "nope" },
    ];
    const map = assignMetaAdsToBusinesses(ads, biz2);
    expect(map.get("inj")?.map((a) => a.id)).toEqual(["z"]);
  });

  test("multiple ads from one page all go to the same business", () => {
    const ads: Ad[] = [
      { id: "m1", pageId: "P", pageName: "Leah V Skin Care & Laser Clinic" },
      { id: "m2", pageId: "P", pageName: "Leah V Skin Care & Laser Clinic" },
    ];
    const map = assignMetaAdsToBusinesses(ads, businesses);
    expect(
      map
        .get("leah")
        ?.map((a) => a.id)
        .sort(),
    ).toEqual(["m1", "m2"]);
  });
});
