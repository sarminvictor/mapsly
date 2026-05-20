/**
 * SMB landing copy-voice invariants.
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
  pitch: Record<string, string>;
  mirror: Record<string, string>;
  signals: Record<string, string>;
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
// at build time instead.
const REQUIRED_SECTIONS: ReadonlyArray<keyof ForBusinessesShape> = [
  "meta",
  "hero",
  "pitch",
  "mirror",
  "signals",
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

  test("hero has 4 stat tiles (mobile-first density limit per ui-ux-smb)", () => {
    for (const i of [1, 2, 3, 4]) {
      expect(fb.hero[`stat_${i}_num`]).toBeTruthy();
      expect(fb.hero[`stat_${i}_label`]).toBeTruthy();
    }
    // 5th stat would violate the Maria density rule
    expect(fb.hero["stat_5_num"]).toBeUndefined();
  });

  test("mirror has exactly 4 blocks (matches Maria's dashboard mockup)", () => {
    for (const i of [1, 2, 3, 4]) {
      expect(fb.mirror[`block_${i}_label`]).toBeTruthy();
      expect(fb.mirror[`block_${i}_number`]).toBeTruthy();
      expect(fb.mirror[`block_${i}_unit`]).toBeTruthy();
      expect(fb.mirror[`block_${i}_desc`]).toBeTruthy();
    }
    expect(fb.mirror["block_5_label"]).toBeUndefined();
  });

  test("signals has exactly 6 cards (c1..c6 — matches mockup)", () => {
    for (const i of [1, 2, 3, 4, 5, 6]) {
      expect(fb.signals[`c${i}_label`]).toBeTruthy();
      expect(fb.signals[`c${i}_pill`]).toBeTruthy();
      expect(fb.signals[`c${i}_desc`]).toBeTruthy();
    }
    expect(fb.signals["c7_label"]).toBeUndefined();
  });

  test("pricing surfaces single $29 plan (Maria gets one plan, not a comparison)", () => {
    expect(fb.pricing.price).toBe("$29");
    expect(fb.pricing.title).toMatch(/\$29/);
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

  test("CTA has 3 trust signals (money-back · no-card · cancel)", () => {
    expect(fb.cta.trust_1).toBeTruthy();
    expect(fb.cta.trust_2).toBeTruthy();
    expect(fb.cta.trust_3).toBeTruthy();
    expect(fb.cta["trust_4"]).toBeUndefined();
  });
});

describe("for_businesses locale key parity", () => {
  test("es, fr, en-CA have all the same top-level for_businesses sections as en", async () => {
    const { default: es } = await import("../../../../messages/es.json");
    const { default: fr } = await import("../../../../messages/fr.json");
    const { default: enCa } = await import("../../../../messages/en-CA.json");

    const enKeys = Object.keys(en.for_businesses).sort();
    expect(
      Object.keys((es as { for_businesses: object }).for_businesses).sort(),
    ).toEqual(enKeys);
    expect(
      Object.keys((fr as { for_businesses: object }).for_businesses).sort(),
    ).toEqual(enKeys);
    expect(
      Object.keys((enCa as { for_businesses: object }).for_businesses).sort(),
    ).toEqual(enKeys);
  });
});
