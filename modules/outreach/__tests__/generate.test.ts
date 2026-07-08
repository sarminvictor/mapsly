// Phase 8 · generateTouchesForLeads gathers grounded signals, builds the
// deterministic first-touch skeleton, and persists an OutreachDraft per lead.
// Ungrounded lines are dropped (never an empty token); a draft row is written
// for each buildable lead.

import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  review: { count: vi.fn(), findFirst: vi.fn() },
  adLibraryEntry: { count: vi.fn() },
  businessTech: { findFirst: vi.fn(), count: vi.fn() },
  playbookFinding: { findFirst: vi.fn() },
  // A10 · newest verified Meta ad-market run for the business's cell.
  adMarketRun: { findFirst: vi.fn() },
  // Touchpoints v2 (A1–A4) · SERP ranks + AI research read.
  serpResult: { findFirst: vi.fn() },
  businessEnrichment: { findUnique: vi.fn() },
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

    expect(out.touches).toEqual([{ businessId: "biz_1", draftId: "draft_1" }]);
    expect(out.skippedNoAddress).toBe(0);
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

    expect(out.touches).toEqual([]);
    // TM-1 · the skip is attributed so the UI can say "set your mailing address".
    expect(out.skippedNoAddress).toBe(1);
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

    expect(out.touches).toHaveLength(3);
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

// ── Touchpoints audit 2026-07-07 · A5, A6, A10, A12, A17 ────────────────────

/** Baseline "no extra signals" mocks; individual tests override what they need. */
function mockQuiet() {
  prismaMock.review.count.mockResolvedValue(0);
  prismaMock.review.findFirst.mockResolvedValue(null);
  prismaMock.adLibraryEntry.count.mockResolvedValue(0);
  prismaMock.businessTech.findFirst.mockResolvedValue(null);
  prismaMock.businessTech.count.mockResolvedValue(0);
  prismaMock.playbookFinding.findFirst.mockResolvedValue(null);
  prismaMock.adMarketRun.findFirst.mockResolvedValue(null);
  // Touchpoints v2 · no SERP scan / no AI research by default.
  prismaMock.serpResult.findFirst.mockResolvedValue(null);
  prismaMock.businessEnrichment.findUnique.mockResolvedValue(null);
}

describe("A6 · noun map — health practices say 'patients'", () => {
  test("an acupuncture clinic gets 'patients' (the audit's live miss)", async () => {
    mockBiz({ category: "Acupuncturist" });
    mockQuiet();
    const s = await gatherTouchSignals("biz_1");
    expect(s.noun).toBe("patients");
  });

  test("a barbershop gets 'clients'; unmatched categories stay 'customers'", async () => {
    mockBiz({ category: "Barber shop" });
    mockQuiet();
    expect((await gatherTouchSignals("biz_1")).noun).toBe("clients");

    mockBiz({ category: "Tire shop" });
    expect((await gatherTouchSignals("biz_1")).noun).toBe("customers");
  });
});

describe("A5 · partial-pull flag (pulled rows vs listing reviewCount)", () => {
  test("11 pulled of a 607-review listing → reviewSamplePartial true", async () => {
    mockBiz({ reviewCount: 607 });
    mockQuiet();
    // First count = unanswered negatives (stars filter); second = total pulled.
    prismaMock.review.count.mockImplementation(
      async (args: { where: { stars?: unknown } }) =>
        args.where.stars ? 2 : 11,
    );
    const s = await gatherTouchSignals("biz_1");
    expect(s.unansweredNegative).toBe(2);
    expect(s.reviewSamplePartial).toBe(true);
  });

  test("pull covering ≥80% of the listing → not partial (exact claim ok)", async () => {
    mockBiz({ reviewCount: 12 });
    mockQuiet();
    prismaMock.review.count.mockImplementation(
      async (args: { where: { stars?: unknown } }) =>
        args.where.stars ? 2 : 11,
    );
    const s = await gatherTouchSignals("biz_1");
    expect(s.reviewSamplePartial).toBe(false);
  });

  test("no listing count → never claimed partial", async () => {
    mockBiz({ reviewCount: null });
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(3);
    const s = await gatherTouchSignals("biz_1");
    expect(s.reviewSamplePartial).toBe(false);
  });
});

