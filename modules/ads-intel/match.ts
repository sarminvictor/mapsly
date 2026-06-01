// modules/ads-intel/match.ts · pure advertiser-name ↔ business-name matching.
//
// Shared by both collectors (per-business + per-cell) so they never drift, and
// kept in its own file to avoid a circular import between them. No IO.
//
// The hard-won lesson (see ads-rework memory): matching a Meta page name to a
// business on GENERIC industry words ("aesthetics", "laser", "clinic") wrongly
// attributes global brands (e.g. "Merz Aesthetics") + unrelated clinics. A page
// must fully contain the name OR share a DISTINCTIVE (non-generic) token.

export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Generic industry / business-suffix tokens that recur across many unrelated
// page names — excluded from token matching so brands don't collide.
const GENERIC_NAME_TOKENS = new Set([
  "aesthetics",
  "aesthetic",
  "esthetics",
  "esthetic",
  "medical",
  "medspa",
  "clinic",
  "clinics",
  "laser",
  "skincare",
  "beauty",
  "wellness",
  "studio",
  "salon",
  "dermatology",
  "dermatologie",
  "injections",
  "injection",
  "cosmetic",
  "cosmetics",
  "surgery",
  "surgical",
  "health",
  "center",
  "centre",
  "group",
  "institute",
  "academy",
  "boutique",
  "lounge",
  "rejuvenation",
  "antiaging",
  "medicine",
  "therapy",
  "spa",
  "skin",
  "care",
  "med",
]);

/** A name's distinctive tokens — ≥5 chars and NOT a generic industry word. */
export function distinctiveTokens(name: string): string[] {
  return norm(name)
    .split(" ")
    .filter((t) => t.length >= 5 && !GENERIC_NAME_TOKENS.has(t));
}

/**
 * How strongly a Meta page name belongs to a business (0 = no match). Requires
 * full name containment OR a shared DISTINCTIVE token — generic industry words
 * don't count. Returns a magnitude so an ad maps to its SINGLE best business
 * (externalAdId is globally unique → one ad, one business). Containment outranks
 * any token match.
 */
export function matchStrength(
  pageName: string | null | undefined,
  bizName: string,
): number {
  const p = norm(pageName);
  const b = norm(bizName);
  if (!p || !b) return 0;
  if (p.includes(b) || b.includes(p)) return 100 + Math.min(b.length, p.length);
  let best = 0;
  for (const t of distinctiveTokens(bizName)) {
    if (p.includes(t)) best = Math.max(best, t.length);
  }
  return best;
}

export function nameMatches(
  pageName: string | null | undefined,
  bizName: string,
): boolean {
  return matchStrength(pageName, bizName) > 0;
}
