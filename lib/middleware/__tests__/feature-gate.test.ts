// Unit tests for feature-gate · plan-based capability checks.

import { beforeEach, describe, expect, test, vi } from "vitest";

interface AgencyRow {
  id: string;
  plan: "SOLO" | "GROWTH" | "AGENCY_PRO" | "BOUTIQUE";
  stripeStatus: string | null;
  stripePlan: string | null;
}

interface UserRow {
  id: string;
  stripePlan: string | null;
  stripeStatus: string | null;
}

const fake = {
  agencies: new Map<string, AgencyRow>(),
  users: new Map<string, UserRow>(),
  reset() {
    this.agencies.clear();
    this.users.clear();
  },
};

vi.mock("@/lib/prisma", () => ({
  default: {
    agency: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return fake.agencies.get(where.id) ?? null;
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return fake.users.get(where.id) ?? null;
      }),
    },
  },
}));

import {
  FEATURES,
  FEATURE_REQUIREMENTS,
  FeatureGateError,
  checkFeature,
  featuresForPlan,
  getAgencyPlan,
  getSmbUserPlan,
  hasFeature,
  requireFeature,
} from "@/lib/middleware/feature-gate";

beforeEach(() => {
  fake.reset();
});

// ---- Pure predicate -----------------------------------------------------

describe("hasFeature", () => {
  test("smb_paid has smb_ai_replies", () => {
    expect(hasFeature("smb_paid", "smb_ai_replies")).toBe(true);
  });

  test("smb_free does NOT have smb_ai_replies", () => {
    expect(hasFeature("smb_free", "smb_ai_replies")).toBe(false);
  });

  test("agency_solo has agency_lists but not agency_bulk_actions", () => {
    expect(hasFeature("agency_solo", "agency_lists")).toBe(true);
    expect(hasFeature("agency_solo", "agency_bulk_actions")).toBe(false);
  });

  test("agency_boutique has every agency feature", () => {
    for (const feature of FEATURES) {
      if (feature.startsWith("agency_")) {
        expect(hasFeature("agency_boutique", feature)).toBe(true);
      }
    }
  });

  test("agency_pro has agency_bulk_actions but not agency_white_label", () => {
    expect(hasFeature("agency_pro", "agency_bulk_actions")).toBe(true);
    expect(hasFeature("agency_pro", "agency_white_label")).toBe(false);
  });

  test("null plan returns false", () => {
    expect(hasFeature(null, "agency_lists")).toBe(false);
    expect(hasFeature(undefined, "agency_lists")).toBe(false);
  });

  test("agency tiers do NOT confer SMB features", () => {
    // A clean separation: agency tiers should not include smb_ai_replies
    // (the SMB AI reply UI is a different product surface). This invariant
    // catches accidental cross-pollination.
    expect(hasFeature("agency_solo", "smb_ai_replies")).toBe(false);
    expect(hasFeature("agency_boutique", "smb_ai_replies")).toBe(false);
  });
});

describe("featuresForPlan", () => {
  test("agency_solo includes lists / share / one_pager", () => {
    const features = featuresForPlan("agency_solo");
    expect(features).toContain("agency_lists");
    expect(features).toContain("agency_share_links");
    expect(features).toContain("agency_one_pager_pdf");
    expect(features).not.toContain("agency_bulk_actions");
    expect(features).not.toContain("agency_white_label");
  });

  test("agency_boutique gets the most features", () => {
    const counts = (["agency_solo", "agency_growth", "agency_pro", "agency_boutique"] as const).map(
      (p) => featuresForPlan(p).length,
    );
    expect(counts[0]).toBeLessThan(counts[1]); // solo < growth
    expect(counts[1]).toBeLessThan(counts[2]); // growth < pro
    expect(counts[2]).toBeLessThan(counts[3]); // pro < boutique
  });
});

describe("FEATURE_REQUIREMENTS invariant", () => {
  test("every feature has at least one plan", () => {
    for (const feature of FEATURES) {
      expect(FEATURE_REQUIREMENTS[feature].size).toBeGreaterThan(0);
    }
  });
});

// ---- Plan resolution ---------------------------------------------------

