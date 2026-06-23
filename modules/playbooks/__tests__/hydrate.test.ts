// Phase 7 · hydrateEvidenceBundle maps DB rows into the inert EvidenceBundle
// the pure detectors consume — and crucially represents MISSING enrichments as
// `null` (never an empty array), so the driver marks signals "not checked".

import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  businessTech: { findMany: vi.fn() },
  lighthouseAudit: { findFirst: vi.fn() },
  review: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

import { hydrateEvidenceBundle } from "../hydrate";

beforeEach(() => {
  vi.clearAllMocks();
});

const BIZ = {
  id: "biz_1",
  slug: "glow-spa",
  category: "Medical Spa",
  categories: ["Aesthetics Clinic"],
  categoryIds: ["medical_spa"],
  website: "https://glow.example",
  services: [{ name: "Botox" }, { name: "Lip filler" }],
};

describe("hydrateEvidenceBundle", () => {
  test("maps fields + lowercases + de-dupes category slugs", async () => {
    prismaMock.business.findUnique.mockResolvedValue(BIZ);
    prismaMock.businessTech.findMany.mockResolvedValue([
      { name: "Meta Pixel", category: "PIXEL" },
      { name: "Acuity", category: "BOOKING" },
    ]);
    prismaMock.lighthouseAudit.findFirst.mockResolvedValue({
      accessibility: 0.7,
      opportunities: [
        { auditKey: "color-contrast", score: 0, itemCount: 12 },
        { auditKey: "image-alt", score: 0.5, itemCount: 3 },
      ],
    });
    prismaMock.review.findMany.mockResolvedValue([
      { text: "Great!", stars: 5, postedAt: new Date("2026-01-01") },
    ]);

    const ev = await hydrateEvidenceBundle("biz_1");

    expect(ev.business.id).toBe("biz_1");
    expect(ev.business.slug).toBe("glow-spa");
    expect(ev.business.website).toBe("https://glow.example");
    // "Medical Spa" + "Aesthetics Clinic" + "medical_spa" → lowercased, unique.
    expect(ev.business.categorySlugs).toEqual([
      "medical spa",
      "aesthetics clinic",
      "medical_spa",
    ]);
    expect(ev.business.services).toEqual([
      { name: "Botox" },
      { name: "Lip filler" },
    ]);

    // tech category enum lowercased; names preserved.
    expect(ev.tech).toEqual([
      { name: "Meta Pixel", category: "pixel" },
      { name: "Acuity", category: "booking" },
    ]);

    // audits map keyed by auditKey; itemCount → failingNodes.
    expect(ev.lighthouseAudits).toEqual({
      "color-contrast": { score: 0, failingNodes: 12 },
      "image-alt": { score: 0.5, failingNodes: 3 },
    });

    expect(ev.reviews).toHaveLength(1);
    expect(ev.reviews[0]).toMatchObject({ stars: 5, text: "Great!" });
  });

  test("tech is null when no BusinessTech rows scanned (not empty array)", async () => {
    prismaMock.business.findUnique.mockResolvedValue(BIZ);
    prismaMock.businessTech.findMany.mockResolvedValue([]);
    prismaMock.lighthouseAudit.findFirst.mockResolvedValue(null);
    prismaMock.review.findMany.mockResolvedValue([]);

    const ev = await hydrateEvidenceBundle("biz_1");

    // null = "not scanned" → driver marks tech-gated signals "not checked".
    expect(ev.tech).toBeNull();
    // null = "no lighthouse audit row".
    expect(ev.lighthouseAudits).toBeNull();
    // reviews always an array (may be empty).
    expect(ev.reviews).toEqual([]);
  });

  test("lighthouseAudits is an empty map (not null) when audit row exists but no opportunities", async () => {
    prismaMock.business.findUnique.mockResolvedValue(BIZ);
    prismaMock.businessTech.findMany.mockResolvedValue([]);
    prismaMock.lighthouseAudit.findFirst.mockResolvedValue({
      accessibility: 0.9,
      opportunities: null,
    });
    prismaMock.review.findMany.mockResolvedValue([]);

    const ev = await hydrateEvidenceBundle("biz_1");
    // Audit ran → map present (empty), so detectors return "no finding" not
    // "not checked".
    expect(ev.lighthouseAudits).toEqual({});
  });

  test("throws when business is missing", async () => {
    prismaMock.business.findUnique.mockResolvedValue(null);
    await expect(hydrateEvidenceBundle("nope")).rejects.toThrow(
      /business not found/,
    );
  });
});
