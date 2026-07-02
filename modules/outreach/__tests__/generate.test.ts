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
  // WP7-4 · consent-basis log written per email touch.
  consentRecord: { create: vi.fn() },
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
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
    });

    expect(out).toEqual([{ businessId: "biz_1", draftId: "draft_1" }]);
    expect(prismaMock.outreachDraft.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.outreachDraft.create.mock.calls[0][0].data;
    expect(data.businessId).toBe("biz_1");
    // WP0-1/WP5 · every new draft is stamped with the generating agency.
    expect(data.agencyId).toBe("agency_1");
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

  test("WP7-4 · logs a ConsentRecord (CONSPICUOUS_PUBLICATION) per email touch when the business has an email", async () => {
    mockBiz({ email: "Owner@GlowSpa.com", country: "CA" });
    prismaMock.review.count.mockResolvedValue(2);
    prismaMock.adLibraryEntry.count.mockResolvedValue(0);
    prismaMock.businessTech.findFirst.mockResolvedValue(null);
    prismaMock.businessTech.count.mockResolvedValue(0);
    prismaMock.playbookFinding.findFirst.mockResolvedValue(null);
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });
    prismaMock.consentRecord.create.mockResolvedValue({ id: "consent_1" });

    await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "local SEO",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Toronto ON",
    });

    expect(prismaMock.consentRecord.create).toHaveBeenCalledTimes(1);
    const c = prismaMock.consentRecord.create.mock.calls[0][0].data;
    expect(c.email).toBe("owner@glowspa.com"); // lowercased
    expect(c.businessId).toBe("biz_1");
    expect(c.basis).toBe("CONSPICUOUS_PUBLICATION");
    expect(c.country).toBe("CA");
  });

  test("WP7-4 · no ConsentRecord for a non-email channel", async () => {
    mockBiz({ email: "owner@glowspa.com" });
    prismaMock.review.count.mockResolvedValue(2);
    prismaMock.adLibraryEntry.count.mockResolvedValue(0);
    prismaMock.businessTech.findFirst.mockResolvedValue(null);
    prismaMock.businessTech.count.mockResolvedValue(0);
    prismaMock.playbookFinding.findFirst.mockResolvedValue(null);
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "local SEO",
      channel: "dm",
      agencyId: "agency_1",
    });

    expect(prismaMock.consentRecord.create).not.toHaveBeenCalled();
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
      agencyId: "agency_1",
    });

    expect(out).toEqual([]);
    expect(prismaMock.outreachDraft.create).not.toHaveBeenCalled();
  });

  test("WP5-10 · a 3-step sequence writes 3 drafts with non-repeating pain themes", async () => {
    mockBiz();
    prismaMock.review.count.mockResolvedValue(3); // unanswered negatives
    prismaMock.adLibraryEntry.count.mockResolvedValue(0);
    prismaMock.businessTech.findFirst.mockResolvedValue(null);
    prismaMock.businessTech.count.mockResolvedValue(0);
    prismaMock.playbookFinding.findFirst.mockResolvedValue(null);
    let n = 0;
    prismaMock.outreachDraft.create.mockImplementation(async () => ({
      id: `draft_${++n}`,
    }));

    const out = await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
      sequenceLength: 3,
      tone: "warm",
    });

    expect(out).toHaveLength(3);
    // Signals gathered ONCE per business, not per step.
    expect(prismaMock.business.findUnique).toHaveBeenCalledTimes(1);

    const calls = prismaMock.outreachDraft.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    // Steps encoded in whyJson (no schema ordinal column).
    expect(
      calls.map((d) => (d.whyJson as { sequenceStep: number }).sequenceStep),
    ).toEqual([1, 2, 3]);
    expect(
      calls.every(
        (d) => (d.whyJson as { sequenceOf: number }).sequenceOf === 3,
      ),
    ).toBe(true);
    // Themes never repeat across the sequence (WP5-10 dedup).
    const used = calls.flatMap(
      (d) => (d.whyJson as { usedSignals: string[] }).usedSignals,
    );
    expect(new Set(used).size).toBe(used.length);
    // Follow-up steps read as follow-ups, and no unfilled tokens anywhere.
    expect(String(calls[1].body)).toContain("Following up");
    expect(String(calls[2].body)).toContain("Last note");
    for (const d of calls) {
      expect(String(d.body)).not.toMatch(/\{\{[^}]+\}\}/);
      expect(d.agencyId).toBe("agency_1");
    }
  });

  test("WP5-1 · painPointKeys restricts which themes may fire", async () => {
    mockBiz();
    prismaMock.review.count.mockResolvedValue(5); // unanswered negatives present
    prismaMock.adLibraryEntry.count.mockResolvedValue(0);
    prismaMock.businessTech.findFirst.mockResolvedValue(null);
    prismaMock.businessTech.count.mockResolvedValue(0);
    prismaMock.playbookFinding.findFirst.mockResolvedValue(null);
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
      // Only the slow-site theme is allowed — the (present) unanswered
      // negatives theme must NOT fire.
      painPointKeys: ["slow_site"],
    });

    const data = prismaMock.outreachDraft.create.mock.calls[0][0].data;
    const why = data.whyJson as { usedSignals: string[] };
    expect(why.usedSignals).toEqual(["slow_site"]);
    expect(String(data.body)).not.toContain("unanswered negative");
  });
});