describe("getAgencyPlan", () => {
  test("returns agency_solo when agency not found", async () => {
    const plan = await getAgencyPlan("nonexistent");
    expect(plan).toBe("agency_solo");
  });

  test("returns mapped plan when stripeStatus is active", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "AGENCY_PRO",
      stripeStatus: "active",
      stripePlan: "agency_pro",
    });
    const plan = await getAgencyPlan("a1");
    expect(plan).toBe("agency_pro");
  });

  test("falls back to agency_solo when stripeStatus is canceled", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "BOUTIQUE",
      stripeStatus: "canceled",
      stripePlan: "agency_boutique",
    });
    const plan = await getAgencyPlan("a1");
    expect(plan).toBe("agency_solo");
  });

  test("past_due still considered paid (Stripe grace period)", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "GROWTH",
      stripeStatus: "past_due",
      stripePlan: "agency_growth",
    });
    const plan = await getAgencyPlan("a1");
    expect(plan).toBe("agency_growth");
  });

  test("trialing also considered paid", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "AGENCY_PRO",
      stripeStatus: "trialing",
      stripePlan: "agency_pro",
    });
    const plan = await getAgencyPlan("a1");
    expect(plan).toBe("agency_pro");
  });

  test("prefers stripePlan over the enum field when both are present", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "SOLO",
      stripeStatus: "active",
      stripePlan: "agency_boutique", // webhook upgrade not yet reflected in enum
    });
    const plan = await getAgencyPlan("a1");
    expect(plan).toBe("agency_boutique");
  });

  test("ignores invalid stripePlan and falls back to enum", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "AGENCY_PRO",
      stripeStatus: "active",
      stripePlan: "smb_paid", // wrong audience
    });
    const plan = await getAgencyPlan("a1");
    expect(plan).toBe("agency_pro");
  });
});

describe("getSmbUserPlan", () => {
  test("returns smb_free when user not found", async () => {
    const plan = await getSmbUserPlan("nonexistent");
    expect(plan).toBe("smb_free");
  });

  test("returns smb_paid when stripePlan=smb_paid AND stripeStatus active", async () => {
    fake.users.set("u1", {
      id: "u1",
      stripePlan: "smb_paid",
      stripeStatus: "active",
    });
    const plan = await getSmbUserPlan("u1");
    expect(plan).toBe("smb_paid");
  });

  test("returns smb_free when stripeStatus is canceled", async () => {
    fake.users.set("u1", {
      id: "u1",
      stripePlan: "smb_paid",
      stripeStatus: "canceled",
    });
    const plan = await getSmbUserPlan("u1");
    expect(plan).toBe("smb_free");
  });

  test("returns smb_free when stripePlan is null", async () => {
    fake.users.set("u1", { id: "u1", stripePlan: null, stripeStatus: null });
    const plan = await getSmbUserPlan("u1");
    expect(plan).toBe("smb_free");
  });
});

// ---- requireFeature / checkFeature -------------------------------------

describe("requireFeature", () => {
  test("returns plan when feature is allowed", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "AGENCY_PRO",
      stripeStatus: "active",
      stripePlan: "agency_pro",
    });
    const plan = await requireFeature(
      { kind: "agency", id: "a1" },
      "agency_bulk_actions",
    );
    expect(plan).toBe("agency_pro");
  });

  test("throws FeatureGateError when feature is missing", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "SOLO",
      stripeStatus: "active",
      stripePlan: "agency_solo",
    });
    await expect(
      requireFeature({ kind: "agency", id: "a1" }, "agency_white_label"),
    ).rejects.toBeInstanceOf(FeatureGateError);
  });

  test("FeatureGateError carries feature + plan + upgradePaths", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "SOLO",
      stripeStatus: "active",
      stripePlan: "agency_solo",
    });
    try {
      await requireFeature({ kind: "agency", id: "a1" }, "agency_white_label");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FeatureGateError);
      const e = err as FeatureGateError;
      expect(e.feature).toBe("agency_white_label");
      expect(e.plan).toBe("agency_solo");
      expect(e.upgradePaths).toContain("agency_boutique");
      expect(e.code).toBe("feature_gate");
    }
  });

  test("SMB scope resolution works through requireFeature", async () => {
    fake.users.set("u1", {
      id: "u1",
      stripePlan: "smb_paid",
      stripeStatus: "active",
    });
    const plan = await requireFeature(
      { kind: "smb", id: "u1" },
      "smb_ai_replies",
    );
    expect(plan).toBe("smb_paid");
  });
});

describe("checkFeature", () => {
  test("returns allowed=true with resolved plan", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "BOUTIQUE",
      stripeStatus: "active",
      stripePlan: "agency_boutique",
    });
    const r = await checkFeature(
      { kind: "agency", id: "a1" },
      "agency_white_label",
    );
    expect(r.allowed).toBe(true);
    expect(r.plan).toBe("agency_boutique");
  });

  test("returns allowed=false with resolved plan", async () => {
    fake.agencies.set("a1", {
      id: "a1",
      plan: "SOLO",
      stripeStatus: "active",
      stripePlan: "agency_solo",
    });
    const r = await checkFeature(
      { kind: "agency", id: "a1" },
      "agency_white_label",
    );
    expect(r.allowed).toBe(false);
    expect(r.plan).toBe("agency_solo");
  });
});
