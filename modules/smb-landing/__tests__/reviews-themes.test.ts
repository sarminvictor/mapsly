/**
 * Landing services-block rework · invariants.
 *
 * The "What services {noun} mention in your reviews?" block used to render
 * Google's raw placeTopics keywords ("YYC 18", "april 9", "clinic 35") — pure
 * noise. It now sources `reviews.themes` from the AI-tagged
 * `Review.mentionedServices` array (canonical BusinessService names),
 * aggregated with unnest + GROUP BY over ALL collected reviews.
 *
 * Pinned here:
 *
 *  1. **Aggregation mapping** — the unnest rows ({ name, count: bigint })
 *     become the stable `{ label, count: number }[]` themes shape, order
 *     preserved (SQL already sorts DESC and caps at 6), portal-identical 12-month window
 *     and the businessId is bound as a parameter.
 *  2. **Zero rows → empty themes** — NO fallback to placeTopics. The noise
 *     being removed must never leak back, even if the business row carries
 *     a placeTopics payload.
 *  3. **Section heading uses the campaign noun** — "What services patients
 *     mention in your reviews?" (med spa → patients), the "mentioned by
 *     {noun}" attribution stays, and the empty state says "…once your
 *     reviews are analyzed."
 *
 * Components are rendered via react-dom/server (node env, no DOM) with
 * `createElement` instead of JSX so this stays a plain .ts file like the
 * module's other tests.
 */

import { createElement } from "react";
import { serviceMentionWindowStart } from "@/lib/review-window";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// `next/cache` apis are no-ops outside the Next runtime; stub them so the
// queries module is importable in vitest.
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_noStore: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  business: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  businessKeyword: { findMany: vi.fn() },
  adLibraryEntry: { count: vi.fn() },
  adMarketAdvertiser: { findMany: vi.fn(), aggregate: vi.fn() },
  review: { count: vi.fn(), groupBy: vi.fn() },
  lighthouseAudit: { findFirst: vi.fn() },
  cellMetric: { findFirst: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

// The market-overview core is out of scope here — null exercises the
// landing's own section builders without the smb-home pipeline.
vi.mock("@/modules/smb-home/queries", () => ({
  buildOverviewForBusiness: vi.fn().mockResolvedValue(null),
}));

import { ReviewsSection } from "../components/sections/Reviews";
import { getLandingData } from "../queries";
import type { LandingCopy, LandingReviewsData } from "../types";

const BIZ_ID = "biz_test_themes_1";

/** Minimal city-less business row — no city/country means no cell-cohort
 * queries fire, isolating the themes path. The placeTopics noise is included
 * ON PURPOSE: the select no longer asks for it, and even a row that carries
 * it must not surface in themes. */
function seedPrisma(serviceRows: { name: string; count: bigint }[]) {
  prismaMock.business.findUnique.mockResolvedValue({
    id: BIZ_ID,
    name: "Test Spa",
    slug: "test-spa",
    category: "Medical spa",
    address: null,
    city: null,
    province: null,
    country: null,
    website: null,
    rating: 4.8,
    reviewCount: 40,
    placeTopics: { "YYC 18": 18, "april 9": 9, "clinic 35": 35 },
    snapshots: [],
  });
  prismaMock.businessKeyword.findMany.mockResolvedValue([]);
  prismaMock.adLibraryEntry.count.mockResolvedValue(0);
  prismaMock.adMarketAdvertiser.aggregate.mockResolvedValue({
    _sum: { activeAdCount: 0 },
  });
  prismaMock.review.count.mockResolvedValue(0);
  prismaMock.review.groupBy.mockResolvedValue([]);
  prismaMock.lighthouseAudit.findFirst.mockResolvedValue(null);
  prismaMock.$queryRaw.mockResolvedValue(serviceRows);
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------- themes from mentionedServices */

describe("getLandingData · themes from Review.mentionedServices", () => {
  test("maps unnest rows to { label, count } with bigint counts coerced", async () => {
    seedPrisma([
      { name: "Dermal fillers", count: 25n },
      { name: "Botox", count: 15n },
    ]);

    const data = await getLandingData(BIZ_ID);

    expect(data?.reviews.themes).toEqual([
      { label: "Dermal fillers", count: 25 },
      { label: "Botox", count: 15 },
    ]);
  });

  test("aggregation is parameterized by businessId, capped at 6, portal-identical 12-month window", async () => {
    seedPrisma([]);
    await getLandingData(BIZ_ID);

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = prismaMock.$queryRaw.mock.calls[0] as [
      readonly string[],
      ...unknown[],
    ];
    const sql = strings.join("?");
    expect(sql).toContain('unnest("mentionedServices")');
    expect(sql).toContain("GROUP BY name");
    expect(sql).toContain("ORDER BY count DESC");
    expect(sql).toContain("LIMIT 6");
    // MUST use the same window as the portal's ServiceMentionsCard —
    // /l and /reviews showing different counts for the same business
    // reads as fake data (caught live 2026-06-10: 25 vs 21).
    expect(sql).toContain('"postedAt" >=');
    const windowParam = values.find((v) => v instanceof Date) as Date;
    expect(windowParam).toEqual(serviceMentionWindowStart());
    expect(values).toContain(BIZ_ID);
  });

  test("zero tagged services → empty themes, NO placeTopics fallback", async () => {
    seedPrisma([]);

    const data = await getLandingData(BIZ_ID);

    expect(data?.reviews.themes).toEqual([]);
    // The Google raw-keyword noise that prompted the rework must never
    // resurface anywhere in the reviews payload.
    expect(JSON.stringify(data?.reviews)).not.toContain("YYC");
    expect(JSON.stringify(data?.reviews)).not.toContain("april 9");
    // Section still renders (rating/review data present) — only themes empty.
    expect(data?.reviews.hasData).toBe(true);
  });
});

/* ------------------------------------------------- section heading + noun */

const SECTION_COPY: LandingCopy["reviews"] = {
  eyebrow: "Reviews",
  title: "What patients say about you",
  emphasis: "",
  intro: "",
  gap: null,
};

const REVIEWS_WITH_THEMES: LandingReviewsData = {
  hasData: true,
  rating: 4.8,
  reviewCount: 40,
  replyRate: 0.5,
  unanswered: 20,
  trend30d: 3,
  yourRank: 2,
  rankedTotal: 12,
  themes: [
    { label: "Dermal fillers", count: 25 },
    { label: "Botox", count: 15 },
  ],
  competitors: [],
  pillar: 7.5,
};

function renderSection(reviews: LandingReviewsData): string {
  return renderToStaticMarkup(
    createElement(ReviewsSection, {
      reviews,
      copy: SECTION_COPY,
      noun: "patients",
      ctaHref: "#pricing",
    }),
  );
}

describe("ReviewsSection · services block heading", () => {
  test("heading uses the campaign noun, not hardcoded 'clients'", () => {
    const out = renderSection(REVIEWS_WITH_THEMES);
    expect(out).toContain("What services patients mention in your reviews?");
    expect(out).not.toContain("What services clients mention");
  });

  test("theme cards keep the 'mentioned by {noun}' attribution + counts", () => {
    const out = renderSection(REVIEWS_WITH_THEMES);
    expect(out).toContain("Dermal fillers");
    expect(out).toContain("Botox");
    expect(out).toContain("mentioned by patients");
    expect(out).toContain("times");
  });

  test("empty themes show the analyzed empty-state line", () => {
    const out = renderSection({ ...REVIEWS_WITH_THEMES, themes: [] });
    expect(out).toContain(
      "ll surface the services patients mention once your reviews are analyzed.",
    );
  });
});