describe("A10 · competitorAdsCount from the cell's newest Meta run", () => {
  test("advertiserCount flows through; the business's own ads subtract one", async () => {
    mockBiz({ cellKey: "barber|kelowna|CA" });
    mockQuiet();
    prismaMock.adMarketRun.findFirst.mockResolvedValue({ advertiserCount: 5 });

    // Not advertising itself → all 5 are competitors.
    const s = await gatherTouchSignals("biz_1");
    expect(s.competitorAdsCount).toBe(5);
    // Only verified runs count (OK/PARTIAL, newest first).
    const q = prismaMock.adMarketRun.findFirst.mock.calls[0][0];
    expect(q.where).toEqual({
      cellKey: "barber|kelowna|CA",
      platform: "META",
      status: { in: ["OK", "PARTIAL"] },
    });
    expect(q.orderBy).toEqual({ ranAt: "desc" });

    // Advertising itself → subtract one, never below 0.
    prismaMock.adLibraryEntry.count.mockResolvedValue(2);
    expect((await gatherTouchSignals("biz_1")).competitorAdsCount).toBe(4);
    prismaMock.adMarketRun.findFirst.mockResolvedValue({ advertiserCount: 1 });
    expect((await gatherTouchSignals("biz_1")).competitorAdsCount).toBe(0);
  });

  test("no cellKey or no verified run → null (pain honestly stays off)", async () => {
    mockBiz(); // no cellKey
    mockQuiet();
    expect((await gatherTouchSignals("biz_1")).competitorAdsCount).toBeNull();
    expect(prismaMock.adMarketRun.findFirst).not.toHaveBeenCalled();

    mockBiz({ cellKey: "barber|kelowna|CA" });
    prismaMock.adMarketRun.findFirst.mockResolvedValue(null);
    expect((await gatherTouchSignals("biz_1")).competitorAdsCount).toBeNull();
  });
});

describe("A12 · consentRecordId persisted on the draft", () => {
  test("the consent row is created BEFORE the draft and its id lands on the row", async () => {
    mockBiz({ email: "owner@glowspa.com" });
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(2);
    prismaMock.consentRecord.create.mockResolvedValue({ id: "consent_9" });
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
    });

    const consentOrder =
      prismaMock.consentRecord.create.mock.invocationCallOrder[0];
    const draftOrder =
      prismaMock.outreachDraft.create.mock.invocationCallOrder[0];
    expect(consentOrder).toBeLessThan(draftOrder);
    const data = prismaMock.outreachDraft.create.mock.calls[0][0].data;
    expect(data.consentRecordId).toBe("consent_9");
  });

  test("consent failure never blocks the draft — it just carries null", async () => {
    mockBiz({ email: "owner@glowspa.com" });
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(2);
    prismaMock.consentRecord.create.mockRejectedValue(new Error("db down"));
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    const out = await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
    });

    expect(out.touches).toHaveLength(1);
    const data = prismaMock.outreachDraft.create.mock.calls[0][0].data;
    expect(data.consentRecordId).toBeNull();
  });
});

describe("A17 · sparse gate — zero grounded pains → skip, don't draft", () => {
  test("a zero-signal lead is skipped and counted in skippedSparse", async () => {
    mockBiz({ snapshots: [], lighthouseAudits: [] });
    mockQuiet();

    const out = await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
    });

    expect(out.touches).toEqual([]);
    expect(out.skippedSparse).toBe(1);
    expect(prismaMock.outreachDraft.create).not.toHaveBeenCalled();
    // No consent row for a touch that never shipped.
    expect(prismaMock.consentRecord.create).not.toHaveBeenCalled();
  });

  test("an allowlist that filters out every present pain also gates as sparse", async () => {
    mockBiz();
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(3); // unanswered present…

    const out = await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
      painPointKeys: ["hipaa_pixel_risk"], // …but not allowed
    });

    expect(out.touches).toEqual([]);
    expect(out.skippedSparse).toBe(1);
  });

  test("a grounded lead is NOT gated (skippedSparse 0)", async () => {
    mockBiz();
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(3);
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    const out = await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
    });

    expect(out.touches).toHaveLength(1);
    expect(out.skippedSparse).toBe(0);
  });
});

// ── Touchpoints v2 (2026-07-07) · A1–A5 data plumbing, A13/A14 skip summary ──

