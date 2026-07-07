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
  consentRecord: { create: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

import {
  complianceFooterOf,
  composeMailingAddress,
  DEFAULT_UNSUBSCRIBE_NOTE,
  enrollInColdCampaign,
  exportDraftsCsv,
} from "../handoff";

beforeEach(() => {
  vi.clearAllMocks();
  // B3 · the consent-basis lookup defaults to "nothing on file".
  prismaMock.consentRecord.findMany.mockResolvedValue([]);
});

/** Minimal RFC-4180 parser (quoted cells may embed newlines — draft bodies do). */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

/** The value of `column` on data row `rowIdx` (0-based) of an export CSV. */
function cellOf(csv: string, column: string, rowIdx = 0): string {
  const rows = parseCsv(csv);
  const idx = rows[0].indexOf(column);
  expect(idx).toBeGreaterThanOrEqual(0);
  return rows[rowIdx + 1][idx];
}

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

/** Business rows the resolver will join: biz_1 has an address, biz_2 doesn't.
 *  B5 email-verification states: biz_1 verified, biz_3 email-but-unverified,
 *  biz_4 no email at all. */
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
      emailVerifiedAt: new Date("2026-06-01T00:00:00Z"),
      phone: "+1 305 555 0100",
      website: "https://glowspa.example",
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
      emailVerifiedAt: null,
      phone: null,
      website: null,
      landingPage: { slug: "no-addr", token: "tok2" },
    },
    {
      id: "biz_3",
      name: "Unverified Mail Co",
      address: "9 Side St",
      city: "Miami",
      province: "FL",
      postalCode: "33132",
      email: "hello@unverified.example",
      emailVerifiedAt: null,
      phone: null,
      website: null,
      landingPage: null,
    },
    {
      id: "biz_4",
      name: "No Email Co",
      address: "12 Back St",
      city: "Miami",
      province: "FL",
      postalCode: "33133",
      email: null,
      emailVerifiedAt: null,
      phone: null,
      website: null,
      landingPage: null,
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

describe("complianceFooterOf", () => {
  test("slices the exact footer after the LAST \\n\\n—\\n separator", () => {
    expect(complianceFooterOf("body\n\n—\n1 Main St\nUnsubscribe: x")).toBe(
      "1 Main St\nUnsubscribe: x",
    );
    expect(complianceFooterOf("no footer here")).toBe("");
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
    // The mandatory footer + the composed address are on the data row. The
    // humanized note (A13) contains a quote, so in the RFC-4180 cell it is
    // escaped to `""no""` — assert the CSV-escaped form, not the raw constant.
    expect(res.csv).toContain(DEFAULT_UNSUBSCRIBE_NOTE.replace(/"/g, '""'));
    expect(res.csv).toContain("won't email again");
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

  // ── T3/B3 · per-recipient compliance columns ───────────────────────────────

  test("B3 · complianceFooter carries the exact footer after the \\n\\n—\\n separator", async () => {
    mockBusinesses();
    const footer =
      "1 Main St, Miami, FL, 33131\nJust reply 'no' and I won't email again.";
    const withFooter = {
      ...draftWithAddr,
      body: `Hi — you have 3 unanswered reviews.\n\n—\n${footer}`,
    };
    const res = await exportDraftsCsv([withFooter]);
    expect(cellOf(res.csv, "complianceFooter")).toBe(footer);
  });

  test("B3 · complianceFooter is empty when the body has no footer separator (non-email)", async () => {
    mockBusinesses();
    const dm = { ...draftWithAddr, channel: "dm" }; // dm bodies carry no footer
    const res = await exportDraftsCsv([dm]);
    expect(cellOf(res.csv, "complianceFooter")).toBe("");
  });

  test("B3 · consentBasis resolves via the (email, businessId) fallback lookup", async () => {
    mockBusinesses();
    prismaMock.consentRecord.findMany.mockResolvedValue([
      {
        email: "owner@glowspa.com",
        businessId: "biz_1",
        basis: "CONSPICUOUS_PUBLICATION",
      },
    ]);
    const res = await exportDraftsCsv([draftWithAddr]);
    expect(cellOf(res.csv, "consentBasis")).toBe("CONSPICUOUS_PUBLICATION");
  });

  test("B3 · consentBasis prefers the draft's consentRecordId when stamped", async () => {
    mockBusinesses();
    prismaMock.consentRecord.findMany.mockResolvedValue([
      { id: "con_9", basis: "EXPRESS" },
    ]);
    const res = await exportDraftsCsv([
      { ...draftWithAddr, consentRecordId: "con_9" },
    ]);
    expect(cellOf(res.csv, "consentBasis")).toBe("EXPRESS");
    // The id path answered — no second (pair) query needed.
    expect(prismaMock.consentRecord.findMany).toHaveBeenCalledTimes(1);
  });

  test("B3 · consentBasis is empty with no record on file", async () => {
    mockBusinesses();
    const res = await exportDraftsCsv([draftWithAddr]);
    expect(cellOf(res.csv, "consentBasis")).toBe("");
  });

  // ── T3/B5 · emailVerified warning column (no hard gate) ────────────────────

  test("B5 · emailVerified reads yes / no / blank from the Business verification state", async () => {
    mockBusinesses();
    const res = await exportDraftsCsv([
      draftWithAddr, // biz_1 · email + emailVerifiedAt → "yes"
      { ...draftWithAddr, id: "draft_3", businessId: "biz_3" }, // email, never verified → "no"
      { ...draftWithAddr, id: "draft_4", businessId: "biz_4" }, // no email → ""
    ]);
    expect(res.exported).toBe(3); // warning column only — nothing gated
    expect(cellOf(res.csv, "emailVerified", 0)).toBe("yes");
    expect(cellOf(res.csv, "emailVerified", 1)).toBe("no");
    expect(cellOf(res.csv, "emailVerified", 2)).toBe("");
  });

  test("WP6-6 · includes contact + evidence merge-field columns", async () => {
    mockBusinesses();
    const withEvidence = {
      ...draftWithAddr,
      whyJson: {
        why: ["Unanswered negative reviews", "Slow LCP"],
        usedSignals: ["unanswered_negative", "slow_site"],
        sequenceStep: 1,
        sequenceOf: 3,
      },
    };
    const res = await exportDraftsCsv([withEvidence]);
    const header = res.csv.split("\n")[0];
    // Contact columns (Instantly/Smartlead lead fields).
    expect(header).toContain("phone");
    expect(header).toContain("website");
    // Evidence merge fields carry usedSignals + the sequence position.
    expect(header).toContain("signals");
    expect(header).toContain("sequenceOf");
    // The row carries the real contact + signal values.
    expect(res.csv).toContain("+1 305 555 0100");
    expect(res.csv).toContain("https://glowspa.example");
    expect(res.csv).toContain("unanswered_negative;slow_site");
    expect(res.csv).toContain("Unanswered negative reviews | Slow LCP");
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
