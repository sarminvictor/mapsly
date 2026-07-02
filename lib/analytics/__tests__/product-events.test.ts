// WP6-4 · tests for the activation-analytics rails.
//
// Two invariants worth locking:
//   - trackProductEvent is FIRE-AND-FORGET: it writes one ProductEvent row and,
//     crucially, NEVER throws (a DB hiccup must not break the user action that
//     emitted the event).
//   - getActivationSummary folds ProductEvent rows into an honest funnel:
//     time-to-aha (first activation → first drawer, median) + per-template
//     conversion (mapped market → committed spend), with no PII and safe empties.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { createMock, findManyMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    productEvent: { create: createMock, findMany: findManyMock },
  },
  // product-events imports { Prisma } for the InputJsonObject cast only.
  Prisma: {},
}));

import { trackProductEvent } from "../product-events";
import { getActivationSummary } from "../activation";

beforeEach(() => {
  createMock.mockReset();
  findManyMock.mockReset();
});

describe("trackProductEvent", () => {
  test("writes one row with the given type + ids", async () => {
    createMock.mockResolvedValue({ id: "e1" });
    await trackProductEvent({
      type: "enrich_started",
      agencyId: "a1",
      userId: "u1",
      props: { units: 12, families: 3 },
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.data.type).toBe("enrich_started");
    expect(arg.data.agencyId).toBe("a1");
    expect(arg.data.userId).toBe("u1");
    expect(arg.data.propsJson).toEqual({ units: 12, families: 3 });
  });

  test("nullifies missing agencyId/userId (anonymous events land)", async () => {
    createMock.mockResolvedValue({ id: "e2" });
    await trackProductEvent({ type: "signup" });
    const arg = createMock.mock.calls[0][0];
    expect(arg.data.agencyId).toBeNull();
    expect(arg.data.userId).toBeNull();
  });

  test("NEVER throws when the DB write fails (fire-and-forget)", async () => {
    createMock.mockRejectedValue(new Error("db down"));
    await expect(
      trackProductEvent({ type: "csv_exported", agencyId: "a1" }),
    ).resolves.toBeUndefined();
  });
});

describe("getActivationSummary", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 6, 1, 0, min, 0));

  test("empty window → all-zero summary, null median", async () => {
    findManyMock.mockResolvedValue([]);
    const s = await getActivationSummary(30, t(60));
    expect(s.agenciesSeen).toBe(0);
    expect(s.agenciesActivated).toBe(0);
    expect(s.agenciesEnriched).toBe(0);
    expect(s.timeToAhaMedianMin).toBeNull();
    expect(s.perTemplate).toEqual([]);
  });

  test("time-to-aha = median minutes from first activation → first drawer", async () => {
    findManyMock.mockResolvedValue([
      // agency A: created @0, drawer @10 → 10 min
      { agencyId: "A", type: "agency_created", createdAt: t(0), propsJson: {} },
      {
        agencyId: "A",
        type: "first_lead_drawer_opened",
        createdAt: t(10),
        propsJson: {},
      },
      // agency B: signup @0, drawer @30 → 30 min
      { agencyId: "B", type: "signup", createdAt: t(0), propsJson: {} },
      {
        agencyId: "B",
        type: "first_lead_drawer_opened",
        createdAt: t(30),
        propsJson: {},
      },
      // agency C: signup only, no drawer → excluded from aha, still "seen"
      { agencyId: "C", type: "signup", createdAt: t(5), propsJson: {} },
    ]);
    const s = await getActivationSummary(30, t(120));
    expect(s.agenciesSeen).toBe(3);
    expect(s.agenciesActivated).toBe(2); // A + B reached the drawer
    // median of [10, 30] (nearest-rank on lower-mid) = 10
    expect(s.timeToAhaMedianMin).toBe(10);
  });

  test("per-template conversion: mapped market → committed spend", async () => {
    findManyMock.mockResolvedValue([
      // med-spa: two agencies mapped, one enriched → 50%
      {
        agencyId: "A",
        type: "market_mapped",
        createdAt: t(0),
        propsJson: { templateKey: "reviews", size: 100 },
      },
      {
        agencyId: "B",
        type: "market_mapped",
        createdAt: t(0),
        propsJson: { templateKey: "reviews", size: 80 },
      },
      { agencyId: "A", type: "enrich_started", createdAt: t(5), propsJson: {} },
      // website: one mapped, none enriched → 0%
      {
        agencyId: "C",
        type: "market_mapped",
        createdAt: t(0),
        propsJson: { templateKey: "website" },
      },
    ]);
    const s = await getActivationSummary(30, t(60));
    const reviews = s.perTemplate.find((p) => p.templateKey === "reviews")!;
    const website = s.perTemplate.find((p) => p.templateKey === "website")!;
    expect(reviews.mapped).toBe(2);
    expect(reviews.enriched).toBe(1);
    expect(reviews.rate).toBeCloseTo(0.5);
    expect(website.mapped).toBe(1);
    expect(website.enriched).toBe(0);
    expect(website.rate).toBe(0);
    // sorted by mapped desc → reviews first
    expect(s.perTemplate[0].templateKey).toBe("reviews");
  });

  test("falls back to an empty summary when the read throws", async () => {
    findManyMock.mockRejectedValue(new Error("neon down"));
    const s = await getActivationSummary(30, t(60));
    expect(s.agenciesSeen).toBe(0);
    expect(s.perTemplate).toEqual([]);
  });
});