describe("A1–A5 · the 'stand out' facts are gathered from real data", () => {
  test("A1 · named rivals from peopleAlsoSearch (top rival + other count)", async () => {
    mockBiz({
      peopleAlsoSearch: [
        { title: "Zen Wellness", rating: { value: 4.8, votes_count: 210 } },
        { title: "Calm Acupuncture" },
        { title: "Needle Point Clinic" },
      ],
    });
    mockQuiet();
    const s = await gatherTouchSignals("biz_1");
    expect(s.topRivalName).toBe("Zen Wellness");
    expect(s.otherRivalCount).toBe(2); // 3 rivals, minus the top one
  });

  test("A1 · no rivals → null (grounded-or-omit)", async () => {
    mockBiz({ peopleAlsoSearch: null });
    mockQuiet();
    const s = await gatherTouchSignals("biz_1");
    expect(s.topRivalName).toBeNull();
    expect(s.otherRivalCount).toBeNull();
  });

  test("A2 · SERP ranks + pack leader; keyword derived from category+city", async () => {
    mockBiz({ category: "Acupuncturist", city: "Boise" });
    mockQuiet();
    prismaMock.serpResult.findFirst.mockResolvedValue({
      localPackRank: null,
      organicRank: 7,
      pack1Name: "Zen Wellness",
    });
    const s = await gatherTouchSignals("biz_1");
    expect(s.organicRank).toBe(7);
    expect(s.localPackRank).toBeNull();
    expect(s.packLeaderName).toBe("Zen Wellness");
    // Keyword is derived (SerpResult stores a keywordId, not the text).
    expect(s.trackedKeyword).toBe("acupuncturist boise");
  });

  test("A2 · no SERP scan → ranks/keyword-leader null (serp pain stays off)", async () => {
    mockBiz({ category: "Acupuncturist", city: "Boise" });
    mockQuiet(); // serpResult.findFirst → null
    const s = await gatherTouchSignals("biz_1");
    expect(s.organicRank).toBeNull();
    expect(s.packLeaderName).toBeNull();
    // trackedKeyword is still derivable from category+city (used only when a
    // rank exists — the pain's present-gate requires organicRank).
    expect(s.trackedKeyword).toBe("acupuncturist boise");
  });

  test("A3 · a real unanswered ≤3★ review is quoted (text + stars + month)", async () => {
    mockBiz();
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(3);
    prismaMock.review.findFirst.mockResolvedValue({
      stars: 2,
      text: "  waited an hour and nobody came to the desk  ",
      postedAt: new Date(Date.UTC(2026, 5, 12)), // June (month index 5)
    });
    const s = await gatherTouchSignals("biz_1");
    expect(s.recentUnansweredReviewQuote).toBe(
      "waited an hour and nobody came to the desk",
    );
    expect(s.reviewQuoteStars).toBe(2);
    expect(s.reviewQuoteMonth).toBe("June");
  });

  test("A3 · a review with no text → no quote (grounded-or-omit)", async () => {
    mockBiz();
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(3);
    prismaMock.review.findFirst.mockResolvedValue(null);
    const s = await gatherTouchSignals("biz_1");
    expect(s.recentUnansweredReviewQuote).toBeNull();
    expect(s.reviewQuoteStars).toBeNull();
    expect(s.reviewQuoteMonth).toBeNull();
  });

  test("A4 · the first short AI pain hypothesis is carried; long ones skipped", async () => {
    mockBiz();
    mockQuiet();
    prismaMock.businessEnrichment.findUnique.mockResolvedValue({
      painHypotheses: [
        "x".repeat(200), // too long → skipped
        "their booking page 404s on mobile",
      ],
    });
    const s = await gatherTouchSignals("biz_1");
    expect(s.aiPainHypothesis).toBe("their booking page 404s on mobile");
  });

  test("A5 · named booking tool only when booking exists; years on Google", async () => {
    mockBiz({ firstSeenOnGoogle: new Date(Date.UTC(2019, 0, 1)) });
    mockQuiet();
    prismaMock.businessTech.findFirst.mockResolvedValue({
      id: "t_1",
      name: "Vagaro",
    });
    prismaMock.businessTech.count.mockResolvedValue(4); // tech scanned
    const s = await gatherTouchSignals("biz_1");
    expect(s.hasBookingTool).toBe(true);
    expect(s.bookingToolName).toBe("Vagaro");
    expect(s.yearsOnGoogle).toBeGreaterThanOrEqual(6);
  });

  test("A5 · bookingToolName null when tech scanned but no booking tool", async () => {
    mockBiz();
    mockQuiet();
    prismaMock.businessTech.findFirst.mockResolvedValue(null);
    prismaMock.businessTech.count.mockResolvedValue(4); // scanned, no booking
    const s = await gatherTouchSignals("biz_1");
    expect(s.hasBookingTool).toBe(false);
    expect(s.bookingToolName).toBeNull();
  });

  test("A10 · categoryLabel humanizes/pluralizes a clean category", async () => {
    mockBiz({ category: "Acupuncturist" });
    mockQuiet();
    expect((await gatherTouchSignals("biz_1")).categoryLabel).toBe(
      "acupuncture clinics",
    );
    mockBiz({ category: "Barber shop" });
    expect((await gatherTouchSignals("biz_1")).categoryLabel).toBe(
      "barber shops",
    );
  });
});

