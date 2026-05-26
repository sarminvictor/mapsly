/**
 * Agency settings · shared types + EMPTY constant.
 *
 * Surface read by `getAgencySettings(userId)` and consumed by
 * `/(agency)/settings/page.tsx`. The page is read-mostly: Profile is
 * editable (defaultMetro + categoriesServed) by OWNER/ADMIN, Plan is
 * display-only (links to billing), Team is read-only.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the EMPTY constant
 * keeps the literal-shape compatible with the interface at Vercel's
 * build phase (Neon WebSocket cannot open from the build worker) AND
 * in the try/catch on transient DB failure. Both code paths return
 * `EMPTY_AGENCY_SETTINGS` so TypeScript surfaces any missing field at
 * compile time, not at Vercel build time (INC-25 / INC-27).
 *
 * Plan + Role types are duplicated as string-literal unions (matching
 * the Prisma enums in `prisma/schema.prisma`) — this matches the
 * convention used by `modules/billing/webhook.ts` to avoid coupling
 * the module to generated Prisma types in a place where we only ever
 * read string values out of the DB and never compare them.
 */

export type AgencyPlanValue = "SOLO" | "GROWTH" | "AGENCY_PRO" | "BOUTIQUE";
export type AgencyMemberRoleValue = "OWNER" | "ADMIN" | "STAFF";

export interface AgencyMemberRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  role: AgencyMemberRoleValue;
}

export interface AgencySettingsAgency {
  id: string;
  name: string;
  defaultMetro: string | null;
  categoriesServed: string[];
  plan: AgencyPlanValue;
}

/**
 * What the page needs to render. Sourced from one cached query so the
 * build-phase guard returns one well-typed empty value.
 *
 * Sentinel: `agency.id === ""` means "viewer has no AgencyMember row".
 * The page handler bounces stray SMB users to `/home`.
 */
export interface AgencySettingsData {
  agency: AgencySettingsAgency;
  membership: { role: AgencyMemberRoleValue };
  members: AgencyMemberRow[];
  /** Effective locale read from the NEXT_LOCALE cookie or the URL. */
  locale: string;
}

/**
 * Canonical empty shape · returned for:
 *
 *   - No AgencyMember row for the viewer (stray SMB user)
 *   - Vercel build phase (NEXT_PHASE === 'phase-production-build')
 *   - Prisma threw (degrade rather than 500)
 *
 * Every field present so the literal matches `AgencySettingsData` at
 * compile time — per `.claude/rules/cache-components.md` Pattern 1.
 */
export const EMPTY_AGENCY_SETTINGS: AgencySettingsData = {
  agency: {
    id: "",
    name: "",
    defaultMetro: null,
    categoriesServed: [],
    plan: "SOLO",
  },
  membership: { role: "STAFF" },
  members: [],
  locale: "en",
};
