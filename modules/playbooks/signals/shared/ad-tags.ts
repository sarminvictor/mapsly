/**
 * Shared ad-tag detection · pure helpers over an EvidenceBundle's tech
 *
 * The "running ads, no conversion tracking" measurement-gap detector recurs
 * across service verticals (HVAC, roofing, …). This centralizes the "is an
 * ad-platform tag present?" proxy so a tag-naming tweak lives in one place.
 * Pure — no I/O, no null handling beyond the caller's requiresEnrichments gate.
 *
 * See:
 *   - modules/playbooks/signals/hvac/no-conversion-tracking.ts
 *   - modules/playbooks/signals/roofing/no-conversion-tracking.ts
 *   - modules/playbooks/signals/shared/tech-presence.ts — hasConversionTracking
 */

type TechEntry = { name: string; category: string };

/**
 * Names (case-insensitive substrings) that betray an ad-platform tag on the
 * site — our proxy for "this business runs paid ads". Conservative: a generic
 * analytics tag is NOT here (that would be conversion tracking, not an ad tag).
 */
export const AD_TAG_NAMES: readonly string[] = [
  "google ads",
  "google adwords",
  "adwords",
  "google tag manager",
  "gtm",
  "doubleclick",
  "meta ads",
  "facebook ads",
];

/** The first detected ad-platform tag, or undefined when none is present. */
export function findAdTag(tech: TechEntry[]): TechEntry | undefined {
  return tech.find((t) =>
    AD_TAG_NAMES.some((n) => t.name.toLowerCase().includes(n)),
  );
}
