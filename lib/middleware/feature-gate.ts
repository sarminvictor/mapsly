// Feature gate · plan-based capability checks.
//
// Purpose: certain capabilities (white-label reports, advanced filters,
// bulk-export, scheduled email digests) are reserved for higher tiers.
// Rather than scatter `if (plan === "agency_pro" || plan === "agency_boutique")`
// throughout the codebase, we centralise the feature → plan-set mapping here.
//
// Two APIs:
//
//   1. Pure predicate: `hasFeature(plan, feature)` — synchronous, no DB hit,
//      used in client components (after the plan is fetched once at page-load)
//      and in server-side code that already has the plan in hand.
//
//   2. Async server gate: `requireFeature({ kind, id }, feature)` — looks up
//      the active plan for the agency or SMB user, then throws a typed
//      `FeatureGateError` if missing. Server actions and API routes call
//      this; the error is mapped to 403 at the route boundary.
//
// Companion: `getActivePlan(...)` resolves the live plan literal for a given
// scope (agency or SMB user) by reading the persisted Stripe subscription
// state. Single point of truth for "which features can this caller use right
// now?". Free / no-subscription state resolves to "smb_free" or "agency_solo"
// (the implicit default — Agency.plan = SOLO is the schema default too).
//
// Per .claude/rules/security.md auth checks: feature gates are NOT a substitute
// for auth or ownership. Callers must still verify the user owns/is a member
// of the scope before consulting this module.

import prisma from "@/lib/prisma";
import type { PlanLiteral } from "@/lib/cost/tier-ceiling";

// ---------------------------------------------------------------------------
// Feature registry
// ---------------------------------------------------------------------------

/**
 * Canonical feature identifiers. Add one row to FEATURE_REQUIREMENTS below
 * for every new feature. Callers reference by name; refactors stay safe via
 * the string-literal union.
 */
export const FEATURES = [
  // SMB tier features (Maria)
  "smb_ai_replies", // AI-drafted review replies
  "smb_competitor_alerts", // alerts when competitor moves in
  "smb_weekly_email", // weekly digest

  // Agency tier features (Tom)
  "agency_lists", // creating saved lists (Solo+)
  "agency_share_links", // share a list externally (Solo+)
  "agency_one_pager_pdf", // per-prospect PDF reports (Solo+)
  "agency_advanced_filters", // 60+ signals beyond the basic 12 (Growth+)
  "agency_csv_export", // bulk CSV export (Growth+)
  "agency_team_seats", // invite team members (Growth+)
  "agency_bulk_actions", // multi-select bulk operations (Pro+)
  "agency_list_analytics", // funnel + correlation panels (Pro+)
  "agency_white_label", // remove Mapsly branding on shared assets (Boutique)
  "agency_api_access", // export via REST (Boutique)
] as const;

export type Feature = (typeof FEATURES)[number];

/**
 * For each feature, the SET of plans that include it. Use sets (not ranks)
 * so SMB and agency ladders don't accidentally compare across audiences
 * (smb_paid is not "less than" agency_solo — they're different products).
 *
 * The set encoding also makes it trivial to add bespoke bundles in the
 * future (e.g. an "agency_solo + ai_replies addon" plan) without rewriting
 * comparisons.
 */
export const FEATURE_REQUIREMENTS: Record<Feature, ReadonlySet<PlanLiteral>> = {
  // SMB
  smb_ai_replies: new Set(["smb_paid"]),
  smb_competitor_alerts: new Set(["smb_paid"]),
  smb_weekly_email: new Set([
    "smb_paid",
    // Free tier gets the weekly email too — it's a primary acquisition channel.
    "smb_free",
  ]),

  // Agency · Solo+
  agency_lists: new Set([
    "agency_solo",
    "agency_growth",
    "agency_pro",
    "agency_boutique",
  ]),
  agency_share_links: new Set([
    "agency_solo",
    "agency_growth",
    "agency_pro",
    "agency_boutique",
  ]),
  agency_one_pager_pdf: new Set([
    "agency_solo",
    "agency_growth",
    "agency_pro",
    "agency_boutique",
  ]),

  // Agency · Growth+
  agency_advanced_filters: new Set([
    "agency_growth",
    "agency_pro",
    "agency_boutique",
  ]),
  agency_csv_export: new Set(["agency_growth", "agency_pro", "agency_boutique"]),
  agency_team_seats: new Set(["agency_growth", "agency_pro", "agency_boutique"]),

  // Agency · Pro+
  agency_bulk_actions: new Set(["agency_pro", "agency_boutique"]),
  agency_list_analytics: new Set(["agency_pro", "agency_boutique"]),

  // Agency · Boutique only
  agency_white_label: new Set(["agency_boutique"]),
  agency_api_access: new Set(["agency_boutique"]),
};

// ---------------------------------------------------------------------------
// Pure predicate
// ---------------------------------------------------------------------------

/**
 * Synchronous predicate. True iff the plan literal is in the set of plans
 * that include `feature`. Use this when you already have the plan in hand
 * (e.g. fetched once at page load).
 */
export function hasFeature(
  plan: PlanLiteral | null | undefined,
  feature: Feature,
): boolean {
  if (!plan) return false;
  return FEATURE_REQUIREMENTS[feature].has(plan);
}

/**
 * Returns the set of features available on a plan. Useful for "compare plans"
 * UI and for telemetry tagging on TaskRun rows.
 */
export function featuresForPlan(plan: PlanLiteral): readonly Feature[] {
  return FEATURES.filter((f) => FEATURE_REQUIREMENTS[f].has(plan));
}

// ---------------------------------------------------------------------------
// Plan resolution — read live state from Agency / User rows
// ---------------------------------------------------------------------------

