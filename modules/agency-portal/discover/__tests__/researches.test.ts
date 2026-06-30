// Tests for the research-DEPENDENCY resolver (modules/.../researches.ts) — the
// replacement for the broken `familiesForSignals`. These lock the invariants
// that matter: dependency-chain expansion, composite multi-family signals, the
// COMPLETENESS guard (no signal silently drops its researches), discovery-only
// signals collecting nothing, and union+dedup across a multi-signal selection.

import { describe, expect, test } from "vitest";

import {
  RESEARCH_DEPS,
  RESEARCH_LABELS,
  resolveResearches,
  researchesForSignals,
  type Research,
} from "../researches";
import { SIG_META } from "../goal-templates";
import { ALL_ENRICHMENT_TYPES } from "@/modules/cost/pricing";

describe("resolveResearches · transitive closure over RESEARCH_DEPS", () => {
  test("expands tech → [contacts, tech] (tech rides the contacts DOM fetch)", () => {
    // The one load-bearing chain: a signal that needs tech MUST pull in contacts
    // because the dispatch collapses contacts+tech into one CONTACTS scan job.
    expect(resolveResearches(["tech"])).toEqual(["contacts", "tech"]);
  });

  test("a seed with no deps is returned as-is", () => {
    expect(resolveResearches(["reviews"])).toEqual(["reviews"]);
    expect(resolveResearches(["lighthouse"])).toEqual(["lighthouse"]);
  });

  test("output order is the canonical price-list order, regardless of seed order", () => {
    // contacts precedes tech in ALL_ENRICHMENT_TYPES, so both orders normalize.
    const a = resolveResearches(["tech", "reviews"]);
    const b = resolveResearches(["reviews", "tech"]);
    expect(a).toEqual(b);
    // And the order matches the canonical list, not insertion order.
    const idx = (r: Research) => ALL_ENRICHMENT_TYPES.indexOf(r);
    for (let i = 1; i < a.length; i++) {
      expect(idx(a[i - 1])).toBeLessThan(idx(a[i]));
    }
  });

  test("de-dups when a seed already contains a prerequisite", () => {
    // contacts is tech's prereq; passing both must not duplicate contacts.
    expect(resolveResearches(["contacts", "tech"])).toEqual([
      "contacts",
      "tech",
    ]);
  });

  test("empty seed → empty result", () => {
    expect(resolveResearches([])).toEqual([]);
  });

  test("is cycle-safe — a hypothetical self/loop chain terminates", () => {
    // Build a temporary cyclic dep graph and assert the closure terminates
    // (each node expanded at most once) instead of looping forever.
    const orig = { ...RESEARCH_DEPS };
    try {
      // a → b → a (mutating the shared map for this assertion only).
      (RESEARCH_DEPS as Record<string, Research[]>)["serp"] = ["google_ads"];
      (RESEARCH_DEPS as Record<string, Research[]>)["google_ads"] = ["serp"];
      const out = resolveResearches(["serp"]);
      // Both nodes present, each once, terminates (no stack overflow / hang).
      expect(new Set(out)).toEqual(new Set(["serp", "google_ads"]));
      expect(out.length).toBe(2);
    } finally {
      // Restore the real dep graph so later tests see the production chains.
      for (const k of Object.keys(RESEARCH_DEPS)) {
        delete (RESEARCH_DEPS as Record<string, unknown>)[k];
      }
      Object.assign(RESEARCH_DEPS, orig);
    }
  });
});

describe("researchesForSignals · signal → research union", () => {
  test("a composite signal yields ALL its families (ads_without_pixel → meta_ads + tech, tech pulls contacts)", () => {
    const out = researchesForSignals([{ key: "ads_without_pixel" }]);
    // meta_ads + tech declared; tech's chain adds contacts. Order = price-list.
    expect(out).toEqual(["contacts", "tech", "meta_ads"]);
  });

  test("a discovery-only signal yields [] (data is known from Discovery at $0)", () => {
    expect(researchesForSignals([{ key: "operating_business" }])).toEqual([]);
    expect(researchesForSignals([{ key: "has_website" }])).toEqual([]);
    expect(researchesForSignals([{ key: "phone_only" }])).toEqual([]);
  });

  test("unions + dedups across a multi-signal selection", () => {
    // slow_site→lighthouse, diy_platform→tech(+contacts), unanswered_1star→
    // reviews, not_advertising→meta_ads. Union, deduped, in price-list order.
    const out = researchesForSignals([
      { key: "slow_site" },
      { key: "diy_platform" },
      { key: "unanswered_1star" },
      { key: "not_advertising" },
      { key: "diy_platform" }, // duplicate key — must not double-add
    ]);
    // Canonical price-list order (ENRICHMENT_PRICES key order):
    // contacts, services, tech, reviews, lighthouse, ai_research, meta_ads, …
    // so lighthouse precedes meta_ads in the projected union.
    expect(out).toEqual([
      "contacts",
      "tech",
      "reviews",
      "lighthouse",
      "meta_ads",
    ]);
    // Sanity: the order is exactly the price-list projection of the union.
    expect(out).toEqual(ALL_ENRICHMENT_TYPES.filter((t) => out.includes(t)));
  });

  test("a single tech signal pulls in its contacts prerequisite", () => {
    expect(researchesForSignals([{ key: "no_tracking_pixel" }])).toEqual([
      "contacts",
      "tech",
    ]);
  });

  test("unknown signal keys contribute nothing (no silent family)", () => {
    expect(researchesForSignals([{ key: "definitely_not_a_signal" }])).toEqual(
      [],
    );
  });

  test("empty selection → []", () => {
    expect(researchesForSignals([])).toEqual([]);
  });
});

describe("completeness invariant · every SIG_META signal declares researches", () => {
  test("no signal can silently drop — every entry has a researches array", () => {
    for (const [key, meta] of Object.entries(SIG_META)) {
      expect(
        Array.isArray(meta.researches),
        `${key} is missing a researches array`,
      ).toBe(true);
    }
  });

  test("every declared research is a real EnrichmentType (no typos)", () => {
    const valid = new Set<Research>(ALL_ENRICHMENT_TYPES);
    for (const [key, meta] of Object.entries(SIG_META)) {
      for (const r of meta.researches) {
        expect(valid.has(r), `${key} declares unknown research "${r}"`).toBe(
          true,
        );
      }
      // No dup families within one signal's own declaration.
      expect(new Set(meta.researches).size).toBe(meta.researches.length);
    }
  });

  test("resolving every signal's researches never throws and stays within the family set", () => {
    const valid = new Set<Research>(ALL_ENRICHMENT_TYPES);
    for (const key of Object.keys(SIG_META)) {
      const out = researchesForSignals([{ key }]);
      for (const r of out) expect(valid.has(r)).toBe(true);
      // The resolved set is a superset of the declared set (chains only add).
      for (const r of SIG_META[key].researches) expect(out).toContain(r);
    }
  });
});

describe("RESEARCH_LABELS · UI coverage", () => {
  test("every EnrichmentType has a human label", () => {
    for (const t of ALL_ENRICHMENT_TYPES) {
      expect(RESEARCH_LABELS[t]).toBeTruthy();
    }
  });
});
