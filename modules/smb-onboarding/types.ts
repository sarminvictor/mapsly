/**
 * SMB onboarding · shared types + EMPTY constant for cache-components
 * Pattern 1 (build-phase short-circuit). The page reads this shape from
 * `getSmbOnboardingData` and renders a step accordingly.
 *
 * Step state lives in `?step=1..4` so the route stays streamable
 * (URL-driven), per cache-components Pattern 3.
 */

export const ONBOARDING_STEPS = [1, 2, 3, 4] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const TOTAL_STEPS = ONBOARDING_STEPS.length;

export type Vocabulary =
  | "medspa"
  | "restaurant"
  | "autobody"
  | "salon"
  | "dental"
  | "gym"
  | "other";

export const VOCABULARY_OPTIONS: ReadonlyArray<Vocabulary> = [
  "medspa",
  "restaurant",
  "autobody",
  "salon",
  "dental",
  "gym",
  "other",
];

/**
 * What the page needs to render. Sourced from a single cached query so
 * the build-phase guard returns one well-typed empty value.
 */
export interface SmbOnboardingData {
  /** Empty string when no claimed business yet (Maria's first visit). */
  ownedBusinessId: string;
  ownedBusinessName: string;
  ownedBusinessCity: string;
}

export const EMPTY_SMB_ONBOARDING: SmbOnboardingData = {
  ownedBusinessId: "",
  ownedBusinessName: "",
  ownedBusinessCity: "",
};

/**
 * Parse the `?step=` searchParam into a valid step number. Anything
 * unrecognised falls back to step 1 — first-time visitors land cleanly.
 */
export function parseStep(raw: string | string[] | undefined): OnboardingStep {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return 1;
}