/**
 * Live subscription states considered "paid". Anything else (canceled,
 * past_due, unpaid, incomplete_expired) reverts the caller to the implicit
 * free / solo default for their audience.
 *
 * Note: "past_due" is INCLUDED — Stripe gives a grace period before flipping
 * to canceled, and we don't want a transient payment failure to instantly
 * lock the customer out. Compliance follows Stripe's own behavior.
 */
const PAID_STRIPE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

/**
 * Resolve the active plan for an Agency. Returns the agency's literal plan
 * (agency_solo/growth/pro/boutique) if the Stripe subscription is in a paid
 * state; otherwise falls back to "agency_solo" — the schema default and the
 * free-while-trialing baseline.
 *
 * Looks up via the agency's `plan` enum + `stripeStatus` text. The
 * AgencyPlan enum is converted to the canonical plan literal at the boundary
 * (planFromAgencyEnum below).
 */
export async function getAgencyPlan(agencyId: string): Promise<PlanLiteral> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { plan: true, stripeStatus: true, stripePlan: true },
  });
  if (!agency) return "agency_solo";

  // If Stripe state is paid, prefer the explicit `stripePlan` literal — it's
  // what the webhook wrote and matches the price ID the customer pays for.
  // Fall back to the enum field if stripePlan is absent for any reason.
  if (agency.stripeStatus && PAID_STRIPE_STATUSES.has(agency.stripeStatus)) {
    if (agency.stripePlan && isAgencyPlanLiteral(agency.stripePlan)) {
      return agency.stripePlan;
    }
    return planFromAgencyEnum(agency.plan);
  }

  // Not in a paid state — implicit baseline. Agency.plan defaults to SOLO in
  // the schema; surface this rather than smb_free for agencies.
  return "agency_solo";
}

/**
 * Resolve the active plan for an SMB user. SMB tier mapping: stripePlan =
 * "smb_paid" and stripeStatus is paid → smb_paid; otherwise smb_free.
 */
export async function getSmbUserPlan(userId: string): Promise<PlanLiteral> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripePlan: true, stripeStatus: true },
  });
  if (!user) return "smb_free";
  if (
    user.stripeStatus &&
    PAID_STRIPE_STATUSES.has(user.stripeStatus) &&
    user.stripePlan === "smb_paid"
  ) {
    return "smb_paid";
  }
  return "smb_free";
}

/**
 * Convert the AgencyPlan enum value (uppercase) into the canonical plan
 * literal (lowercase + underscored). Kept local because the AgencyPlan enum
 * is a Prisma-generated type that's not always available at module load.
 */
function planFromAgencyEnum(
  plan: "SOLO" | "GROWTH" | "AGENCY_PRO" | "BOUTIQUE",
): PlanLiteral {
  switch (plan) {
    case "SOLO":
      return "agency_solo";
    case "GROWTH":
      return "agency_growth";
    case "AGENCY_PRO":
      return "agency_pro";
    case "BOUTIQUE":
      return "agency_boutique";
  }
}

/**
 * Narrow a free-form string (from Stripe metadata or DB) to a PlanLiteral
 * agency tier. Returns false for SMB or unknown values.
 */
function isAgencyPlanLiteral(
  value: string,
): value is "agency_solo" | "agency_growth" | "agency_pro" | "agency_boutique" {
  return (
    value === "agency_solo" ||
    value === "agency_growth" ||
    value === "agency_pro" ||
    value === "agency_boutique"
  );
}

// ---------------------------------------------------------------------------
// Server-side gate · throws FeatureGateError if missing
// ---------------------------------------------------------------------------

/**
 * Thrown by `requireFeature` when the caller's plan does not include the
 * requested feature. Route handlers map this to HTTP 403; server actions can
 * catch it to render a paywall component.
 */
export class FeatureGateError extends Error {
  readonly code = "feature_gate";
  constructor(
    public readonly feature: Feature,
    public readonly plan: PlanLiteral,
    public readonly upgradePaths: readonly PlanLiteral[],
  ) {
    super(
      `Feature "${feature}" not available on plan "${plan}". ` +
        `Upgrade to: ${upgradePaths.join(", ")}.`,
    );
    this.name = "FeatureGateError";
  }
}

/**
 * Server-side feature requirement. Looks up the active plan for the scope,
 * then throws FeatureGateError if the feature is not included. Returns
 * the active plan on success so callers can pass it onward.
 *
 *     // In a server action:
 *     const session = await auth();
 *     if (!session?.user) unauthorized();
 *     await requireFeature({ kind: "agency", id: agencyId }, "agency_bulk_actions");
 */
export async function requireFeature(
  scope: { kind: "agency"; id: string } | { kind: "smb"; id: string },
  feature: Feature,
): Promise<PlanLiteral> {
  const plan =
    scope.kind === "agency"
      ? await getAgencyPlan(scope.id)
      : await getSmbUserPlan(scope.id);
  if (!hasFeature(plan, feature)) {
    throw new FeatureGateError(
      feature,
      plan,
      [...FEATURE_REQUIREMENTS[feature]] as PlanLiteral[],
    );
  }
  return plan;
}

/**
 * Non-throwing variant. Returns the resolved plan and whether the feature is
 * available. Use in UI code that needs to conditionally render a paywall
 * card rather than redirect.
 */
export async function checkFeature(
  scope: { kind: "agency"; id: string } | { kind: "smb"; id: string },
  feature: Feature,
): Promise<{ plan: PlanLiteral; allowed: boolean }> {
  const plan =
    scope.kind === "agency"
      ? await getAgencyPlan(scope.id)
      : await getSmbUserPlan(scope.id);
  return { plan, allowed: hasFeature(plan, feature) };
}
