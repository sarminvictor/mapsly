/**
 * SMB landing copy-voice invariants · 2026-06 redesign shape.
 *
 * Maria's voice rules (per `.claude/rules/copy-voice.md` + `ui-ux-smb.md`)
 * are non-negotiable on this surface. Banned words = an immediate test
 * failure so the autonomous loop never quietly drifts into agency jargon.
 *
 * We test against the source-of-truth strings file (messages/en.json) since
 * that's what the page renders. If a future autonomous task adds an SMB
 * string with banned vocabulary, CI fails before merge.
 */
import { describe, expect, test } from "vitest";
import en from "../../../../messages/en.json";

interface ForBusinessesShape {
  meta: Record<string, string>;
  hero: Record<string, string>;
  proof: Record<string, string>;
  mirror: Record<string, string>;
  signals: Record<string, string>;
  reviews: Record<string, string>;
  pitch: Record<string, string>;
  pricing: Record<string, string>;
  faq: Record<string, string>;
  cta: Record<string, string>;
}

// Banned jargon · agency vocabulary (see `.claude/rules/copy-voice.md`).
// Maria does not know what these mean and seeing them tells her this is
// not a product for her. The regex test is case-insensitive.
const BANNED = [
  /\bICP\b/i,
  /\bMSI\b/i,
  /\bCTR\b/i,
  /\bschema markup\b/i,
  /\bLCP\b/i,
  /\bINP\b/i,
  /\bCLS\b/i,
  /\b3[-\s]?pack\b/i,
  /\borganic rank\b/i,
  /\bNAP\b/i,
  /\bGBP\b/i,
  /\bMRR\b/i,
  /\bCAC\b/i,
  /\bLTV\b/i,
];

// Required sections — if a future refactor accidentally drops one of
// these, getTranslations() would throw on render. This test catches it
// at build time instead. Section order mirrors the page: hero → proof →
// mirror → signals → reviews → pitch → pricing → faq → cta.
const REQUIRED_SECTIONS: ReadonlyArray<keyof ForBusinessesShape> = [
  "meta",
  "hero",
  "proof",
  "mirror",
  "signals",
  "reviews",
  "pitch",
  "pricing",
  "faq",
  "cta",
];

function flatten(obj: unknown, path = ""): Array<[string, string]> {
  if (typeof obj === "string") return [[path, obj]];
  if (typeof obj !== "object" || obj === null) return [];
  const out: Array<[string, string]> = [];
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === "string") out.push([`${path}.${k}`, v]);
    else if (typeof v === "object" && v !== null)
      out.push(...flatten(v, `${path}.${k}`));
  }
  return out;
}

