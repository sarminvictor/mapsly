/**
 * Restaurant · menu lacks allergen information · detector
 *
 * Allergen disclosure is increasingly expected (CA SB-68 and similar) and is a
 * trust + liability angle for restaurants. We read the menu text we already
 * store (the service list stands in for menu items) deterministically — a
 * `nano_reading` over the strings, no live AI — and flag when the menu names
 * food items but mentions NO allergen language anywhere.
 *
 * Tiers (the plan tags this `low/med, nano`):
 *   medium — a sizeable menu (≥8 items) names no allergen language at all.
 *   low    — a smaller menu (1–7 items) names no allergen language.
 *   null   — allergen language IS present, OR there is no menu text to read.
 *
 * Absence contract: with no services (our menu surface) we return null ("not
 * checked"), never "no allergen info".
 *
 * See:
 *   - modules/playbooks/types.ts — EvidenceKind "nano_reading"
 */

import { assertExposurePhrasing } from "../../copy-lint";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/** Allergen / dietary language we accept as "disclosed". */
export const ALLERGEN_RE =
  /\b(allergen|allergy|gluten[\s-]?free|dairy[\s-]?free|nut[\s-]?free|peanut|shellfish|vegan|vegetarian|contains|dietary)\b/i;

/** Threshold above which a silent menu is treated as a medium gap. */
const MEDIUM_MENU_SIZE = 8;

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  // No menu text to read ⇒ not checked.
  if (services.length === 0) return null;

  // Any allergen language across the menu ⇒ disclosed ⇒ no finding.
  const disclosed = services.some((s) => ALLERGEN_RE.test(s.name));
  if (disclosed) return null;

  const size = services.length;
  const confidence: "medium" | "low" =
    size >= MEDIUM_MENU_SIZE ? "medium" : "low";

  const evidence: EvidenceItem[] = [
    {
      kind: "nano_reading",
      label: "Menu allergen language",
      detail: `No allergen / dietary language found across ${size} menu ${
        size === 1 ? "item" : "items"
      }`,
      weight: confidence === "medium" ? 0.6 : 0.4,
    },
  ];

  const explanation = assertExposurePhrasing(
    `This restaurant's menu lists ${size} ${size === 1 ? "item" : "items"} but ` +
      `mentions no allergen or dietary information — a potential allergen-` +
      `disclosure gap worth checking, since several jurisdictions now expect it.`,
  );

  return {
    value: size,
    confidence,
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const restaurantMenuNoAllergenInfo: PlaybookSignal = {
  key: "restaurant.menu_no_allergen_info",
  label: "Menu lacks allergen information",
  group: "compliance",
  requiresEnrichments: [],
  maxConfidence: "medium",
  pitchAngle:
    "Their menu discloses no allergen info — a menu-update / liability retainer angle.",
  regulationRefs: [
    "CA SB-68 and similar allergen-disclosure expectations for food menus",
  ],
  falsePositiveGuards: [
    // No website → the menu we'd update isn't the live surface → skip.
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
