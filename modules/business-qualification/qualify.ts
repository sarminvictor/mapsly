/**
 * Qualify · per-business + per-cell qualification pipeline.
 *
 * For each business we check:
 *   1. is_claimed in Google (free · already in DB)
 *   2. reviewCount ≥ 3 (free · already in DB)
 *   3. has discoverable email (website scrape + RDAP fallback)
 *
 * Result is one of:
 *   - QUALIFIED      · claimed + ≥3 reviews + email found
 *   - DISQUALIFIED   · fails ≥1 of the above but is reachable
 *   - UNREACHABLE    · no email AND no website
 *   - FAILED         · pipeline errored (timeout, crash)
 *
 * Flags surfaced on Business.qualificationFlags so admin can see WHY
 * a business was disqualified at a glance:
 *   - "unclaimed"   · is_claimed === false
 *   - "low_reviews" · reviewCount < 3
 *   - "no_email"    · scrape + RDAP returned nothing
 *   - "no_website"  · Business.website is null
 *
 * Per `.claude/rules/scalability.md` we cap parallelism at 5
 * concurrent businesses inside a cell — polite to host sites + keeps
 * one slow timeout from cascading.
 */

import type { Prisma } from "@/lib/prisma";
import prisma from "@/lib/prisma";

import { findEmailViaAi } from "@/services/ai";
import { detectAndPersistServices } from "@/services/business-services-detect";
import {
  triggerReviewPullForBusiness,
  type TriggerReviewPullResult,
} from "@/modules/reviews/trigger-pull";

import { rdapLookup } from "./rdap";
import { scrapeEmailsFromWebsite, type EmailCandidate } from "./scrape-email";

// Lowered from 10 → 3 after Calgary smoke run · businesses with 5–9
// real reviews (e.g. Southport Skin Studio, Pure Medical Aesthetics)
// are clearly legitimate operations. 3 still filters out empty Google
// profiles + brand-new listings with no traction yet.
const MIN_REVIEWS = 3;
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
  // R.2 · review-pull trigger result (the qualify-time hook). Tells the
  // caller (admin UI / loop) whether reviews are being collected for
  // this business, with a structured skip reason on no-op.
  reviewPull: TriggerReviewPullResult;
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
      name: true,
      city: true,
      province: true,
      country: true,
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
      // Idempotency · skip the AI tier if it already ran for this row
      emailDiscoverySource: true,
    },
  });
  if (!biz) throw new Error(`Business ${businessId} not found`);

  const flags: string[] = [];
  if (!biz.isClaimed) flags.push("unclaimed");
  if ((biz.reviewCount ?? 0) < MIN_REVIEWS) flags.push("low_reviews");

  // Email discovery · 3-tier waterfall. Each tier only runs if the
  // previous one produced zero candidates.
  //
  // Tier 1 · website scrape (free, ~30s)
  // Tier 2 · RDAP/WHOIS    (free, ~3s)
  // Tier 3 · AI web search (paid, ~10s · gpt-5.4-nano · ~$0.027/biz)
  //
  // Cost discipline: Tier 3 runs ONLY when the cheap tiers failed AND
  // the AI hasn't already run for this row (avoids re-spending on
  // re-qualify clicks). See services/ai/email-finder.ts for the prompt
  // + validation gates.
  let scrapeRan = false;
  let websiteUnreachable = false;
  let candidates: EmailCandidate[] = [];
  let aiAttempted = false;

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

  // Tier 3 · AI fallback. Conditions:
  //   1. No candidates from scrape OR RDAP
  //   2. AI hasn't already run for this row (idempotency)
  //   3. We have enough context to search (name + city are required;
  //      a business without a name shouldn't reach here, but defensive)
  const alreadyAiQualified = biz.emailDiscoverySource === "AI_WEB_SEARCH";
  if (candidates.length === 0 && !alreadyAiQualified && biz.name && biz.city) {
    aiAttempted = true;
    try {
      const ai = await findEmailViaAi({
        name: biz.name,
        city: biz.city,
        province: biz.province,
        country: biz.country ?? "US",
        website: biz.website,
        domain: biz.domain,
        reviewCount: biz.reviewCount ?? 0,
      });
      if (ai.email) {
        // Synthesize an EmailCandidate from the AI result. We bypass
        // the buildCandidate scorer because the AI output already
        // passed domain-alignment + shape gates inside email-finder.
        const emailDomain = (ai.email.split("@")[1] ?? "").toLowerCase();
        const localPart = (ai.email.split("@")[0] ?? "").toLowerCase();
        // Normalize the stored domain (often has www. prefix) before
        // comparing — emails almost never include the www. label.
        const normalizedBizDomain = (biz.domain ?? "")
          .toLowerCase()
          .replace(/^www\./, "");
        const isDomainAligned =
          !!normalizedBizDomain &&
          (emailDomain === normalizedBizDomain ||
            emailDomain.endsWith("." + normalizedBizDomain));
        candidates = [
          {
            email: ai.email,
            source: "AI_WEB_SEARCH",
            score: ai.confidence === "high" ? 90 : 70,
            isPersonal:
              !/^(info|contact|hello|admin|support|sales|book|booking|appointments|reception)/.test(
                localPart,
              ),
            isDomainAligned,
            isFreeProvider:
              /@(gmail|yahoo|hotmail|outlook|icloud|me|live|aol|protonmail|msn|proton)\./.test(
                ai.email,
              ),
            aiCitation: ai.source,
          },
        ];
      }
    } catch (err) {
      // AI failure (rate limit, API hiccup, validation throw) must not
      // break the qualify. Just continue with no_email.
      console.warn(
        `[qualify ${businessId}] AI tier-3 failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const best = candidates[0] ?? null;
  if (!best) flags.push("no_email");
  if (aiAttempted) flags.push("ai_attempted");

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

  // R.2 · review-pull hook · trigger a one-time historical pull for
  // this business via DataForSEO Standard queue. The actual review
  // upsert happens asynchronously via /api/webhooks/dataforseo/reviews
  // when DfS pings us back (up to 45 min later).
  //
  // Guards inside triggerReviewPullForBusiness:
  //   - needs Business.googleCid
  //   - skips if pendingReviewsTaskId is set (in-flight)
  //   - skips if reviewsFirstPulledAt is already set (idempotency)
  //   - skips if paid-location gate fails (cost discipline)
  //
  // Failure is non-fatal · qualify already succeeded. The pull can be
  // retried via /admin/businesses "Collect reviews now" (R.9).
  let reviewPull: TriggerReviewPullResult;
  try {
    reviewPull = await triggerReviewPullForBusiness(biz.id, {
      mode: "initial",
    });
  } catch (err) {
    console.warn(
      `[qualify ${businessId}] review-pull trigger threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    reviewPull = { triggered: false, reason: "task_post_failed" };
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
    reviewPull,
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
