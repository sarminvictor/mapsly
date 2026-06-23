// Phase 8 · generateTouchesForLeads gathers grounded signals, builds the
// deterministic first-touch skeleton, and persists an OutreachDraft per lead.
// Ungrounded lines are dropped (never an empty token); a draft row is written
// for each buildable lead.

import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  review: { count: vi.fn() },
  adLibraryEntry: { count: vi.fn() },
  businessTech: { findFirst: vi.fn(), count: vi.fn() },
  playbookFinding: { findFirst: vi.fn() },
  outreachDraft: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

import { gatherTouchSignals, generateTouchesForLeads } from "../generate";

beforeEach(() => {
  vi.clearAllMocks();
});

function mockBiz(over: Record<string, unknown> = {}) {
  prismaMock.business.findUnique.mockResolvedValue({
    id: "biz_1",
    name: "Glow Spa",
    city: "Miami",
    category: "Medical Spa",
    snapshots: [
      {
        reviewLifecycle: "DYING",
        pillarRanks: { reputation: { rank: 8, of: 10 } },
        cellSize: 10,
        adsApplicable: true,
      },
    ],
    lighthouseAudits: [{ lcp: 5.2, performance: 40 }],
    ...over,
  });
}

describe("gatherTouchSignals", () => {
  test("assembles grounded signals; booking unknown when tech not scanned", async () => {
    mockBiz();
    prismaMock.review.count.mockResolvedValue(3); // unanswered negatives
    prismaMock.adLibraryEntry.count.mockResolvedValue(0); // no own ads
    prismaMock.businessTech.findFirst.mockResolvedValue(null); // no booking row
    prismaMock.businessTech.count.mockResolvedValue(0); // tech NOT scanned
    prismaMock.playbookFinding.findFirst.mockResolvedValue(null);

    const s = await gatherTouchSignals("biz_1");

    expect(s.businessName).toBe("Glow Spa");
    expect(s.city).toBe("Miami");
    expect(s.noun).toBe("patients");
    expect(s.unansweredNegative).toBe(3);
    expect(s.reviewLifecycle).toBe("DYING");
    expect(s.lcpSeconds).toBe(5.2);
    expect(s.lighthousePerf).toBe(40);
    expect(s.runsAds).toBe(false);
    // tech not scanned → null ("unknown"), NOT false.
    expect(s.hasBookingTool).toBeNull();
    expect(s.hipaaPixelRisk).toBeNull();
    // reputation rank 8 of 10 → percentile (1 - 7/10)*100 = 30.
    expect(s.reviewsVsCellPercentile).toBe(30);
  });

  test("booking is false when tech scanned but no booking tool found", async () => {
    mockBiz();
    prismaMock.review.count.mockResolvedValue(0);
    prismaMock.adLibraryEntry.count.mockResolvedValue(2); // runs ads
    prismaMock.businessTech.findFirst.mockResolvedValue(null);
    prismaMock.businessTech.count.mockResolvedValue(5); // tech scanned
    prismaMock.playbookFinding.findFirst.mockResolvedValue(null);

    const s = await gatherTouchSignals("biz_1");
    expect(s.hasBookingTool).toBe(false);
    expect(s.runsAds).toBe(true);
    // 0 unanswered negatives → null so the line is dropped.
    expect(s.unansweredNegative).toBeNull();
  });

  test("hipaaPixelRisk true when a flagged HIPAA finding exists", async () => {
    mockBiz();
    prismaMock.review.count.mockResolvedValue(0);
    prismaMock.adLibraryEntry.count.mockResolvedValue(0);
    prismaMock.businessTech.findFirst.mockResolvedValue({ id: "t_1" });
    prismaMock.businessTech.count.mockResolvedValue(3);
    prismaMock.playbookFinding.findFirst.mockResolvedValue({ id: "f_1" });

    const s = await gatherTouchSignals("biz_1");
    expect(s.hipaaPixelRisk).toBe(true);
    expect(s.hasBookingTool).toBe(true);
  });

  test("throws when the business is gone", async () => {
    prismaMock.business.findUnique.mockResolvedValue(null);
    await expect(gatherTouchSignals("nope")).rejects.toThrow(
      /business not found/,
    );
  });
});

describe("generateTouchesForLeads", () => {
  test("persists a draft per lead; body has only grounded lines (no tokens)", async () => {
    mockBiz();
    prismaMock.review.count.mockResolvedValue(3);
    prismaMock.adLibraryEntry.count.mockResolvedValue(0);
    prismaMock.businessTech.findFirst.mockResolvedValue(null);
    prismaMock.businessTech.count.mockResolvedValue(0);
    prismaMock.playbookFinding.findFirst.mockResolvedValue(null);
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    const out = await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      mailingAddress: "1 Main St, Miami FL",
    });

    expect(out).toEqual([{ businessId: "biz_1", draftId: "draft_1" }]);
    expect(prismaMock.outreachDraft.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.outreachDraft.create.mock.calls[0][0].data;
    expect(data.businessId).toBe("biz_1");
    expect(data.channel).toBe("email");
    expect(data.status).toBe("draft");
    // No unfilled merge tokens (the skeleton drops ungrounded lines).
    expect(data.body).not.toMatch(/\{\{[^}]+\}\}/);
    // The grounded unanswered-negative line is present.
    expect(data.body).toContain("3 unanswered negative review");
    // whyJson carries the audit of dropped tokens. competitor_ads is dropped
    // because competitorAdsCount is null in this gather path.
    expect(Array.isArray(data.whyJson.droppedTokens)).toBe(true);
    expect(data.whyJson.droppedTokens).toContain("competitor_ads");
    expect(typeof data.predictedTier).toBe("string");
  });

  test("skips an unbuildable lead (email with no mailing address) without failing the batch", async () => {
    mockBiz();
    prismaMock.review.count.mockResolvedValue(1);
    prismaMock.adLibraryEntry.count.mockResolvedValue(0);
    prismaMock.businessTech.findFirst.mockResolvedValue(null);
    prismaMock.businessTech.count.mockResolvedValue(0);
    prismaMock.playbookFinding.findFirst.mockResolvedValue(null);

    // No mailingAddress → buildFirstTouch throws for email → lead is skipped.
    const out = await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
    });

    expect(out).toEqual([]);
    expect(prismaMock.outreachDraft.create).not.toHaveBeenCalled();
  });
});
