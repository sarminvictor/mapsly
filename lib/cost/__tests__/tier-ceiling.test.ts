// Unit tests for tier-ceiling — per-plan monthly/daily cost caps.
//
// Strategy mirrors cost-counter.test.ts: vi.mock("@/lib/prisma") with a
// hand-rolled in-memory fake so the tests don't need a real database. The
// fake records CostBudget rows + simulates the $queryRaw spend aggregation
// against an in-memory CronRun array.

import { beforeEach, describe, expect, test, vi } from "vitest";

// ---- Mock setup ---------------------------------------------------------

interface CostBudgetRow {
  scope: string;
  dailyBudgetUsd: number;
  weeklyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  alertThresholdPct: number;
  haltThresholdPct: number;
}

interface CronRunRow {
  id: string;
  costUsd: number | null;
  startedAt: Date;
  meta: { scope?: string } | null;
}

const fake = {
  budgets: new Map<string, CostBudgetRow>(),
  runs: [] as CronRunRow[],
  reset() {
    this.budgets.clear();
    this.runs = [];
  },
};

// Simulate the Postgres SUM FILTER aggregation against the in-memory runs.
function aggregateSpend(scope: string, since: Date, startOfDay: Date) {
  let monthUsd = 0;
  let todayUsd = 0;
  for (const r of fake.runs) {
    if (r.meta?.scope !== scope) continue;
    if (r.startedAt < since) continue;
    monthUsd += r.costUsd ?? 0;
    if (r.startedAt >= startOfDay) todayUsd += r.costUsd ?? 0;
  }
  return [{ month_usd: monthUsd.toString(), today_usd: todayUsd.toString() }];
}

vi.mock("@/lib/prisma", () => ({
  default: {
    costBudget: {
      findUnique: vi.fn(async ({ where }: { where: { scope: string } }) => {
        return fake.budgets.get(where.scope) ?? null;
      }),
    },
    // $queryRaw is invoked as a template tag — vitest sees the first arg as
    // a TemplateStringsArray and the rest as interpolated values.
    $queryRaw: vi.fn(
      async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        // The implementation passes (since, startOfDay, since, startOfDay, scope)
        // in that order — see tier-ceiling.ts. We just parse them out.
        const since = values[0] as Date;
        const startOfDay = values[1] as Date;
        const scope = values[values.length - 1] as string;
        return aggregateSpend(scope, since, startOfDay);
      },
    ),
  },
}));

// Imports must come AFTER vi.mock — hoisted.
import {
  DEFAULT_CEILINGS,
  PLAN_LITERALS,
  dayStart,
  entityScope,
  getCeiling,
  getScopeSpend,
  monthStart,
  scopeForPlan,
  shouldAlertForCeiling,
  shouldSkipForCeiling,
  type PlanLiteral,
} from "@/lib/cost/tier-ceiling";

beforeEach(() => {
  fake.reset();
});

// ---- Plan literal sanity ------------------------------------------------

describe("PLAN_LITERALS + DEFAULT_CEILINGS", () => {
  test("every plan literal has a defined ceiling", () => {
    for (const p of PLAN_LITERALS) {
      expect(DEFAULT_CEILINGS[p]).toBeDefined();
      expect(DEFAULT_CEILINGS[p].monthlyUsd).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_CEILINGS[p].dailyUsd).toBeGreaterThanOrEqual(0);
    }
  });

  test("ceiling table is strictly increasing across the agency ladder", () => {
    expect(DEFAULT_CEILINGS.agency_solo.monthlyUsd).toBeLessThan(
      DEFAULT_CEILINGS.agency_growth.monthlyUsd,
    );
    expect(DEFAULT_CEILINGS.agency_growth.monthlyUsd).toBeLessThan(
      DEFAULT_CEILINGS.agency_pro.monthlyUsd,
    );
    expect(DEFAULT_CEILINGS.agency_pro.monthlyUsd).toBeLessThan(
      DEFAULT_CEILINGS.agency_boutique.monthlyUsd,
    );
  });

  test("smb_free has zero ceiling", () => {
    expect(DEFAULT_CEILINGS.smb_free.monthlyUsd).toBe(0);
    expect(DEFAULT_CEILINGS.smb_free.dailyUsd).toBe(0);
  });
});

// ---- Scope helpers ------------------------------------------------------

describe("scopeForPlan + entityScope", () => {
  test("scopeForPlan produces the documented keys", () => {
    expect(scopeForPlan("smb_free")).toBe("smb-free");
    expect(scopeForPlan("smb_paid")).toBe("smb-paid");
    expect(scopeForPlan("agency_solo")).toBe("agency-solo");
    expect(scopeForPlan("agency_growth")).toBe("agency-growth");
    expect(scopeForPlan("agency_pro")).toBe("agency-pro");
    expect(scopeForPlan("agency_boutique")).toBe("agency-boutique");
  });

  test("entityScope concatenates kind and id", () => {
    expect(entityScope("agency", "abc123")).toBe("agency-abc123");
    expect(entityScope("smb", "user_xyz")).toBe("smb-user_xyz");
  });
});

