// Dev seed data · 500 sample businesses + 5K reviews + ~100 Lighthouse audits.
//
// Goal: realistic dev data so SMB dashboard + Hunter UI can be exercised
// locally and in CI without hitting external APIs.
//
// Coverage:
// - 500 businesses across 5 metros × 3 categories (med-spa, auto-body, restaurant)
// - ~10 reviews per business (5,000 total), with realistic star + sentiment distribution
// - 100 Lighthouse audits (covering 20% of businesses)
//
// Idempotent: all rows are keyed by a deterministic slug prefix `dev-seed-`.
// Re-running upserts; safe to invoke repeatedly. Use scripts/cleanup-dev.ts
// (or `DELETE FROM "Business" WHERE slug LIKE 'dev-seed-%'`) to remove.
//
// Invoke via `pnpm seed:dev`. Requires DATABASE_URL in env.
//
// Per .claude/rules/scalability.md · uses createMany for batch inserts and
// skipDuplicates so a partial prior run is safe.

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";

// ---------- deterministic PRNG so the same seed produces the same data ----

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xc0c0); // C.0 seed
function rng<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function rngInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function rngFloat(min: number, max: number, precision = 2): number {
  const v = rand() * (max - min) + min;
  return Number(v.toFixed(precision));
}

// ---------- domain reference data ----------------------------------------

