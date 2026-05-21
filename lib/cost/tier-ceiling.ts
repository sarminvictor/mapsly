// Tier ceiling · per-plan monthly cost cap enforcement.
//
// Purpose: cron handlers iterate over many businesses (review pulls,
// Lighthouse audits, SERP scans). Each external call burns dollars. Without
// a ceiling, a free-tier business with a slow site could rack up unbounded
// Lighthouse spend; an agency on the Solo plan could drain ten times their
// monthly subscription in API costs. This module is the gate.
//
// Architecture
// ------------
//
// 1. Each plan has a default monthly ceiling (USD) — see DEFAULT_CEILINGS.
//    These are the fallbacks when no row exists in the CostBudget table for
//    that scope. Operators can override per-scope by inserting CostBudget
//    rows (e.g. raise a specific agency's ceiling temporarily).
//
// 2. Per-scope spend is summed from CronRun.costUsd over the current
//    calendar month, filtered to runs whose `meta` JSON carries the matching
//    scope identifier. Cron handlers attribute spend to a scope by writing
//    `meta = { scope: "agency-<id>" }` (or `smb-<userId>`, etc.) when they
//    close the CronRun. Until that attribution exists for a given handler,
//    its spend is counted only under the implicit "global" scope.
//
// 3. `shouldSkipForCeiling(scope)` is the runtime gate: callers (cron
//    handlers iterating per-business) ask "am I over budget for this
//    business's plan scope?" and skip the business if so. The returned
//    object carries the numbers so the caller can log/emit telemetry.
//
// 4. `DEFAULT_CEILINGS` is deliberately conservative — operators see the
//    cron run skip in CronRun.meta + Notification and decide whether to
//    raise the row, not the code.
//
// No-live-API discipline: nothing in this module reaches an external API.
// Per .claude/rules/cost-discipline.md a Prisma read in this function is
// fine even from a user request path — it's just our own DB.

import prisma from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Plan literals — single source of truth shared with modules/billing/plans.ts
// ---------------------------------------------------------------------------

/**
 * Canonical plan literal for ceiling/feature purposes. Mirrors the values in
 * modules/billing/plans.ts but extended with the implicit "smb_free" tier
 * (no paid Stripe subscription, gets the most conservative cap).
 */
export type PlanLiteral =
  | "smb_free"
  | "smb_paid"
  | "agency_solo"
  | "agency_growth"
  | "agency_pro"
  | "agency_boutique";

/** All plan literals in declared order. */
export const PLAN_LITERALS: readonly PlanLiteral[] = [
  "smb_free",
  "smb_paid",
  "agency_solo",
  "agency_growth",
  "agency_pro",
  "agency_boutique",
] as const;

// ---------------------------------------------------------------------------
// Ceiling table — defaults if no CostBudget row exists for the scope
// ---------------------------------------------------------------------------

/**
 * Default monthly cost ceilings per plan (USD). Operators can override these
 * by inserting a CostBudget row keyed by the scope string (see scopeForPlan).
 *
 * Reasoning behind the values:
 *
 *  - smb_free      $0      — free tier never burns paid API quota.
 *  - smb_paid      $15     — at $29/mo retail, leave ~$14 margin minus other
 *                            shared costs (Stripe fee, Vercel, etc.)
 *  - agency_solo   $30     — $49/mo retail, agencies typically scan 50-100
 *                            prospects/mo at ~$0.30 each.
 *  - agency_growth $75     — $99/mo retail, more prospects per month.
 *  - agency_pro    $200    — $249/mo retail, bulk-action heavy.
 *  - agency_boutique $500  — $499/mo retail; enterprise tier, large scans.
 */
export const DEFAULT_CEILINGS: Record<
  PlanLiteral,
  { monthlyUsd: number; dailyUsd: number }
> = {
  smb_free: { monthlyUsd: 0, dailyUsd: 0 },
  smb_paid: { monthlyUsd: 15, dailyUsd: 1.5 },
  agency_solo: { monthlyUsd: 30, dailyUsd: 3 },
  agency_growth: { monthlyUsd: 75, dailyUsd: 7.5 },
  agency_pro: { monthlyUsd: 200, dailyUsd: 20 },
  agency_boutique: { monthlyUsd: 500, dailyUsd: 50 },
};

// ---------------------------------------------------------------------------
// Scope identifiers — keys for CostBudget overrides + CronRun.meta attribution
// ---------------------------------------------------------------------------

/**
 * Map a plan literal to its CostBudget.scope key. Operators set per-plan
 * overrides under these scopes; per-instance overrides use the specific
 * scope (e.g. "agency-<id>") which is checked first.
 */