describe("for_businesses copy-voice invariants", () => {
  const fb = (en as { for_businesses: ForBusinessesShape }).for_businesses;

  test("all required sections present", () => {
    expect(fb).toBeTruthy();
    for (const s of REQUIRED_SECTIONS) {
      expect(fb[s], `missing section: ${s}`).toBeTruthy();
      expect(
        typeof fb[s] === "object" && fb[s] !== null,
        `section ${s} is not an object`,
      ).toBe(true);
    }
  });

  test("no banned agency jargon appears in any string", () => {
    const strings = flatten(fb);
    const offenders: Array<[string, string, string]> = [];
    for (const [path, value] of strings) {
      for (const re of BANNED) {
        if (re.test(value)) offenders.push([path, value, re.source]);
      }
    }
    expect(
      offenders,
      `Banned jargon found in SMB copy:\n${offenders
        .map(([p, v, re]) => `  ${p} matches /${re}/: ${v}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("hero carries the search funnel (placeholder + label + cta)", () => {
    expect(fb.hero.search_placeholder).toBeTruthy();
    expect(fb.hero.search_label).toBeTruthy();
    expect(fb.hero.search_cta).toBeTruthy();
    // The redesigned hero has NO stat tiles — search pill is the single CTA
    expect(fb.hero["stat_1_num"]).toBeUndefined();
  });

  test("proof has exactly 3 competitor-review cards + honesty footnote", () => {
    for (const i of [1, 2, 3]) {
      expect(fb.proof[`r${i}_name`]).toBeTruthy();
      expect(fb.proof[`r${i}_text`]).toBeTruthy();
      expect(fb.proof[`r${i}_chose`]).toBeTruthy();
    }
    expect(fb.proof["r4_name"]).toBeUndefined();
    expect(fb.proof.footnote).toBeTruthy();
  });

  test("mirror has exactly 4 blocks (score gauge + 3 stat columns)", () => {
    for (const i of [1, 2, 3, 4]) {
      expect(fb.mirror[`block_${i}_label`]).toBeTruthy();
      expect(fb.mirror[`block_${i}_number`]).toBeTruthy();
      expect(fb.mirror[`block_${i}_unit`]).toBeTruthy();
      expect(fb.mirror[`block_${i}_desc`]).toBeTruthy();
    }
    expect(fb.mirror["block_5_label"]).toBeUndefined();
  });

  test("signals has exactly 7 plain-English stat cards (c1..c7 — the rising feed)", () => {
    for (const i of [1, 2, 3, 4, 5, 6, 7]) {
      expect(fb.signals[`c${i}_label`]).toBeTruthy();
      expect(fb.signals[`c${i}_tag`]).toBeTruthy();
      expect(fb.signals[`c${i}_stat`]).toBeTruthy();
      expect(fb.signals[`c${i}_unit`]).toBeTruthy();
      expect(fb.signals[`c${i}_desc`]).toBeTruthy();
    }
    expect(fb.signals["c8_label"]).toBeUndefined();
  });

  test("reviews has exactly 3 unanswered rows with mixed star ratings", () => {
    const stars: number[] = [];
    for (const i of [1, 2, 3]) {
      expect(fb.reviews[`r${i}_name`]).toBeTruthy();
      expect(fb.reviews[`r${i}_text`]).toBeTruthy();
      const value = Number(fb.reviews[`r${i}_stars`]);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(5);
      stars.push(value);
    }
    expect(fb.reviews["r4_name"]).toBeUndefined();
    expect(fb.reviews.reply_cta).toBeTruthy();
    // Mixed on purpose: the backlog story is about ALL reviews
    expect(new Set(stars).size).toBeGreaterThan(1);
  });

  test("pricing surfaces single $29 plan (Maria gets one plan, not a comparison)", () => {
    expect(fb.pricing.price).toBe("$29");
    expect(fb.pricing.title_lead).toMatch(/\$29/);
    // Should NOT have separate tiered prices that would imply a comparison
    expect(fb.pricing["solo_price"]).toBeUndefined();
    expect(fb.pricing["pro_price"]).toBeUndefined();
  });

  test("FAQ has exactly 5 Q&A pairs (matches FAQPage JSON-LD generator)", () => {
    for (const i of [1, 2, 3, 4, 5]) {
      expect(fb.faq[`q${i}`]).toBeTruthy();
      expect(fb.faq[`a${i}`]).toBeTruthy();
    }
    expect(fb.faq["q6"]).toBeUndefined();
  });

  test("CTA has a single primary action (one decision per screen — Maria rule)", () => {
    expect(fb.cta.primary).toBeTruthy();
    expect(fb.cta["secondary"]).toBeUndefined();
  });
});

describe("for_businesses locale key parity", () => {
  // es + fr are full translations (or English-mirror placeholders at MVP).
  // en-CA is intentionally SPARSE — only Canadian-specific overrides land
  // there (see `.claude/rules/i18n.md` + i18n/__tests__/locale-en-ca.test.ts).
  // At MVP there is no Canadian-specific deviation for /for-businesses, so
  // en-CA's `for_businesses` key is absent and falls back to en.
  test("es and fr have all the same top-level for_businesses sections as en", async () => {
    const { default: es } = await import("../../../../messages/es.json");
    const { default: fr } = await import("../../../../messages/fr.json");

    const enKeys = Object.keys(en.for_businesses).sort();
    expect(
      Object.keys((es as { for_businesses: object }).for_businesses).sort(),
    ).toEqual(enKeys);
    expect(
      Object.keys((fr as { for_businesses: object }).for_businesses).sort(),
    ).toEqual(enKeys);
  });

  test("en-CA has no for_businesses key (sparse-override rule)", async () => {
    const { default: enCa } = await import("../../../../messages/en-CA.json");
    expect(
      (enCa as { for_businesses?: unknown }).for_businesses,
    ).toBeUndefined();
  });

  test("es and fr carry no banned jargon either (same scan as en)", async () => {
    const { default: es } = await import("../../../../messages/es.json");
    const { default: fr } = await import("../../../../messages/fr.json");

    for (const [name, locale] of [
      ["es", es],
      ["fr", fr],
    ] as const) {
      const strings = flatten(
        (locale as { for_businesses: object }).for_businesses,
      );
      const offenders: string[] = [];
      for (const [path, value] of strings) {
        for (const re of BANNED) {
          if (re.test(value)) offenders.push(`${name}:${path} /${re.source}/`);
        }
      }
      expect(offenders).toEqual([]);
    }
  });

  test("review star counts stay numeric 1-5 in every locale (NaN would dim all stars)", async () => {
    const { default: es } = await import("../../../../messages/es.json");
    const { default: fr } = await import("../../../../messages/fr.json");

    for (const locale of [en, es, fr]) {
      const reviews = (
        locale as { for_businesses: { reviews: Record<string, string> } }
      ).for_businesses.reviews;
      for (const i of [1, 2, 3]) {
        const value = Number(reviews[`r${i}_stars`]);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });
});
