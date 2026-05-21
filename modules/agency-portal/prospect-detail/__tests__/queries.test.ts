/**
 * Invariants for `modules/agency-portal/prospect-detail/queries.ts`.
 *
 * Three layers covered:
 *
 *  1. **EMPTY shape contract** — `EMPTY_PROSPECT_DETAIL` carries every
 *     key of `AgencyProspectDetailData` (per
 *     `.claude/rules/cache-components.md` Pattern 1 / INC-25).
 *
 *  2. **Build-phase short-circuit** — under
 *     `NEXT_PHASE === 'phase-production-build'`,
 *     `getAgencyProspectDetailData` returns `EMPTY_PROSPECT_DETAIL`
 *     without touching the database — Vercel's build worker cannot
 *     open Neon WebSockets (INC-27).
 *
 *  3. **Pure pitch-wedge derivation** — `derivePitchWedges` always
 *     emits exactly 4 wedges, ordered critical → warn → ok, padded
 *     with deterministic fallbacks when fewer real wedges exist.
 *
 * Per `.claude/rules/testing.md` §"Snapshot tests for compute
 * formulas" the boundary cases are pinned with explicit expectations
 * so the next refactor that nudges the thresholds surfaces in the
 * diff.
 *
 * `@/lib/prisma` is mocked at the top so the queries module can be
 * imported in vitest without a generated Prisma client. The build-
 * phase test never hits prisma anyway (early return), but other code
 * paths in the file would.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock prisma BEFORE importing queries (vi.mock is hoisted, but the
// pattern stays explicit so a future refactor doesn't accidentally
// trip the real import).
// `next/cache` apis (`cacheLife`, `cacheTag`) are no-ops outside the Next
// runtime; we stub them so the queries module is importable in vitest.
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_noStore: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    agencyMember: { findMany: vi.fn().mockResolvedValue([]) },
    lead: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    business: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import {
  derivePitchWedges,
  formatAddress,
  getAgencyProspectDetailData,
} from "../queries";
import {
  EMPTY_PROSPECT_DETAIL,
  type AgencyProspectDetailData,
} from "../types";

/* ---------------- EMPTY_PROSPECT_DETAIL contract ---------------- */

describe("EMPTY_PROSPECT_DETAIL", () => {
  test("carries every key of AgencyProspectDetailData (Pattern 1)", () => {
    // If the type adds a new field, this test must fail until
    // EMPTY_PROSPECT_DETAIL adds the matching default.
    const empty: AgencyProspectDetailData = EMPTY_PROSPECT_DETAIL;
    expect(Object.keys(empty).sort()).toEqual([
      "nextProspectId",
      "prevProspectId",
      "prospect",
    ]);
    expect(empty.prospect).toBeNull();
    expect(empty.prevProspectId).toBeNull();
    expect(empty.nextProspectId).toBeNull();
  });
});

/* ---------------- build-phase short-circuit ---------------- */

describe("getAgencyProspectDetailData · build-phase short-circuit", () => {
  let savedPhase: string | undefined;

  beforeEach(() => {
    savedPhase = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";
  });
  afterEach(() => {
    if (savedPhase === undefined) {
      delete process.env.NEXT_PHASE;
    } else {
      process.env.NEXT_PHASE = savedPhase;
    }
  });

  test("returns EMPTY_PROSPECT_DETAIL during the Vercel build phase", async () => {
    const result = await getAgencyProspectDetailData("any-biz-id", "any-user");
    expect(result).toEqual(EMPTY_PROSPECT_DETAIL);
  });

  test("returns EMPTY_PROSPECT_DETAIL when ids are empty/invalid", async () => {
    // Even outside the build phase, missing ids short-circuit. Reset
    // first so the next assertion isn't masked by the phase guard.
    delete process.env.NEXT_PHASE;
    const noBusiness = await getAgencyProspectDetailData("", "user");
    expect(noBusiness).toEqual(EMPTY_PROSPECT_DETAIL);
    const noUser = await getAgencyProspectDetailData("biz", "");
    expect(noUser).toEqual(EMPTY_PROSPECT_DETAIL);
  });

  test("returns EMPTY_PROSPECT_DETAIL when user has no agency memberships", async () => {
    delete process.env.NEXT_PHASE;
    // The default mock already returns [] from agencyMember.findMany
    // — the function should short-circuit to EMPTY without throwing.
    const out = await getAgencyProspectDetailData("biz-id", "user-id");
    expect(out).toEqual(EMPTY_PROSPECT_DETAIL);
  });
});

/* ---------------- formatAddress ---------------- */

describe("formatAddress", () => {
  test("joins all parts with mono separator", () => {
    expect(
      formatAddress({
        address: "701 S Miami Ave",
        city: "Miami",
        province: "FL",
      }),
    ).toBe("701 S Miami Ave · Miami · FL");
  });
  test("drops missing parts", () => {
    expect(
      formatAddress({ address: null, city: "Miami", province: null }),
    ).toBe("Miami");
    expect(
      formatAddress({ address: null, city: null, province: null }),
    ).toBe("");
  });
});

/* ---------------- derivePitchWedges ---------------- */

describe("derivePitchWedges", () => {
  test("always emits exactly 4 wedges", () => {
    const out = derivePitchWedges({
      rating: 4.4,
      reviewCount: 342,
      category: "medical_spa",
      city: "Miami",
      communicationScore: 0,
      profileCompleteness: 0.5,
      mapslyScore: 6.2,
      msiRank: 37,
      msiTotal: 40,
      performance: 58,
      lcpMs: 3400,
      hasLocalBusinessSchema: false,
      napConsistent: false,
    });
    expect(out.length).toBe(4);
  });

  test("orders critical → warn → ok", () => {
    const out = derivePitchWedges({
      rating: 4.6,
      reviewCount: 300,
      category: "med-spa",
      city: "Miami",
      communicationScore: 0.1, // critical
      profileCompleteness: 0.5, // warn
      mapslyScore: 7.5, // ok
      msiRank: null,
      msiTotal: null,
      performance: 55, // warn
      lcpMs: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
    });
    const rank = { critical: 0, warn: 1, ok: 2 } as const;
    for (let i = 1; i < out.length; i++) {
      expect(rank[out[i]!.severity]).toBeGreaterThanOrEqual(
        rank[out[i - 1]!.severity],
      );
    }
  });

  test("pads with deterministic 'ok' fallbacks when no real wedges fire", () => {
    const out = derivePitchWedges({
      rating: null,
      reviewCount: 0,
      category: null,
      city: null,
      communicationScore: null,
      profileCompleteness: null,
      mapslyScore: null,
      msiRank: null,
      msiTotal: null,
      performance: null,
      lcpMs: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
    });
    expect(out.length).toBe(4);
    expect(out.every((w) => w.severity === "ok")).toBe(true);
  });

  test("low reply-rate + high review count yields critical wedge with concrete count", () => {
    const out = derivePitchWedges({
      rating: 4.4,
      reviewCount: 100,
      category: "med-spa",
      city: "Miami",
      communicationScore: 0, // 0%
      profileCompleteness: null,
      mapslyScore: null,
      msiRank: null,
      msiTotal: null,
      performance: null,
      lcpMs: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
    });
    const critical = out.find((w) => w.severity === "critical");
    expect(critical).toBeDefined();
    expect(critical!.headline).toContain("0%");
    expect(critical!.headline).toContain("100");
  });
});