export function scopeForPlan(plan: PlanLiteral): string {
  switch (plan) {
    case "smb_free":
      return "smb-free";
    case "smb_paid":
      return "smb-paid";
    case "agency_solo":
      return "agency-solo";
    case "agency_growth":
      return "agency-growth";
    case "agency_pro":
      return "agency-pro";
    case "agency_boutique":
      return "agency-boutique";
  }
}

/**
 * The specific entity scope key for CronRun.meta attribution. Cron handlers
 * write this string to `meta.scope` so the monthly aggregator can attribute
 * spend back to the agency or SMB user.
 */
export function entityScope(kind: "agency" | "smb", id: string): string {
  return `${kind}-${id}`;
}

// ---------------------------------------------------------------------------
// CostBudget lookup with fallback to DEFAULT_CEILINGS
// ---------------------------------------------------------------------------

export interface CeilingValues {
  monthlyUsd: number;
  dailyUsd: number;
  haltThresholdPct: number;
  alertThresholdPct: number;
  source: "override" | "default";
}

/**
 * Resolve the ceiling for a plan. Checks CostBudget table first (allows ops
 * overrides), falls back to DEFAULT_CEILINGS. The optional `entityScope`
 * argument lets a per-agency or per-SMB override take precedence over the
 * plan-level row.
 *
 * Returns the resolved values + which source produced them (override or
 * default) so callers can log the resolution path.
 */
export async function getCeiling(
  plan: PlanLiteral,
  scopeOverride?: string,
): Promise<CeilingValues> {
  const planScope = scopeForPlan(plan);
  const scopes = scopeOverride ? [scopeOverride, planScope] : [planScope];

  // Two queries are cheap (CostBudget has unique index on scope); first hit
  // wins. Skipping the loop with findFirst({ scope: { in } }) doesn't preserve
  // priority order on Postgres without an explicit ORDER BY case.
  for (const scope of scopes) {
    const row = await prisma.costBudget.findUnique({ where: { scope } });
    if (row) {
      return {
        monthlyUsd: row.monthlyBudgetUsd ?? DEFAULT_CEILINGS[plan].monthlyUsd,
        dailyUsd: row.dailyBudgetUsd,
        haltThresholdPct: row.haltThresholdPct,
        alertThresholdPct: row.alertThresholdPct,
        source: "override",
      };
    }
  }

  const def = DEFAULT_CEILINGS[plan];
  return {
    monthlyUsd: def.monthlyUsd,
    dailyUsd: def.dailyUsd,
    haltThresholdPct: 1.0,
    alertThresholdPct: 0.8,
    source: "default",
  };
}

// ---------------------------------------------------------------------------
// Spend aggregator — sums CronRun.costUsd by scope over the current month
// ---------------------------------------------------------------------------

/**
 * Return the start of the current calendar month in UTC. Pulled out so tests
 * can inject `now` deterministically.
 */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Return the start of today in UTC.
 */