// ---- monthStart / dayStart ---------------------------------------------

describe("monthStart + dayStart", () => {
  test("monthStart pins to UTC 00:00 of day 1", () => {
    const start = monthStart(new Date("2026-05-21T18:55:00.000Z"));
    expect(start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  test("dayStart pins to UTC 00:00 of today", () => {
    const start = dayStart(new Date("2026-05-21T18:55:00.000Z"));
    expect(start.toISOString()).toBe("2026-05-21T00:00:00.000Z");
  });
});

// ---- getCeiling --------------------------------------------------------

describe("getCeiling", () => {
  test("returns DEFAULT_CEILINGS when no CostBudget row exists", async () => {
    const ceiling = await getCeiling("agency_solo");
    expect(ceiling.source).toBe("default");
    expect(ceiling.monthlyUsd).toBe(DEFAULT_CEILINGS.agency_solo.monthlyUsd);
    expect(ceiling.dailyUsd).toBe(DEFAULT_CEILINGS.agency_solo.dailyUsd);
    expect(ceiling.haltThresholdPct).toBe(1.0);
    expect(ceiling.alertThresholdPct).toBe(0.8);
  });

  test("returns override values when a plan-scope CostBudget row exists", async () => {
    fake.budgets.set("agency-pro", {
      scope: "agency-pro",
      dailyBudgetUsd: 50,
      weeklyBudgetUsd: 200,
      monthlyBudgetUsd: 700,
      alertThresholdPct: 0.7,
      haltThresholdPct: 0.95,
    });
    const ceiling = await getCeiling("agency_pro");
    expect(ceiling.source).toBe("override");
    expect(ceiling.monthlyUsd).toBe(700);
    expect(ceiling.dailyUsd).toBe(50);
    expect(ceiling.alertThresholdPct).toBe(0.7);
    expect(ceiling.haltThresholdPct).toBe(0.95);
  });

  test("entity-scope override beats plan-scope override", async () => {
    fake.budgets.set("agency-pro", {
      scope: "agency-pro",
      dailyBudgetUsd: 50,
      weeklyBudgetUsd: null,
      monthlyBudgetUsd: 700,
      alertThresholdPct: 0.8,
      haltThresholdPct: 1.0,
    });
    fake.budgets.set("agency-xyz", {
      scope: "agency-xyz",
      dailyBudgetUsd: 100,
      weeklyBudgetUsd: null,
      monthlyBudgetUsd: 1500,
      alertThresholdPct: 0.9,
      haltThresholdPct: 1.0,
    });
    const ceiling = await getCeiling("agency_pro", "agency-xyz");
    expect(ceiling.source).toBe("override");
    expect(ceiling.monthlyUsd).toBe(1500);
    expect(ceiling.dailyUsd).toBe(100);
  });

  test("monthlyBudgetUsd null in override falls back to DEFAULT_CEILINGS", async () => {
    fake.budgets.set("agency-growth", {
      scope: "agency-growth",
      dailyBudgetUsd: 99,
      weeklyBudgetUsd: null,
      monthlyBudgetUsd: null, // explicit null
      alertThresholdPct: 0.8,
      haltThresholdPct: 1.0,
    });
    const ceiling = await getCeiling("agency_growth");
    expect(ceiling.source).toBe("override");
    expect(ceiling.dailyUsd).toBe(99);
    expect(ceiling.monthlyUsd).toBe(
      DEFAULT_CEILINGS.agency_growth.monthlyUsd, // fallback to default
    );
  });
});

// ---- getScopeSpend -----------------------------------------------------

describe("getScopeSpend", () => {
  test("zero when no matching runs", async () => {
    const spend = await getScopeSpend(
      "agency-abc",
      new Date("2026-05-21T18:55:00.000Z"),
    );
    expect(spend.monthUsd).toBe(0);
    expect(spend.todayUsd).toBe(0);
  });

  test("sums month + today across matching runs", async () => {
    fake.runs.push(
      {
        id: "r1",
        costUsd: 5,
        startedAt: new Date("2026-05-05T10:00:00.000Z"),
        meta: { scope: "agency-abc" },
      },
      {
        id: "r2",
        costUsd: 3,
        startedAt: new Date("2026-05-21T08:00:00.000Z"),
        meta: { scope: "agency-abc" },
      },
      {
        id: "r3",
        costUsd: 100, // different scope, must NOT contribute
        startedAt: new Date("2026-05-15T10:00:00.000Z"),
        meta: { scope: "agency-other" },
      },
    );
    const spend = await getScopeSpend(
      "agency-abc",
      new Date("2026-05-21T18:55:00.000Z"),
    );
    expect(spend.monthUsd).toBeCloseTo(8, 8);
    expect(spend.todayUsd).toBeCloseTo(3, 8);
  });

  test("excludes runs from prior month", async () => {
    fake.runs.push({
      id: "r-prev",
      costUsd: 999,
      startedAt: new Date("2026-04-30T23:59:00.000Z"),
      meta: { scope: "agency-abc" },
    });
    const spend = await getScopeSpend(
      "agency-abc",
      new Date("2026-05-21T18:55:00.000Z"),
    );
    expect(spend.monthUsd).toBe(0);
  });
});

// ---- shouldSkipForCeiling ----------------------------------------------

describe("shouldSkipForCeiling", () => {
  const NOW = new Date("2026-05-21T18:55:00.000Z");

  test("free tier (smb_free) is always blocked", async () => {
    const check = await shouldSkipForCeiling({ plan: "smb_free", now: NOW });
    expect(check.skip).toBe(true);
    expect(check.reason).toBe("month_exceeded");
    expect(check.ceilingMonthUsd).toBe(0);
  });

  test("paid plan with no spend → not skipped", async () => {
    const check = await shouldSkipForCeiling({
      plan: "agency_solo",
      scope: entityScope("agency", "abc"),
      now: NOW,
    });
    expect(check.skip).toBe(false);
    expect(check.reason).toBe("ok");
    expect(check.ratio).toBe(0);
  });

  test("month spend over halt threshold → skip with month_exceeded", async () => {
    fake.runs.push({
      id: "burned",
      costUsd: DEFAULT_CEILINGS.agency_solo.monthlyUsd + 0.01,
      startedAt: new Date("2026-05-10T10:00:00.000Z"),
      meta: { scope: "agency-abc" },
    });
    const check = await shouldSkipForCeiling({
      plan: "agency_solo",
      scope: "agency-abc",
      now: NOW,
    });
    expect(check.skip).toBe(true);
    expect(check.reason).toBe("month_exceeded");
    expect(check.ratio).toBeGreaterThan(1);
  });

  test("day spend over daily halt → skip with day_exceeded (month still OK)", async () => {
    fake.runs.push({
      id: "today-burst",
      costUsd: DEFAULT_CEILINGS.agency_solo.dailyUsd + 0.01,
      startedAt: new Date("2026-05-21T08:00:00.000Z"),
      meta: { scope: "agency-abc" },
    });
    const check = await shouldSkipForCeiling({
      plan: "agency_solo",
      scope: "agency-abc",
      now: NOW,
    });
    expect(check.skip).toBe(true);
    expect(check.reason).toBe("day_exceeded");
  });

  test("honors override haltThresholdPct (e.g. 0.5)", async () => {
    fake.budgets.set("agency-abc", {
      scope: "agency-abc",
      dailyBudgetUsd: 100,
      weeklyBudgetUsd: null,
      monthlyBudgetUsd: 100,
      alertThresholdPct: 0.3,
      haltThresholdPct: 0.5,
    });
    fake.runs.push({
      id: "halfway",
      costUsd: 51,
      startedAt: new Date("2026-05-10T10:00:00.000Z"),
      meta: { scope: "agency-abc" },
    });
    const check = await shouldSkipForCeiling({
      plan: "agency_solo",
      scope: "agency-abc",
      now: NOW,
    });
    expect(check.skip).toBe(true);
    expect(check.reason).toBe("month_exceeded"); // halt is 50 → 51 trips
  });
});

// ---- shouldAlertForCeiling ---------------------------------------------

describe("shouldAlertForCeiling", () => {
  const NOW = new Date("2026-05-21T18:55:00.000Z");

  test("returns alert=true when above alertThreshold but below halt", async () => {
    fake.runs.push({
      id: "warning-zone",
      costUsd: DEFAULT_CEILINGS.agency_solo.monthlyUsd * 0.85,
      startedAt: new Date("2026-05-10T10:00:00.000Z"),
      meta: { scope: "agency-abc" },
    });
    const a = await shouldAlertForCeiling({
      plan: "agency_solo",
      scope: "agency-abc",
      now: NOW,
    });
    expect(a.alert).toBe(true);
    expect(a.ratio).toBeGreaterThan(0.8);
    expect(a.ratio).toBeLessThan(1.0);
  });

  test("returns alert=false when below alertThreshold", async () => {
    fake.runs.push({
      id: "low",
      costUsd: DEFAULT_CEILINGS.agency_solo.monthlyUsd * 0.5,
      startedAt: new Date("2026-05-10T10:00:00.000Z"),
      meta: { scope: "agency-abc" },
    });
    const a = await shouldAlertForCeiling({
      plan: "agency_solo",
      scope: "agency-abc",
      now: NOW,
    });
    expect(a.alert).toBe(false);
  });

  test("returns alert=false when above halt (skip takes over)", async () => {
    fake.runs.push({
      id: "over",
      costUsd: DEFAULT_CEILINGS.agency_solo.monthlyUsd + 1,
      startedAt: new Date("2026-05-10T10:00:00.000Z"),
      meta: { scope: "agency-abc" },
    });
    const a = await shouldAlertForCeiling({
      plan: "agency_solo",
      scope: "agency-abc",
      now: NOW,
    });
    expect(a.alert).toBe(false); // halt path, not alert
  });

  test("free tier never alerts", async () => {
    const a = await shouldAlertForCeiling({
      plan: "smb_free" as PlanLiteral,
      now: NOW,
    });
    expect(a.alert).toBe(false);
  });
});
