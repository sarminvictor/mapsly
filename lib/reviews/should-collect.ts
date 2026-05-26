// lib/reviews/should-collect.ts
//
// Cost-discipline gate · only pull reviews for businesses in locations
// where we have ≥1 paid relationship (SMB owner subscription OR agency
// plan holding this business as a Lead). Per Viktor's review-system
// design: "we should not start and collect reviews for this location...
// we will save money and collect and update info only for locations,
// where we have paid users."
//
// "Location" definition: (city, country, category) cell. If any business
// in that cell is paid (or represented by a paid agency), reviews are
// pulled for ALL businesses in the cell — this gives the paid user a
// real competitor benchmark.
//
// Env override:
//   MAPSLY_COLLECT_REVIEWS_ALLOW_ALL=1 — skip the gate entirely. Used
//   for initial Calgary backfill (no paid users yet) and for end-to-end
//   testing. Default OFF; set explicitly in .env.local / Vercel env to
//   enable. SHOULD NOT BE LEFT ON in production once the first paid
//   user signs up — the loop's daily cost-audit will flag it.

import prisma from "@/lib/prisma";

const PAID_STRIPE_STATUSES = new Set(["active", "trialing"]);

interface BusinessLocation {
  city: string;
  country: string;
  category: string;
}

/**
 * Returns true if this business is eligible for review collection.
 *
 * Eligible iff at least one of:
 *   - Override env var MAPSLY_COLLECT_REVIEWS_ALLOW_ALL is "1"
 *   - The business owner has an active SMB subscription
 *   - The business is held as a Lead by an agency with active plan
 *   - Any co-located business (same city + country + category) satisfies
 *     either of the above
 *
 * One query, indexed via `Business.(category, city)` + `Business.(country, province, city)`.
 */
export async function shouldCollectReviewsForBusiness(
  businessId: string,
): Promise<boolean> {
  if (process.env.MAPSLY_COLLECT_REVIEWS_ALLOW_ALL === "1") {
    return true;
  }

  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      city: true,
      country: true,
      category: true,
      ownerUserId: true,
      owner: { select: { stripeStatus: true } },
      leads: {
        take: 1,
        select: { agency: { select: { stripeStatus: true } } },
      },
    },
  });
  if (!biz) return false;

  // Fast path · this business directly has a paid relationship.
  if (
    biz.owner?.stripeStatus &&
    PAID_STRIPE_STATUSES.has(biz.owner.stripeStatus)
  ) {
    return true;
  }
  if (
    biz.leads.some(
      (l) =>
        l.agency?.stripeStatus &&
        PAID_STRIPE_STATUSES.has(l.agency.stripeStatus),
    )
  ) {
    return true;
  }

  // Co-location check · any sibling business in the same (city, country,
  // category) cell with a paid relationship.
  if (!biz.city || !biz.country || !biz.category) {
    return false;
  }

  return hasPaidCoLocation({
    city: biz.city,
    country: biz.country,
    category: biz.category,
  });
}

/**
 * Returns true if ANY business in the given (city, country, category)
 * cell has a paid owner OR is held as a Lead by a paid agency.
 *
 * Useful as a pre-flight check before enqueueing a bulk pull for a
 * whole TrackedLocation cell — avoids spending money to discover that
 * none of the businesses qualify.
 */
export async function hasPaidCoLocation(
  loc: BusinessLocation,
): Promise<boolean> {
  if (process.env.MAPSLY_COLLECT_REVIEWS_ALLOW_ALL === "1") return true;

  const paid = await prisma.business.findFirst({
    where: {
      city: loc.city,
      country: loc.country,
      category: loc.category,
      OR: [
        {
          owner: {
            is: {
              stripeStatus: { in: Array.from(PAID_STRIPE_STATUSES) },
            },
          },
        },
        {
          leads: {
            some: {
              agency: {
                stripeStatus: { in: Array.from(PAID_STRIPE_STATUSES) },
              },
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  return paid != null;
}

/**
 * Bulk filter · returns the subset of business IDs eligible for review
 * collection. Used by R.7 admin "Collect reviews for filtered" bulk
 * action and by R.3 weekly delta cron to filter candidates in one shot.
 *
 * Returns IDs in the same relative order as input. Drops ineligible IDs.
 */
export async function filterEligibleBusinesses(
  businessIds: string[],
): Promise<string[]> {
  if (businessIds.length === 0) return [];
  if (process.env.MAPSLY_COLLECT_REVIEWS_ALLOW_ALL === "1") {
    return [...businessIds];
  }

  // Pull (city, country, category, owner.stripeStatus, leads) once for
  // all ids, then derive eligibility cell-by-cell to avoid an N+1.
  const businesses = await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: {
      id: true,
      city: true,
      country: true,
      category: true,
      ownerUserId: true,
      owner: { select: { stripeStatus: true } },
      leads: {
        take: 1,
        select: { agency: { select: { stripeStatus: true } } },
      },
    },
  });

  const byId = new Map(businesses.map((b) => [b.id, b]));

  // Group by (city, country, category) cell so we only check each cell once.
  const cells = new Map<
    string,
    { city: string; country: string; category: string }
  >();
  for (const b of businesses) {
    if (!b.city || !b.country || !b.category) continue;
    const key = `${b.country}\x00${b.city}\x00${b.category}`;
    cells.set(key, { city: b.city, country: b.country, category: b.category });
  }

  // Resolve cell paid-status in parallel.
  const cellPaidness = new Map<string, boolean>();
  await Promise.all(
    Array.from(cells.entries()).map(async ([key, loc]) => {
      cellPaidness.set(key, await hasPaidCoLocation(loc));
    }),
  );

  return businessIds.filter((id) => {
    const b = byId.get(id);
    if (!b) return false;
    // Direct paid?
    if (
      b.owner?.stripeStatus &&
      PAID_STRIPE_STATUSES.has(b.owner.stripeStatus)
    ) {
      return true;
    }
    if (
      b.leads.some(
        (l) =>
          l.agency?.stripeStatus &&
          PAID_STRIPE_STATUSES.has(l.agency.stripeStatus),
      )
    ) {
      return true;
    }
    // Co-located paid?
    if (!b.city || !b.country || !b.category) return false;
    const key = `${b.country}\x00${b.city}\x00${b.category}`;
    return cellPaidness.get(key) === true;
  });
}