export function dayStart(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export interface SpendSummary {
  monthUsd: number;
  todayUsd: number;
}

/**
 * Sum CronRun.costUsd over the current month and today for runs whose
 * `meta.scope` matches `scope`. Uses Postgres JSON path operator so the
 * filter can be index-assisted in the future (a partial index on
 * `(meta->>'scope')` is the natural follow-up if these queries grow hot).
 *
 * Today and month are queried in one round trip via $queryRaw for efficiency
 * — two separate Prisma calls would each open a connection.
 */
export async function getScopeSpend(
  scope: string,
  now: Date = new Date(),
): Promise<SpendSummary> {
  const since = monthStart(now);
  const startOfDay = dayStart(now);

  const rows = await prisma.$queryRaw<
    Array<{ month_usd: string | null; today_usd: string | null }>
  >`
    SELECT
      COALESCE(SUM("costUsd") FILTER (WHERE "startedAt" >= ${since}), 0)::text AS month_usd,
      COALESCE(SUM("costUsd") FILTER (WHERE "startedAt" >= ${startOfDay}), 0)::text AS today_usd
    FROM "CronRun"
    WHERE "startedAt" >= ${since}
      AND "meta" IS NOT NULL
      AND "meta"->>'scope' = ${scope}
  `;

  const row = rows[0];
  return {
    monthUsd: row ? Number(row.month_usd ?? 0) : 0,
    todayUsd: row ? Number(row.today_usd ?? 0) : 0,
  };
}

// ---------------------------------------------------------------------------
// The runtime gate
// ---------------------------------------------------------------------------

export interface CeilingCheck {
  skip: boolean;
  reason: "month_exceeded" | "day_exceeded" | "ok";
  spendMonthUsd: number;
  spendTodayUsd: number;
  ceilingMonthUsd: number;
  ceilingDayUsd: number;
  ratio: number; // spendMonth / ceilingMonth (or Infinity if ceiling is 0)
  scope: string;
  source: "override" | "default";
}

/**
 * The gate called by cron handlers per-business / per-prospect:
 *
 *     const check = await shouldSkipForCeiling({ plan, scope });
 *     if (check.skip) {
 *       run.meta.skippedBusinesses.push({ businessId, reason: check.reason });
 *       continue;
 *     }
 *
 * Order of evaluation: monthly cap first (the harder limit), then daily.
 * Both checks honour the configured haltThresholdPct (default 1.0).
 *
 * If the plan literal's monthly ceiling is 0 (smb_free), this returns skip=true
 * with reason='month_exceeded' immediately — free tier has no live cron spend.
 */
export async function shouldSkipForCeiling(args: {
  plan: PlanLiteral;
  scope?: string;
  now?: Date;
}): Promise<CeilingCheck> {
  const { plan, scope, now } = args;
  const effectiveScope = scope ?? scopeForPlan(plan);
  const ceiling = await getCeiling(plan, effectiveScope);

  // Free tier (or any plan whose ceiling is 0) is hard-blocked.
  if (ceiling.monthlyUsd <= 0) {
    return {
      skip: true,
      reason: "month_exceeded",
      spendMonthUsd: 0,
      spendTodayUsd: 0,
      ceilingMonthUsd: ceiling.monthlyUsd,
      ceilingDayUsd: ceiling.dailyUsd,
      ratio: Infinity,
      scope: effectiveScope,
      source: ceiling.source,
    };
  }

  const spend = await getScopeSpend(effectiveScope, now);

  const monthHalt = ceiling.monthlyUsd * ceiling.haltThresholdPct;
  const dayHalt = ceiling.dailyUsd * ceiling.haltThresholdPct;

  if (spend.monthUsd >= monthHalt) {
    return {
      skip: true,
      reason: "month_exceeded",
      spendMonthUsd: spend.monthUsd,
      spendTodayUsd: spend.todayUsd,
      ceilingMonthUsd: ceiling.monthlyUsd,
      ceilingDayUsd: ceiling.dailyUsd,
      ratio: spend.monthUsd / ceiling.monthlyUsd,
      scope: effectiveScope,
      source: ceiling.source,
    };
  }

  if (spend.todayUsd >= dayHalt) {
    return {
      skip: true,
      reason: "day_exceeded",
      spendMonthUsd: spend.monthUsd,
      spendTodayUsd: spend.todayUsd,
      ceilingMonthUsd: ceiling.monthlyUsd,
      ceilingDayUsd: ceiling.dailyUsd,
      ratio: spend.monthUsd / ceiling.monthlyUsd,
      scope: effectiveScope,
      source: ceiling.source,
    };
  }

  return {
    skip: false,
    reason: "ok",
    spendMonthUsd: spend.monthUsd,
    spendTodayUsd: spend.todayUsd,
    ceilingMonthUsd: ceiling.monthlyUsd,
    ceilingDayUsd: ceiling.dailyUsd,
    ratio: spend.monthUsd / ceiling.monthlyUsd,
    scope: effectiveScope,
    source: ceiling.source,
  };
}

/**
 * Alert threshold helper. Returns true when spend has crossed
 * alertThresholdPct of the ceiling but not yet the halt — useful for the
 * loop to surface a soft warning notification before the hard skip.
 */
export async function shouldAlertForCeiling(args: {
  plan: PlanLiteral;
  scope?: string;
  now?: Date;
}): Promise<{
  alert: boolean;
  ratio: number;
  threshold: number;
  scope: string;
}> {
  const { plan, scope, now } = args;
  const effectiveScope = scope ?? scopeForPlan(plan);
  const ceiling = await getCeiling(plan, effectiveScope);
  if (ceiling.monthlyUsd <= 0) {
    return {
      alert: false,
      ratio: 0,
      threshold: ceiling.alertThresholdPct,
      scope: effectiveScope,
    };
  }
  const spend = await getScopeSpend(effectiveScope, now);
  const ratio = spend.monthUsd / ceiling.monthlyUsd;
  return {
    alert:
      ratio >= ceiling.alertThresholdPct && ratio < ceiling.haltThresholdPct,
    ratio,
    threshold: ceiling.alertThresholdPct,
    scope: effectiveScope,
  };
}
