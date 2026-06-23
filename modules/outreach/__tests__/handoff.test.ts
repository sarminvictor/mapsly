// Phase 8 · handoff takes approved drafts to CSV export or cold enrollment.
// Both paths REFUSE a draft whose business lacks a physical mailing address
// (CAN-SPAM). CSV carries a mandatory unsubscribe note on every row. Enroll
// creates ColdRecipients (does NOT send).

import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  coldCampaign: { findUnique: vi.fn() },
  outreachDraft: { findMany: vi.fn() },
  business: { findMany: vi.fn() },
  coldRecipient: { create: vi.fn() },
  consentRecord: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

import {
  composeMailingAddress,
  DEFAULT_UNSUBSCRIBE_NOTE,
  enrollInColdCampaign,
  exportDraftsCsv,
} from "../handoff";

beforeEach(() => {
  vi.clearAllMocks();
});

const draftWithAddr = {
  id: "draft_1",
  businessId: "biz_1",
  channel: "email",
  subject: "Glow Spa — unanswered reviews",
  body: "Hi — you have 3 unanswered reviews.",
  predictedTier: "high",
};
const draftNoAddr = {
  id: "draft_2",
  businessId: "biz_2",
  channel: "email",
  subject: "X — a quick look",
  body: "Hi — a quick look at X.",
  predictedTier: "low",
};

/** Business rows the resolver will join: biz_1 has an address, biz_2 doesn't. */
function mockBusinesses() {
  prismaMock.business.findMany.mockResolvedValue([
    {
      id: "biz_1",
      name: "Glow Spa",
      address: "1 Main St",
      city: "Miami",
      province: "FL",
      postalCode: "33131",
      email: "owner@glowspa.com",
      landingPage: { slug: "glow-spa", token: "tok1" },
    },
    {
      id: "biz_2",
      name: "No Address Co",
      address: null,
      city: "Miami",
      province: "FL",
      postalCode: null,
      email: "owner@noaddr.com",
      landingPage: { slug: "no-addr", token: "tok2" },
    },
  ]);
}

describe("composeMailingAddress", () => {
  test("joins available parts when a street address exists", () => {
    expect(
      composeMailingAddress({
        name: "X",
        address: "1 Main St",
        city: "Miami",
        province: "FL",
        postalCode: "33131",
        email: null,
        landingPage: null,
      }),
    ).toBe("1 Main St, Miami, FL, 33131");
  });

  test("returns null without a street address (CAN-SPAM minimum)", () => {
    expect(
      composeMailingAddress({
        name: "X",
        address: null,
        city: "Miami",
        province: "FL",
        postalCode: "33131",
        email: null,
        landingPage: null,
      }),
    ).toBeNull();
  });
});

describe("exportDraftsCsv", () => {
  test("includes the mandatory unsubscribe footer column on every row", async () => {
    mockBusinesses();
    const res = await exportDraftsCsv([draftWithAddr]);

    expect(res.exported).toBe(1);
    expect(res.skipped).toHaveLength(0);
    // Header carries the compliance columns.
    expect(res.csv.split("\n")[0]).toContain("unsubscribeNote");
    expect(res.csv.split("\n")[0]).toContain("mailingAddress");
    // The mandatory footer + the composed address are on the data row.
    expect(res.csv).toContain(DEFAULT_UNSUBSCRIBE_NOTE);
    expect(res.csv).toContain("1 Main St, Miami, FL, 33131");
  });

  test("REFUSES a draft with no mailing address (CAN-SPAM)", async () => {
    mockBusinesses();
    const res = await exportDraftsCsv([draftWithAddr, draftNoAddr]);

    expect(res.exported).toBe(1);
    expect(res.skipped).toEqual([
      { draftId: "draft_2", reason: "no_mailing_address" },
    ]);
    // The refused draft's body never makes it into the file.
    expect(res.csv).not.toContain("a quick look at X");
  });

  test("respects a custom unsubscribe note", async () => {
    mockBusinesses();
    const res = await exportDraftsCsv([draftWithAddr], {
      unsubscribeNote: "Email stop@mapsly.ai to opt out.",
    });
    expect(res.csv).toContain("Email stop@mapsly.ai to opt out.");
  });
});

describe("enrollInColdCampaign", () => {
  function mockCampaign() {
    prismaMock.coldCampaign.findUnique.mockResolvedValue({
      id: "camp_1",
      country: "US",
    });
  }

  test("creates a ColdRecipient + ConsentRecord for a compliant draft (no send)", async () => {
    mockCampaign();
    mockBusinesses();
    prismaMock.outreachDraft.findMany.mockResolvedValue([draftWithAddr]);
    prismaMock.coldRecipient.create.mockResolvedValue({ id: "rec_1" });
    prismaMock.consentRecord.create.mockResolvedValue({ id: "con_1" });

    const res = await enrollInColdCampaign(["draft_1"], {
      campaignId: "camp_1",
    });

    expect(res.enrolled).toBe(1);
    expect(res.refusedNoAddress).toBe(0);
    expect(res.outcomes[0]).toMatchObject({
      draftId: "draft_1",
      status: "enrolled",
    });

    // Recipient created PENDING with a first send (step 0) — but NOT sent.
    const recipArgs = prismaMock.coldRecipient.create.mock.calls[0][0].data;
    expect(recipArgs.status).toBe("PENDING");
    expect(recipArgs.email).toBe("owner@glowspa.com");
    expect(recipArgs.reportToken).toBe("glow-spa-tok1");
    expect(recipArgs.sends.create.idempotencyKey).toBe(
      "camp_1:owner@glowspa.com:0",
    );
    // A consent record was written for the defense file.
    expect(prismaMock.consentRecord.create).toHaveBeenCalledTimes(1);
  });

  test("REFUSES to enroll a draft without a mailing address (CAN-SPAM)", async () => {
    mockCampaign();
    mockBusinesses();
    prismaMock.outreachDraft.findMany.mockResolvedValue([
      draftWithAddr,
      draftNoAddr,
    ]);
    prismaMock.coldRecipient.create.mockResolvedValue({ id: "rec_1" });
    prismaMock.consentRecord.create.mockResolvedValue({ id: "con_1" });

    const res = await enrollInColdCampaign(["draft_1", "draft_2"], {
      campaignId: "camp_1",
    });

    expect(res.enrolled).toBe(1);
    expect(res.refusedNoAddress).toBe(1);
    // Only the compliant draft created a recipient.
    expect(prismaMock.coldRecipient.create).toHaveBeenCalledTimes(1);
    const refused = res.outcomes.find((o) => o.draftId === "draft_2");
    expect(refused?.status).toBe("refused_no_address");
  });

  test("treats a duplicate enrollment (P2002) as a skip, not a failure", async () => {
    mockCampaign();
    mockBusinesses();
    prismaMock.outreachDraft.findMany.mockResolvedValue([draftWithAddr]);
    prismaMock.coldRecipient.create.mockRejectedValue({ code: "P2002" });

    const res = await enrollInColdCampaign(["draft_1"], {
      campaignId: "camp_1",
    });

    expect(res.enrolled).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.outcomes[0].status).toBe("duplicate");
  });

  test("throws when the campaign does not exist", async () => {
    prismaMock.coldCampaign.findUnique.mockResolvedValue(null);
    await expect(
      enrollInColdCampaign(["draft_1"], { campaignId: "nope" }),
    ).rejects.toThrow(/cold campaign not found/);
  });
});
