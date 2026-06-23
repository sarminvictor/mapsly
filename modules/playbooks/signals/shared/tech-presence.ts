/**
 * Shared tech-presence helpers · pure predicates over an EvidenceBundle's tech
 *
 * The hydrate layer lowercases each `BusinessTechCategory` (BOOKING → "booking",
 * ECOMMERCE → "ecommerce", …) onto `tech[].category`. These helpers centralize
 * the substring tests the absence-based signals share so a category-naming tweak
 * lives in one place. All are PURE and tolerate a null tech array (caller gates
 * on it via requiresEnrichments: ["tech"]).
 *
 * See:
 *   - prisma/schema.prisma            — enum BusinessTechCategory
 *   - modules/playbooks/hydrate.ts    — lowercases category onto the bundle
 */

import type { EvidenceBundle } from "../../types";

type TechEntry = { name: string; category: string };

/** True when ANY tech entry's category includes the (lowercased) needle. */
function hasCategory(tech: TechEntry[] | null, needle: string): boolean {
  if (!tech) return false;
  return tech.some((t) => t.category.toLowerCase().includes(needle));
}

/** A booking / scheduling tool (Calendly, Acuity, SimplyBook, …). */
export function hasBookingTool(ev: EvidenceBundle): boolean {
  return hasCategory(ev.tech, "booking");
}

/** An e-commerce / online-ordering tool (Shopify, Toast, Square Online, …). */
export function hasEcommerceTool(ev: EvidenceBundle): boolean {
  return hasCategory(ev.tech, "ecommerce");
}

/** Any conversion-measuring tech: an ad pixel OR an analytics tag. */
export function hasConversionTracking(ev: EvidenceBundle): boolean {
  return hasCategory(ev.tech, "pixel") || hasCategory(ev.tech, "analytics");
}

/** A payment tool (Stripe, Square, PayPal) — proxies "transact online". */
export function hasPaymentTool(ev: EvidenceBundle): boolean {
  return hasCategory(ev.tech, "payment");
}
