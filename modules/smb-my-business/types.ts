/**
 * SMB "My Business" · public types.
 *
 * "My Business" is the place Maria edits her **services** — the
 * contextual lens through which every other analysis is filtered.
 * Reviews are grouped by service. Search keywords are matched against
 * services. Ads compare your creatives to competitors selling the same
 * service. Website checks per-service landing pages.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, EMPTY constants
 * match the full shape of the declared interface so Vercel's build
 * worker can prerender the page without opening a Neon WebSocket.
 *
 * v1 surface (this iteration):
 *
 *   - Services list with name, category, description, source.
 *   - Business profile snapshot (read-only, sourced from Google).
 *
 * Follow-ups tagged in PLAN.md:
 *
 *   - Service auto-detection cron (Google categories + DOM scrape).
 *   - Service-grouped review themes.
 *   - Service-keyword matching on /search.
 */

export type ServiceSource = "manual" | "auto:google" | "auto:dom";

export interface BusinessServiceRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  source: ServiceSource;
}

export interface SmbMyBusinessData {
  /**
   * Empty string when the viewer has no claimed business yet, we're in
   * build phase, or the query threw. Page renders the empty-state CTA
   * directing Maria to finish onboarding.
   */
  ownedBusinessId: string;

  // Business identity snapshot (read-only · Google is the source of truth)
  businessName: string;
  businessAddress: string | null;
  businessCity: string | null;
  businessProvince: string | null;
  businessCategory: string | null;
  businessWebsite: string | null;
  businessPhone: string | null;
  isClaimed: boolean;

  // The actual services list — active first, ordered by sortOrder
  services: BusinessServiceRow[];
}

export const EMPTY_SMB_MY_BUSINESS: SmbMyBusinessData = {
  ownedBusinessId: "",
  businessName: "",
  businessAddress: null,
  businessCity: null,
  businessProvince: null,
  businessCategory: null,
  businessWebsite: null,
  businessPhone: null,
  isClaimed: false,
  services: [],
};