interface Metro {
  city: string;
  province: string;
  country: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

const METROS: readonly Metro[] = [
  {
    city: "Miami",
    province: "FL",
    country: "US",
    lat: 25.7617,
    lng: -80.1918,
    radiusKm: 15,
  },
  {
    city: "Toronto",
    province: "ON",
    country: "CA",
    lat: 43.6532,
    lng: -79.3832,
    radiusKm: 18,
  },
  {
    city: "Los Angeles",
    province: "CA",
    country: "US",
    lat: 34.0522,
    lng: -118.2437,
    radiusKm: 25,
  },
  {
    city: "New York",
    province: "NY",
    country: "US",
    lat: 40.7128,
    lng: -74.006,
    radiusKm: 20,
  },
  {
    city: "Calgary",
    province: "AB",
    country: "CA",
    lat: 51.0447,
    lng: -114.0719,
    radiusKm: 15,
  },
];

const CATEGORIES = ["med_spa", "auto_body", "restaurant"] as const;
type Category = (typeof CATEGORIES)[number];

const NAME_PARTS: Record<Category, { prefixes: string[]; suffixes: string[] }> =
  {
    med_spa: {
      prefixes: [
        "Aurora",
        "Bella",
        "Glow",
        "Lumen",
        "Pure",
        "Radiance",
        "Sapphire",
        "Velvet",
        "Halo",
        "Nova",
        "Soleil",
        "Lotus",
      ],
      suffixes: [
        "Med Spa",
        "Aesthetics",
        "Skin Clinic",
        "Wellness",
        "Beauty Bar",
        "Laser Center",
      ],
    },
    auto_body: {
      prefixes: [
        "Apex",
        "Bumper",
        "Chrome",
        "Diamond",
        "Eagle",
        "Fender",
        "Gear",
        "Horizon",
        "Iron",
        "Jet",
        "Kraft",
        "Legacy",
      ],
      suffixes: [
        "Auto Body",
        "Collision",
        "Paint & Body",
        "Auto Repair",
        "Body Shop",
        "Garage",
      ],
    },
    restaurant: {
      prefixes: [
        "The",
        "Casa",
        "Little",
        "Old",
        "Blue",
        "Red",
        "Golden",
        "Green",
        "Silver",
        "Iron",
        "Wild",
        "Coastal",
      ],
      suffixes: [
        "Kitchen",
        "Bistro",
        "Cantina",
        "Grill",
        "Tavern",
        "Cafe",
        "Diner",
        "Brasserie",
        "Eatery",
      ],
    },
  };

const STREET_NAMES = [
  "Main",
  "Oak",
  "Pine",
  "Maple",
  "Cedar",
  "Elm",
  "Park",
  "Lake",
  "Hill",
  "Ocean",
  "Sunset",
  "Lincoln",
  "Washington",
  "Madison",
  "Jefferson",
];
const STREET_TYPES = ["St", "Ave", "Blvd", "Rd", "Way", "Pl"];

const POSITIVE_REVIEWS = [
  "Absolutely loved my visit. The staff were attentive and the results exceeded my expectations.",
  "Best experience I've had in years. Highly recommend to anyone looking for quality.",
  "Friendly team, clean facility, fair prices. Will be back!",
  "Five stars. Professional from start to finish.",
  "They went above and beyond. Couldn't be happier with the outcome.",
  "Wonderful service and a relaxing atmosphere. I felt taken care of.",
];
const NEUTRAL_REVIEWS = [
  "Decent service overall. Nothing exceptional, but no complaints either.",
  "Got what I came for. Reasonable wait time. Standard experience.",
  "Average. The location is convenient, parking can be tight.",
  "It was fine. I might come back if I'm in the area.",
];
const NEGATIVE_REVIEWS = [
  "Disappointing experience. Felt rushed and the result didn't match what I asked for.",
  "Overpriced for what you get. Would not recommend.",
  "Long wait, poor communication. Manager never responded to my concerns.",
  "Not what I expected. Staff seemed inattentive and the facility needs work.",
  "Would not return. Issues with billing on top of subpar service.",
];

const THEMES_BY_SENTIMENT: Record<
  "positive" | "neutral" | "negative",
  string[][]
> = {
  positive: [
    ["service", "professional"],
    ["clean", "atmosphere"],
    ["price", "value"],
    ["friendly", "staff"],
    ["results", "quality"],
  ],
  neutral: [["service"], ["wait", "time"], ["location"], ["price"]],
  negative: [
    ["wait", "time"],
    ["staff", "communication"],
    ["price", "billing"],
    ["results", "quality"],
    ["cleanliness"],
  ],
};

// ---------- helpers -------------------------------------------------------

function slugify(...parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function pickInitials(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return `${letters[rngInt(0, 25)]}.${letters[rngInt(0, 25)]}.`;
}

function jitterCoord(center: number, radiusKm: number): number {
  // ~0.009 deg latitude per km. Jitter uniformly within radius.
  const km = (rand() * 2 - 1) * radiusKm;
  return Number((center + km * 0.009).toFixed(6));
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

// ---------- core generators ----------------------------------------------

interface BizSeed {
  slug: string;
  name: string;
  category: Category;
  city: string;
  province: string;
  country: string;
  address: string;
  postalCode: string;
  lat: number;
  lng: number;
  phone: string;
  website: string;
  rating: number;
  reviewCount: number;
  photosCount: number;
  isClaimed: boolean;
  firstSeenOnGoogle: Date;
  yearsOnGoogle: number;
}

function buildBusinesses(count: number): BizSeed[] {
  const out: BizSeed[] = [];
  const perCell = Math.ceil(count / (METROS.length * CATEGORIES.length));
  let idx = 0;
  for (const metro of METROS) {
    for (const category of CATEGORIES) {
      const parts = NAME_PARTS[category];
      for (let i = 0; i < perCell && out.length < count; i++) {
        const prefix = rng(parts.prefixes);
        const suffix = rng(parts.suffixes);
        const name = `${prefix} ${suffix}`;
        const seq = String(idx).padStart(4, "0");
        const slug = `dev-seed-${slugify(metro.city)}-${category.replace(/_/g, "-")}-${slugify(prefix, suffix)}-${seq}`;
        const streetNum = rngInt(100, 9999);
        const street = `${streetNum} ${rng(STREET_NAMES)} ${rng(STREET_TYPES)}`;
        const postal =
          metro.country === "CA"
            ? `${String.fromCharCode(65 + rngInt(0, 25))}${rngInt(1, 9)}${String.fromCharCode(65 + rngInt(0, 25))} ${rngInt(1, 9)}${String.fromCharCode(65 + rngInt(0, 25))}${rngInt(1, 9)}`
            : String(rngInt(10000, 99999));
        const phoneArea = rngInt(200, 999);
        const phone = `+1-${phoneArea}-${rngInt(200, 999)}-${rngInt(1000, 9999)}`;
        const website = `https://${slug}.example.com`;
        // Skewed-positive rating distribution
        const rating = rngFloat(3.4 + rand() * 1.4, 3.6 + rand() * 1.4, 1);
        const clampedRating = Math.min(5, Math.max(2.5, rating));
        const reviewCount = rngInt(8, 380);
        const photosCount = rngInt(0, 60);
        const yrs = rngInt(1, 12);
        out.push({
          slug,
          name,
          category,
          city: metro.city,
          province: metro.province,
          country: metro.country,
          address: street,
          postalCode: postal,
          lat: jitterCoord(metro.lat, metro.radiusKm),
          lng: jitterCoord(metro.lng, metro.radiusKm),
          phone,
          website,
          rating: clampedRating,
          reviewCount,
          photosCount,
          isClaimed: rand() < 0.18,
          firstSeenOnGoogle: daysAgo(yrs * 365 + rngInt(0, 90)),
          yearsOnGoogle: yrs,
        });
        idx++;
      }
    }
  }
  return out.slice(0, count);
}

interface ReviewSeed {
  externalId: string;
  reviewerName: string;
  stars: number;
  text: string;
  language: string;
  postedAt: Date;
  ownerReplied: boolean;
  ownerReplyText: string | null;
  ownerReplyAt: Date | null;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  themes: string[];
  isUrgent: boolean;
}

function buildReviewsForBiz(
  biz: BizSeed,
  perBizAvg: number,
  baseSeq: number,
): ReviewSeed[] {
  const target = Math.max(0, perBizAvg + rngInt(-3, 3));
  const reviews: ReviewSeed[] = [];
  // Replicate the rating distribution: bias star draws to the biz's average
  for (let i = 0; i < target; i++) {
    const roll = rand();
    let stars: number;
    if (biz.rating >= 4.5) {
      stars = roll < 0.78 ? 5 : roll < 0.92 ? 4 : roll < 0.97 ? 3 : roll < 0.99 ? 2 : 1;
    } else if (biz.rating >= 4.0) {
      stars = roll < 0.55 ? 5 : roll < 0.82 ? 4 : roll < 0.93 ? 3 : roll < 0.98 ? 2 : 1;
    } else if (biz.rating >= 3.5) {
      stars = roll < 0.35 ? 5 : roll < 0.65 ? 4 : roll < 0.85 ? 3 : roll < 0.95 ? 2 : 1;
    } else {
      stars = roll < 0.18 ? 5 : roll < 0.4 ? 4 : roll < 0.62 ? 3 : roll < 0.82 ? 2 : 1;
    }
    const sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" =
      stars >= 4 ? "POSITIVE" : stars === 3 ? "NEUTRAL" : "NEGATIVE";
    const text =
      sentiment === "POSITIVE"
        ? rng(POSITIVE_REVIEWS)
        : sentiment === "NEUTRAL"
          ? rng(NEUTRAL_REVIEWS)
          : rng(NEGATIVE_REVIEWS);
    const themes = rng(
      THEMES_BY_SENTIMENT[
        sentiment === "POSITIVE"
          ? "positive"
          : sentiment === "NEUTRAL"
            ? "neutral"
            : "negative"
      ],
    );
    const language = biz.province === "QC" ? "fr" : rand() < 0.85 ? "en" : "es";
    const postedAt = daysAgo(rngInt(1, 540));
    const ownerReplied = rand() < (sentiment === "POSITIVE" ? 0.42 : 0.18);
    const ownerReplyAt = ownerReplied
      ? new Date(postedAt.getTime() + rngInt(1, 14) * 86_400_000)
      : null;
    const ownerReplyText = ownerReplied
      ? sentiment === "POSITIVE"
        ? "Thank you so much for sharing! We're delighted you enjoyed your visit."
        : "Thank you for the feedback. We'd like to make this right — please reach out so we can follow up."
      : null;
    const ageDays = Math.floor(
      (Date.now() - postedAt.getTime()) / 86_400_000,
    );
    const isUrgent = stars === 1 && !ownerReplied && ageDays > 7;
    reviews.push({
      externalId: `dev-rev-${baseSeq + i}-${biz.slug.slice(-12)}`,
      reviewerName: pickInitials(),
      stars,
      text: `${text}`,
      language,
      postedAt,
      ownerReplied,
      ownerReplyText,
      ownerReplyAt,
      sentiment,
      themes: [...themes],
      isUrgent,
    });
  }
  return reviews;
}

interface LighthouseSeed {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  lcp: number;
  cls: number;
  inp: number;
  fcp: number;
  tbt: number;
  ttfb: number;
  totalBytes: number;
  hasLocalBusinessSchema: boolean;
  hasFaqSchema: boolean;
  hasBookingCtaAboveFold: boolean;
  hasPhoneAboveFold: boolean;
  napConsistent: boolean;
  techStack: string[];
}

function buildLighthouseAudit(): LighthouseSeed {
  const techStacks = [
    ["WordPress", "PHP"],
    ["Squarespace"],
    ["Wix"],
    ["Shopify"],
    ["Webflow"],
    ["Next.js", "React"],
    ["Custom HTML"],
  ];
  return {
    performance: rngInt(30, 96),
    accessibility: rngInt(60, 99),
    bestPractices: rngInt(60, 100),
    seo: rngInt(55, 100),
    lcp: rngFloat(1.1, 6.5, 2),
    cls: rngFloat(0, 0.45, 3),
    inp: rngInt(80, 520),
    fcp: rngFloat(0.8, 4.2, 2),
    tbt: rngInt(20, 900),
    ttfb: rngFloat(0.1, 2.4, 2),
    totalBytes: rngInt(180_000, 4_500_000),
    hasLocalBusinessSchema: rand() < 0.42,
    hasFaqSchema: rand() < 0.18,
    hasBookingCtaAboveFold: rand() < 0.55,
    hasPhoneAboveFold: rand() < 0.62,
    napConsistent: rand() < 0.78,
    techStack: rng(techStacks),
  };
}

// ---------- main ---------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const TARGET_BUSINESSES = Number(process.env.SEED_BUSINESSES ?? 500);
  const TARGET_REVIEWS = Number(process.env.SEED_REVIEWS ?? 5000);
  const TARGET_LIGHTHOUSE = Number(process.env.SEED_LIGHTHOUSE ?? 100);
  const PER_BIZ_REVIEWS = Math.max(
    1,
    Math.round(TARGET_REVIEWS / TARGET_BUSINESSES),
  );

  console.log(
    `[seed-dev] target · ${TARGET_BUSINESSES} businesses · ${TARGET_REVIEWS} reviews (~${PER_BIZ_REVIEWS}/biz) · ${TARGET_LIGHTHOUSE} lighthouse audits`,
  );

  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  const businesses = buildBusinesses(TARGET_BUSINESSES);

  // --- Upsert businesses in batches of 50 -------------------------------
  let bizInserted = 0;
  let bizSkipped = 0;
  for (let i = 0; i < businesses.length; i += 50) {
    const batch = businesses.slice(i, i + 50);
    const result = await prisma.business.createMany({
      data: batch.map((b) => ({
        name: b.name,
        slug: b.slug,
        category: b.category,
        categories: [b.category],
        address: b.address,
        city: b.city,
        province: b.province,
        country: b.country,
        postalCode: b.postalCode,
        lat: b.lat,
        lng: b.lng,
        phone: b.phone,
        website: b.website,
        rating: b.rating,
        reviewCount: b.reviewCount,
        photosCount: b.photosCount,
        isClaimed: b.isClaimed,
        isActive: true,
        firstSeenOnGoogle: b.firstSeenOnGoogle,
        yearsOnGoogle: b.yearsOnGoogle,
        lastRefreshedAt: new Date(),
      })),
      skipDuplicates: true,
    });
    bizInserted += result.count;
    bizSkipped += batch.length - result.count;
  }
  console.log(
    `[seed-dev] businesses · inserted ${bizInserted} · skipped ${bizSkipped} (idempotent)`,
  );

  // --- Resolve IDs for all seeded businesses ----------------------------
  const bizRows = await prisma.business.findMany({
    where: { slug: { startsWith: "dev-seed-" } },
    select: { id: true, slug: true, rating: true, province: true },
  });
  const bizBySlug = new Map<string, (typeof bizRows)[number]>();
  for (const row of bizRows) bizBySlug.set(row.slug, row);

  // --- Generate + insert reviews ----------------------------------------
  let reviewsInserted = 0;
  let reviewsSkipped = 0;
  let seq = 0;
  for (let i = 0; i < businesses.length; i++) {
    const seed = businesses[i]!;
    const row = bizBySlug.get(seed.slug);
    if (!row) continue;
    const reviews = buildReviewsForBiz(seed, PER_BIZ_REVIEWS, seq);
    seq += reviews.length;
    if (reviews.length === 0) continue;
    const result = await prisma.review.createMany({
      data: reviews.map((r) => ({
        businessId: row.id,
        externalId: r.externalId,
        reviewerName: r.reviewerName,
        stars: r.stars,
        text: r.text,
        language: r.language,
        postedAt: r.postedAt,
        ownerReplied: r.ownerReplied,
        ownerReplyText: r.ownerReplyText,
        ownerReplyAt: r.ownerReplyAt,
        sentiment: r.sentiment,
        themes: r.themes,
        isUrgent: r.isUrgent,
      })),
      skipDuplicates: true,
    });
    reviewsInserted += result.count;
    reviewsSkipped += reviews.length - result.count;
  }
  console.log(
    `[seed-dev] reviews · inserted ${reviewsInserted} · skipped ${reviewsSkipped} (idempotent)`,
  );

  // --- Lighthouse audits for 100 businesses -----------------------------
  // Pick first N businesses by slug order for determinism.
  const lhTargets = bizRows
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(0, TARGET_LIGHTHOUSE);

  // Idempotency: if any audit row exists for the business within the last day,
  // skip. Otherwise insert. Use a single SELECT to find existing rows.
  const existingLh = await prisma.lighthouseAudit.findMany({
    where: { businessId: { in: lhTargets.map((b) => b.id) } },
    select: { businessId: true },
  });
  const lhExistingSet = new Set(existingLh.map((r) => r.businessId));
  const lhNew = lhTargets.filter((b) => !lhExistingSet.has(b.id));
  let lhInserted = 0;
  if (lhNew.length > 0) {
    const result = await prisma.lighthouseAudit.createMany({
      data: lhNew.map((b) => {
        const a = buildLighthouseAudit();
        return {
          businessId: b.id,
          performance: a.performance,
          accessibility: a.accessibility,
          bestPractices: a.bestPractices,
          seo: a.seo,
          lcp: a.lcp,
          cls: a.cls,
          inp: a.inp,
          fcp: a.fcp,
          tbt: a.tbt,
          ttfb: a.ttfb,
          totalBytes: a.totalBytes,
          hasLocalBusinessSchema: a.hasLocalBusinessSchema,
          hasFaqSchema: a.hasFaqSchema,
          hasBookingCtaAboveFold: a.hasBookingCtaAboveFold,
          hasPhoneAboveFold: a.hasPhoneAboveFold,
          napConsistent: a.napConsistent,
          techStack: a.techStack,
        };
      }),
      skipDuplicates: true,
    });
    lhInserted = result.count;
  }
  console.log(
    `[seed-dev] lighthouse · inserted ${lhInserted} · already-had-audit ${lhExistingSet.size}`,
  );

  // --- Summary counts ---------------------------------------------------
  const [bizCount, reviewCount, lhCount] = await Promise.all([
    prisma.business.count({ where: { slug: { startsWith: "dev-seed-" } } }),
    prisma.review.count({
      where: { business: { slug: { startsWith: "dev-seed-" } } },
    }),
    prisma.lighthouseAudit.count({
      where: { business: { slug: { startsWith: "dev-seed-" } } },
    }),
  ]);

  console.log(
    `[seed-dev] totals · businesses=${bizCount} · reviews=${reviewCount} · lighthouse=${lhCount}`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
