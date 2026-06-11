/**
 * qualifyBusiness · the three guards added after the 2026-06-11
 * "Qualify (4) sent 380+ jobs" incident + audit:
 *
 *  1. **Settled-row short-circuit** — QUALIFIED/DISQUALIFIED/UNREACHABLE
 *     rows return stored state without running scrape/AI/services
 *     (worker retries + duplicate fan-outs become free no-ops).
 *     `force: true` (the per-row admin re-audit button) bypasses it;
 *     NOT_QUALIFIED and FAILED always run.
 *  2. **AI attempt marker** — tier-3 is skipped when a PRIOR run set
 *     the "ai_attempted" flag, not only when AI previously succeeded.
 *     Re-running a no-email row must not re-bill ~$0.027 every click.
 *     The marker also persists across flag rewrites.
 *  3. **Email ratchet** — "found before" beats "found nothing now". A
 *     forced re-run whose scrape transiently fails keeps the prior
 *     email/source and stays QUALIFIED instead of erasing paid data.
 *
 * External boundaries are mocked — this pins OUR decision logic.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  business: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

const scrapeMock = vi.hoisted(() => vi.fn());
vi.mock("../scrape-email", () => ({
  scrapeEmailsFromWebsite: scrapeMock,
}));

const rdapMock = vi.hoisted(() => vi.fn());
vi.mock("../rdap", () => ({ rdapLookup: rdapMock }));

const aiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/ai", () => ({ findEmailViaAi: aiMock }));

const servicesMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ candidates: [], created: 0 }),
);
vi.mock("@/services/business-services-detect", () => ({
  detectAndPersistServices: servicesMock,
}));

const pullMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ triggered: false, reason: "already_pulled" }),
);
vi.mock("@/modules/reviews/trigger-pull", () => ({
  triggerReviewPullForBusiness: pullMock,
}));

import { qualifyBusiness } from "../qualify";

/** A claimed, well-reviewed business with a website — QUALIFIED material. */
function bizRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "biz_1",
    name: "Glow Spa",
    city: "Miami",
    province: "FL",
    country: "US",
    website: "https://glowspa.com",
    domain: "glowspa.com",
    reviewCount: 40,
    isClaimed: true,
    category: "Medical spa",
    categories: [],
    categoryIds: ["medical_spa"],
    description: null,
    placeTopics: null,
    qualificationStatus: "NOT_QUALIFIED",
    qualificationFlags: [],
    emailDiscovered: null,
    emailDiscoveredAt: null,
    emailDiscoverySource: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.business.update.mockResolvedValue({});
  scrapeMock.mockResolvedValue({ candidates: [], websiteUnreachable: false });
  rdapMock.mockResolvedValue({ candidates: [], proxiedOnly: false });
  aiMock.mockResolvedValue({ email: null, confidence: "low", source: null });
  servicesMock.mockResolvedValue({ candidates: [], created: 0 });
  pullMock.mockResolvedValue({ triggered: false, reason: "already_pulled" });
});

describe("settled-row short-circuit", () => {
  test("QUALIFIED row without force → stored state echoed, zero work, zero writes", async () => {
    prismaMock.business.findUnique.mockResolvedValue(
      bizRow({
        qualificationStatus: "QUALIFIED",
        emailDiscovered: "info@glowspa.com",
        emailDiscoverySource: "SCRAPE_CONTACT",
        qualificationFlags: [],
      }),
    );

    const out = await qualifyBusiness("biz_1");

    expect(out.skippedSettled).toBe(true);
    expect(out.status).toBe("QUALIFIED");
    expect(out.emailDiscovered).toBe("info@glowspa.com");
    expect(out.reviewPull).toBeNull();
    expect(scrapeMock).not.toHaveBeenCalled();
    expect(aiMock).not.toHaveBeenCalled();
    expect(servicesMock).not.toHaveBeenCalled();
    expect(prismaMock.business.update).not.toHaveBeenCalled();
  });

  test.each(["NOT_QUALIFIED", "FAILED"] as const)(
    "%s row proceeds without force",
    async (status) => {
      prismaMock.business.findUnique.mockResolvedValue(
        bizRow({ qualificationStatus: status }),
      );

      const out = await qualifyBusiness("biz_1");

      expect(out.skippedSettled).toBeUndefined();
      expect(scrapeMock).toHaveBeenCalledTimes(1);
      expect(prismaMock.business.update).toHaveBeenCalled();
    },
  );

  test("force runs the full pipeline on a settled row", async () => {
    prismaMock.business.findUnique.mockResolvedValue(
      bizRow({ qualificationStatus: "DISQUALIFIED" }),
    );

    await qualifyBusiness("biz_1", { force: true });

    expect(scrapeMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.business.update).toHaveBeenCalled();
  });
});

