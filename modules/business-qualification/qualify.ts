/**
 * Qualify · per-business + per-cell qualification pipeline.
 *
 * For each business we check:
 *   1. is_claimed in Google (free · already in DB)
 *   2. reviewCount ≥ 10 (free · already in DB)
 *   3. has discoverable email (website scrape + RDAP fallback)
 *
 * Result is one of:
 *   - QUALIFIED      · claimed + ≥10 reviews + email found
 *   - DISQUALIFIED   · fails ≥1 of the above but is reachable
 *   - UNREACHABLE    · no email AND no website
 *   - FAILED         · pipeline errored (timeout, crash)
 *
 * Flags surfaced on Business.qualificationFlags so admin can see WHY
 * a business was disqualified at a glance:
 *   - "unclaimed"   · is_claimed === false
 *   - "low_reviews" · reviewCount < 10
 *   - "no_email"    · scrape + RDAP returned nothing
 *   - "no_website"  · Business.website is null
 *
 * Per `.claude/rules/scalability.md` we cap parallelism at 5
 * concurrent businesses inside a cell — polite to host sites + keeps
 * one slow timeout from cascading.
 */

import type { Prisma } from "@/lib/prisma";
import prisma from "@/lib/prisma";

import { detectAndPersistServices } from "@/services/business-services-detect";

import { rdapLookup } from "./rdap";
import { scrapeEmailsFromWebsite, type EmailCandidate } from "./scrape-email";

const MIN_REVIEWS = 10;
const PARALLEL_LIMIT = 5;

export type QualificationStatusValue =
  | "NOT_QUALIFIED"
  | "QUALIFIED"
  | "DISQUALIFIED"
  | "UNREACHABLE"
  | "FAILED";

export interface QualifyOutcome {
  businessId: string;
  status: QualificationStatusValue;
  flags: string[];
  emailDiscovered: string | null;
  emailDiscoverySource: EmailCandidate["source"] | null;
  candidatesFound: number;
  websiteUnreachable: boolean;
  // Services detected via the layered pipeline (place_topics +
  // description + service-page scrape + Google starter list)
  servicesDetected: number;
  servicesCreated: number;
}

export interface CellQualifyResult {
  trackedLocationId: string;
  attempted: number;
  qualified: number;
  disqualified: number;
  unreachable: number;
  failed: number;
  totalEmailsFound: number;
  finishedAt: Date;
}

/* --------------------------------------------------------- one business */

/**
 * Qualify a single business. Idempotent: re-running on the same
 * business overwrites the prior status + flags + email candidates.
 */
export async function qualifyBusiness(
  businessId: string,
): Promise<QualifyOutcome> {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      website: true,
      domain: true,
      reviewCount: true,
      isClaimed: true,
      // Service-detection inputs
      category: true,
      categories: true,
      categoryIds: true,
      description: true,
      placeTopics: true,
    },
  });
  if (!biz) throw new Error(`Business ${businessId} not found`);

  const flags: string[] = [];
  if (!biz.isClaimed) flags.push("unclaimed");
  if ((biz.reviewCount ?? 0) < MIN_REVIEWS) flags.push("low_reviews");

  // Email discovery · scrape FIRST, RDAP only as fallback when scrape
  // produced nothing. (RDAP rarely beats a scraped contact-page email
  // since most domains have privacy redaction.)
  let scrapeRan = false;
  let websiteUnreachable = false;
  let candidates: EmailCandidate[] = [];

  if (biz.website) {
    const scrape = await scrapeEmailsFromWebsite({
      website: biz.website,
      domain: biz.domain,
    });
    scrapeRan = true;
    websiteUnreachable = scrape.websiteUnreachable;
    candidates = scrape.candidates;
  } else {
    flags.push("no_website");
  }

  if (candidates.length === 0 && biz.domain) {
    const rdap = await rdapLookup(biz.domain);
    candidates = rdap.candidates;
  }

  const best = candidates[0] ?? null;
  if (!best) flags.push("no_email");

  // Status arbitration · order matters
  let status: QualificationStatusValue;
  if (!biz.website && !best) {
    status = "UNREACHABLE";
  } else if (best && biz.isClaimed && (biz.reviewCount ?? 0) >= MIN_REVIEWS) {
    status = "QUALIFIED";
  } else {
    status = "DISQUALIFIED";
  }

  // Persist · single update so the rest of the cell sees the new state
  await prisma.business.update({
    where: { id: biz.id },
    data: {
      qualificationStatus: status,
      qualificationFlags: flags,
      qualifiedAt: new Date(),
      emailDiscovered: best?.email ?? null,
      emailDiscoverySource: best?.source ?? null,
      emailDiscoveredAt: best ? new Date() : null,
      // Persist the top-10 candidates (audit · "why did we pick this one").
      // Cast through unknown · EmailCandidate is structurally JSON-safe
      // but TS can't prove that — the index signature on InputJsonValue
      // is what trips the strict check.
      emailCandidates: candidates.slice(
        0,
        10,
      ) as unknown as Prisma.InputJsonValue,
    },
  });

  // Service detection (4-layer pipeline · place_topics + description
  // + website /services scrape + Google starter list). Runs against
  // every business — even DISQUALIFIED ones get service rows so we
  // have a complete catalog when filtering / browsing later. Failures
  // here are non-fatal · log + continue.
  let servicesDetected = 0;
  let servicesCreated = 0;
  try {
    const detect = await detectAndPersistServices({
      businessId: biz.id,
      website: biz.website,
      category: biz.category,
      categories: biz.categories,
      categoryIds: biz.categoryIds,
      description: biz.description,
      placeTopics: biz.placeTopics,
    });
    servicesDetected = detect.candidates.length;
    servicesCreated = detect.created;
  } catch {
    // Swallow — service detection is value-add, not load-bearing.
    // If the scrape times out / regex fails / etc., qualification
    // still completes with the email + claimed/reviews checks.
  }

  return {
    businessId: biz.id,
    status,
    flags,
    emailDiscovered: best?.email ?? null,
    emailDiscoverySource: best?.source ?? null,
    candidatesFound: candidates.length,
    websiteUnreachable: scrapeRan && websiteUnreachable,
    servicesDetected,
    servicesCreated,
  };
}

