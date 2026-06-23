/**
 * Agency onboarding · shared types + EMPTY constant for cache-components
 * Pattern 1 (build-phase short-circuit).
 *
 * Reworked for the demand-driven portal: onboarding is now a single lean
 * profile step that captures the agency's `defaultMetro` +
 * `categoriesServed` and then drops Tom into `/discover`. The old
 * 3-step wizard (template picking + lead preview that seeded a List)
 * is gone along with the supply-driven lists portal.
 */

/**
 * What the setup page needs to render. Sourced from a single cached query
 * so the build-phase guard returns one well-typed empty value.
 */
export interface AgencyOnboardingData {
  /** Empty string when user has no AgencyMember row (stray SMB user). */
  agencyId: string;
  agencyName: string;
  /** Current value of `Agency.defaultMetro` · pre-fills the form. */
  defaultMetro: string;
  /** Current `Agency.categoriesServed` joined for the comma-separated input. */
  categoriesServed: string;
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
  categoriesServed: "",
};
