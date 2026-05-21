/**
 * Agency onboarding · shared types + EMPTY constant for cache-components
 * Pattern 1 (build-phase short-circuit). The page reads this shape from
 * `getAgencyOnboardingData` and renders a step accordingly.
 *
 * Step state lives in `?step=1..3` so the route stays streamable
 * (URL-driven), per cache-components Pattern 3.
 */

export const ONBOARDING_STEPS = [1, 2, 3] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const TOTAL_STEPS = ONBOARDING_STEPS.length;

/**
 * Sample lead preview row · used in step 3 to show top-rated businesses
 * in the agency's default metro (or globally if no metro set).
 */
export interface AgencyOnboardingLeadPreview {
  id: string;
  name: string;
  city: string;
  category: string;
  rating: number;
  reviewCount: number;
}

/**
 * What the page needs to render. Sourced from a single cached query so
 * the build-phase guard returns one well-typed empty value.
 */
export interface AgencyOnboardingData {
  /** Empty string when user has no AgencyMember row (Tom's first visit OR stray SMB user). */
  agencyId: string;
  agencyName: string;
  /** Optional, from Agency.defaultMetro. */
  defaultMetro: string;
  /** ServiceTemplate keys that already have a List · so we can disable them in step 2. */
  serviceTemplatesUsed: string[];
  /** First 50 sample leads preview · step 3. */
  sampleLeads: AgencyOnboardingLeadPreview[];
  /** Total addressable count beyond the 50 shown. */
  moreAvailable: number;
}

/**
 * Canonical empty shape. Returned by `getAgencyOnboardingData` for:
 *
 *   - the user has no AgencyMember row (SMB-only user landed here)
 *   - we're in Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *   - Prisma threw an error
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 — every field present
 * to keep the literal-shape compatible with the interface during build.
 */
export const EMPTY_AGENCY_ONBOARDING: AgencyOnboardingData = {
  agencyId: "",
  agencyName: "",
  defaultMetro: "",
  serviceTemplatesUsed: [],
  sampleLeads: [],
  moreAvailable: 0,
};

/**
 * Parse the `?step=` searchParam into a valid step number. Anything
 * unrecognised falls back to step 1.
 */
export function parseStep(raw: string | string[] | undefined): OnboardingStep {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}