/* ----------------------------------------------------- one tracked cell */

/**
 * Qualify every business currently indexed under one TrackedLocation
 * (matched by category + city + country, not by FK — the registry
 * cell is the lens, not a parent). Updates per-business state then
 * recomputes the cell's qualified/disqualified/unreachable aggregates.
 */
export async function qualifyCell(
  trackedLocationId: string,
): Promise<CellQualifyResult> {
  const cell = await prisma.trackedLocation.findUnique({
    where: { id: trackedLocationId },
    select: {
      id: true,
      city: true,
      country: true,
      province: true,
      category: { select: { dataforseoId: true } },
    },
  });
  if (!cell) {
    throw new Error(`TrackedLocation ${trackedLocationId} not found`);
  }

  // Cell membership · category appears in categoryIds, same city + country.
  // We use `category_ids` (DfS slug array) because primary `category` is
  // the display name which doesn't match our cell's dataforseoId slug.
  const businesses = await prisma.business.findMany({
    where: {
      categoryIds: { has: cell.category.dataforseoId },
      city: cell.city,
      country: cell.country,
    },
    select: { id: true },
  });

  // Bounded parallelism · 5 at a time. p-limit isn't available, so we
  // hand-roll a small worker pool.
  const outcomes: QualifyOutcome[] = [];
  const failures: Array<{ businessId: string; message: string }> = [];

  const queue = [...businesses];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      try {
        const outcome = await qualifyBusiness(next.id);
        outcomes.push(outcome);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ businessId: next.id, message });
        // Persist FAILED status so the row doesn't look untouched
        await prisma.business
          .update({
            where: { id: next.id },
            data: {
              qualificationStatus: "FAILED",
              qualifiedAt: new Date(),
            },
          })
          .catch(() => {
            // Swallow — secondary failure shouldn't mask primary
          });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_LIMIT, businesses.length) }, () =>
      worker(),
    ),
  );

  // Tallies
  const qualified = outcomes.filter((o) => o.status === "QUALIFIED").length;
  const disqualified = outcomes.filter(
    (o) => o.status === "DISQUALIFIED",
  ).length;
  const unreachable = outcomes.filter((o) => o.status === "UNREACHABLE").length;
  const totalEmailsFound = outcomes.filter(
    (o) => o.emailDiscovered != null,
  ).length;

  const finishedAt = await recomputeCellAggregates(cell.id);

  return {
    trackedLocationId: cell.id,
    attempted: businesses.length,
    qualified,
    disqualified,
    unreachable,
    failed: failures.length,
    totalEmailsFound,
    finishedAt,
  };
}

/* ------------------------------------------------ cell aggregate recompute */

/**
 * Recompute (qualified / disqualified / unreachable) tallies on a
 * TrackedLocation from fresh Business rows. Cheap — a single groupBy
 * on indexed columns. Called both at the end of `qualifyCell()` and
 * after every per-business callback from Boxly Worker so the UI keeps
 * pace with the worker fan-out.
 *
 * Concurrent callers (25 worker callbacks racing) are safe: each runs
 * its own groupBy + UPDATE; last write wins and last write is correct
 * (groupBy reads committed state including the prior callback's update).
 */
export async function recomputeCellAggregates(
  trackedLocationId: string,
): Promise<Date> {
  const cell = await prisma.trackedLocation.findUnique({
    where: { id: trackedLocationId },
    select: {
      id: true,
      city: true,
      country: true,
      category: { select: { dataforseoId: true } },
    },
  });
  if (!cell) {
    throw new Error(`TrackedLocation ${trackedLocationId} not found`);
  }

  const counts = await prisma.business.groupBy({
    by: ["qualificationStatus"],
    where: {
      categoryIds: { has: cell.category.dataforseoId },
      city: cell.city,
      country: cell.country,
    },
    _count: { id: true },
  });
  const tally = (s: QualificationStatusValue): number =>
    counts.find((c) => c.qualificationStatus === s)?._count.id ?? 0;

  const finishedAt = new Date();
  await prisma.trackedLocation.update({
    where: { id: cell.id },
    data: {
      qualifiedCount: tally("QUALIFIED"),
      disqualifiedCount: tally("DISQUALIFIED"),
      unreachableCount: tally("UNREACHABLE"),
      lastQualifyAt: finishedAt,
    },
  });
  return finishedAt;
}