describe("AI attempt marker", () => {
  test("prior 'ai_attempted' flag suppresses tier-3 even though emailDiscoverySource is null", async () => {
    prismaMock.business.findUnique.mockResolvedValue(
      bizRow({
        qualificationStatus: "FAILED",
        qualificationFlags: ["no_email", "ai_attempted"],
      }),
    );

    await qualifyBusiness("biz_1");

    expect(aiMock).not.toHaveBeenCalled();
    // The marker must survive the flag rewrite — losing it re-arms
    // the billing on the run after this one.
    const persisted = prismaMock.business.update.mock.calls[0]![0].data;
    expect(persisted.qualificationFlags).toContain("ai_attempted");
  });

  test("fresh row with no candidates DOES reach tier-3 once", async () => {
    prismaMock.business.findUnique.mockResolvedValue(bizRow());

    await qualifyBusiness("biz_1");

    expect(aiMock).toHaveBeenCalledTimes(1);
    const persisted = prismaMock.business.update.mock.calls[0]![0].data;
    expect(persisted.qualificationFlags).toContain("ai_attempted");
  });
});

describe("election gate · unaligned custom-domain emails never win", () => {
  test("footer-credit email is not elected, AI tier runs, audit list keeps it", async () => {
    prismaMock.business.findUnique.mockResolvedValue(bizRow());
    // The only scrape find is a web-designer footer credit on a
    // different custom domain — electable? No.
    scrapeMock.mockResolvedValue({
      candidates: [
        {
          email: "john@webagency.com",
          source: "SCRAPE_FOOTER",
          score: 65,
          isPersonal: true,
          isDomainAligned: false,
          isFreeProvider: false,
        },
      ],
      websiteUnreachable: false,
    });

    const out = await qualifyBusiness("biz_1");

    // The unaligned candidate did NOT become the outreach target...
    expect(out.emailDiscovered).toBeNull();
    expect(out.status).toBe("DISQUALIFIED");
    // ...the AI tier got its chance...
    expect(aiMock).toHaveBeenCalledTimes(1);
    // ...and the audit trail still shows what was found.
    const persisted = prismaMock.business.update.mock.calls[0]![0].data;
    expect(persisted.emailDiscovered).toBeNull();
    expect(
      (persisted.emailCandidates as Array<{ email: string }>).map(
        (c) => c.email,
      ),
    ).toContain("john@webagency.com");
  });

  test("free-provider email IS electable (SMBs often run on gmail)", async () => {
    prismaMock.business.findUnique.mockResolvedValue(bizRow());
    scrapeMock.mockResolvedValue({
      candidates: [
        {
          email: "glowspamiami@gmail.com",
          source: "SCRAPE_CONTACT",
          score: 45,
          isPersonal: true,
          isDomainAligned: false,
          isFreeProvider: true,
        },
      ],
      websiteUnreachable: false,
    });

    const out = await qualifyBusiness("biz_1");

    expect(out.emailDiscovered).toBe("glowspamiami@gmail.com");
    expect(out.status).toBe("QUALIFIED");
    expect(aiMock).not.toHaveBeenCalled();
  });
});

describe("email ratchet · found-before beats found-nothing-now", () => {
  test("forced re-run with transient scrape failure keeps the prior email and stays QUALIFIED", async () => {
    prismaMock.business.findUnique.mockResolvedValue(
      bizRow({
        qualificationStatus: "QUALIFIED",
        qualificationFlags: ["ai_attempted"],
        emailDiscovered: "owner@glowspa.com",
        emailDiscoverySource: "AI_WEB_SEARCH",
        emailDiscoveredAt: new Date("2026-06-11T18:30:00Z"),
      }),
    );
    scrapeMock.mockResolvedValue({ candidates: [], websiteUnreachable: true });

    const out = await qualifyBusiness("biz_1", { force: true });

    expect(out.status).toBe("QUALIFIED");
    expect(out.emailDiscovered).toBe("owner@glowspa.com");
    const persisted = prismaMock.business.update.mock.calls[0]![0].data;
    expect(persisted.emailDiscovered).toBe("owner@glowspa.com");
    expect(persisted.emailDiscoverySource).toBe("AI_WEB_SEARCH");
    expect(persisted.qualificationStatus).toBe("QUALIFIED");
    // No fresh candidates + kept email → don't wipe the prior
    // candidate audit trail.
    expect(persisted.emailCandidates).toBeUndefined();
    // And the flag rewrite must not claim no_email — we have one.
    expect(persisted.qualificationFlags).not.toContain("no_email");
  });

  test("a better fresh find still overwrites (ratchet, not freeze)", async () => {
    prismaMock.business.findUnique.mockResolvedValue(
      bizRow({
        qualificationStatus: "FAILED",
        emailDiscovered: "old@glowspa.com",
        emailDiscoverySource: "RDAP",
      }),
    );
    scrapeMock.mockResolvedValue({
      candidates: [
        {
          email: "hello@glowspa.com",
          source: "SCRAPE_CONTACT",
          score: 80,
          isPersonal: false,
          isDomainAligned: true,
          isFreeProvider: false,
        },
      ],
      websiteUnreachable: false,
    });

    await qualifyBusiness("biz_1");

    const persisted = prismaMock.business.update.mock.calls[0]![0].data;
    expect(persisted.emailDiscovered).toBe("hello@glowspa.com");
    expect(persisted.emailDiscoverySource).toBe("SCRAPE_CONTACT");
  });
});