describe("A13/A14 · structured skip summary (the '6 of 8' fix)", () => {
  test("a gather-error is COUNTED (skippedError), not a silent drop", async () => {
    // biz_ok gathers fine; biz_gone throws in gatherTouchSignals.
    prismaMock.business.findUnique.mockImplementation(
      async (args: { where: { id: string } }) =>
        args.where.id === "biz_gone"
          ? null // → gatherTouchSignals throws "business not found"
          : {
              id: "biz_ok",
              name: "Glow Spa",
              city: "Miami",
              category: "Medical Spa",
              snapshots: [],
              lighthouseAudits: [],
            },
    );
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(3); // biz_ok is grounded
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    const out = await generateTouchesForLeads(["biz_ok", "biz_gone"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
    });

    expect(out.touches).toHaveLength(1);
    expect(out.skippedError).toBe(1);
    expect(out.skips.error).toBe(1);
  });

  test("the structured skips object mirrors the flat counters + alreadyDrafted=0", async () => {
    // A no-address email run: the one lead is skipped for noAddress.
    mockBiz();
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(1);

    const out = await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "marketing",
      channel: "email",
      agencyId: "agency_1",
      // no mailingAddress → noAddress skip
    });

    expect(out.skips).toEqual({
      noAddress: 1,
      sparse: 0,
      error: 0,
      alreadyDrafted: 0, // generate never fills this — actions.ts does
    });
    expect(out.skippedNoAddress).toBe(out.skips.noAddress);
    expect(out.skippedSparse).toBe(out.skips.sparse);
    expect(out.skippedError).toBe(out.skips.error);
  });
});

describe("A12 · includeNameInSubject plumbs through to the email subject", () => {
  // NOTE: the generate path seeds the subject variant with the businessId
  // (variantSeed) for cohort dedup, so the EXACT variant rotates — these tests
  // assert the PLUMBING (name prefix on/off + Title Case), not a fixed variant.
  test("true → the draft subject prepends the short name + Title Case", async () => {
    mockBiz({ lighthouseAudits: [{ lcp: 7.7, performance: 30 }] });
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(0); // slow_site is the only pain
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "website speed",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
      includeNameInSubject: true,
    });

    const data = prismaMock.outreachDraft.create.mock.calls[0][0].data;
    // Name prefix + Title Case (the specific variant rotates with the seed).
    expect(String(data.subject)).toMatch(/^Glow Spa — [A-Z]/);
    // Any number in the subject is still body-backed (A3).
    const body = String(data.body);
    for (const n of String(data.subject).match(/\d+(?:\.\d+)?/g) ?? []) {
      expect(body).toContain(n);
    }
  });

  test("default (omitted) → lowercase specific subject, no business name", async () => {
    mockBiz({ lighthouseAudits: [{ lcp: 7.7, performance: 30 }] });
    mockQuiet();
    prismaMock.review.count.mockResolvedValue(0);
    prismaMock.outreachDraft.create.mockResolvedValue({ id: "draft_1" });

    await generateTouchesForLeads(["biz_1"], {
      sellingWhat: "website speed",
      channel: "email",
      agencyId: "agency_1",
      mailingAddress: "1 Main St, Miami FL",
    });

    const data = prismaMock.outreachDraft.create.mock.calls[0][0].data;
    // No name prefix, lowercase-leaning, a real slow-site subject variant.
    expect(String(data.subject)).not.toContain("Glow Spa");
    expect(String(data.subject)[0]).toBe(String(data.subject)[0].toLowerCase());
  });
});
