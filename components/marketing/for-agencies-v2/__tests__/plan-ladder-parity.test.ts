/**
 * Guard · marketing pricing must never restate the plan ladder.
 *
 * The homepage band and the app disagreed for weeks: marketing advertised
 * Free / $19 Starter / $99 Growth from `for_agencies.pricing.p*_price` i18n
 * keys while `PLAN_CARDS` (the grant table the app actually bills from) sold
 * Starter $19, Solo $49, Growth $99 and Pro $299 — so Solo, the tier the
 * repricing decision says to advertise, appeared nowhere on the marketing
 * site. Nobody noticed because nothing could notice.
 *
 * Prevention is structural: exactly one component (<AgPlanCards>) renders the
 * ladder, and it reads `PLAN_CARDS`. These tests fail the moment either half
 * of that is undone — a second renderer, a hardcoded price, or the return of
 * the per-plan i18n keys.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import en from "@/messages/en.json";
import { PLAN_CARDS, PLAN_CARD_ORDER } from "@/modules/cost/pricing";

const DIR = join(process.cwd(), "components/marketing/for-agencies-v2");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");

/** Source with comments stripped — a price named in a docstring is prose, not
 *  something a prospect ever sees rendered. */
const readCode = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Every surface that shows the ladder to a prospect. */
const LADDER_CONSUMERS = ["AgPricing.tsx", "AgPricingPage.tsx"];

describe("marketing plan ladder", () => {
  test("every pricing surface renders the shared <AgPlanCards>", () => {
    for (const file of LADDER_CONSUMERS) {
      expect(read(file)).toContain("<AgPlanCards />");
    }
  });

  test("only AgPlanCards reads the plan registry", () => {
    for (const file of LADDER_CONSUMERS) {
      expect(readCode(file)).not.toContain("PLAN_CARDS");
    }
    expect(readCode("AgPlanCards.tsx")).toContain(
      'from "@/modules/cost/pricing"',
    );
  });

  test("no marketing component hardcodes a dollar price", () => {
    for (const file of [...LADDER_CONSUMERS, "AgPlanCards.tsx"]) {
      // `$${card.priceUsd}` is the template read — a literal like $49 is not.
      const literals = readCode(file).match(/\$\d[\d,]*/g) ?? [];
      expect(literals).toEqual([]);
    }
  });

  test("the per-plan i18n keys that caused the drift stay deleted", () => {
    const band = en.for_agencies.pricing as Record<string, unknown>;
    const offenders = Object.keys(band).filter((k) => /^p\d_/.test(k));
    expect(offenders).toEqual([]);
  });

  test("the advertised ladder is exactly the grant table", () => {
    // Free is a one-time grant; the four paid tiers recur.
    expect(PLAN_CARD_ORDER).toEqual([
      "free",
      "starter",
      "solo",
      "growth",
      "scale",
    ]);
    expect(PLAN_CARDS.free.oneTime).toBe(true);
    for (const key of PLAN_CARD_ORDER) {
      const card = PLAN_CARDS[key];
      expect(card.monthlyCredits).toBeGreaterThan(0);
      expect(card.features.length).toBeGreaterThan(0);
      // withContacts is the headline yield figure the cards render.
      expect(card.withContacts).toBe(card.monthlyCredits);
    }
    // Exactly one tier may wear the "most popular" badge.
    const featured = PLAN_CARD_ORDER.filter((k) => PLAN_CARDS[k].featured);
    expect(featured).toHaveLength(1);
  });
});
