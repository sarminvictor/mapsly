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
 *   - "unclaimed"           · is_claimed === false
 *   - "low_reviews"         · reviewCount < 3
 *   - "no_email"            · no electable candidate from any tier
 *   - "no_website"          · Business.website is null
 *   - "website_unreachable" · website set but every fetch failed
 *                             (WAF block / dead site — distinguishes
 *                             "blocked at the door" from "no email
 *                             published")
 *   - "rdap_proxied"        · WHOIS privacy-proxied, RDAP tier useless
 *   - "ai_attempted"        · paid AI email search ran (billing guard —
 *                             persists across runs)
 *   - "email_undeliverable" · SMTP probe hard-bounced the discovered
 *                             email (set by verify-promote)
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
  boundingBoxForCell,
  cellMembershipWhere,
} from "@/modules/business-discovery";
import {
  triggerReviewPullForBusiness,
  type TriggerReviewPullResult,
} from "@/modules/reviews/trigger-pull";

import { rdapLookup } from "./rdap";
import {
  isGenericLocalPart,
  scrapeEmailsFromWebsite,
  type EmailCandidate,
} from "./scrape-email";

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
  // this business, with a structured skip reason on no-op. Null when
  // the run was skipped as already-settled (no pull evaluation ran).
  reviewPull: TriggerReviewPullResult | null;
  // True when the run short-circuited because the row was already
  // settled (QUALIFIED/DISQUALIFIED/UNREACHABLE) and force wasn't set —
  // the outcome echoes stored state, no scrape/AI/services work ran.
  skippedSettled?: boolean;
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
 * Qualify a single business.
 *
 * Settled rows (QUALIFIED / DISQUALIFIED / UNREACHABLE) short-circuit
 * and echo their stored state — re-running the full pipeline on them
 * cost real money (AI re-bills) and could DESTROY data (a transient
 * site outage nulled a previously discovered email, see 2026-06-11
 * audit). Pass `force: true` for a deliberate re-audit (the per-row
 * admin button); NOT_QUALIFIED and FAILED rows always run.
 *
 * Idempotent in state: a forced re-run overwrites status + flags +
 * candidates — but NEVER erases a previously discovered email with
 * null (found-before beats found-nothing-now).
 */
export async function qualifyBusiness(
  businessId: string,
  options?: { force?: boolean },
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
      // Settled-row guard + idempotency inputs
      qualificationStatus: true,
      qualificationFlags: true,
      emailDiscovered: true,
      emailDiscoveredAt: true,
      emailDiscoverySource: true,
    },
  });
  if (!biz) throw new Error(`Business ${businessId} not found`);

  // Settled-row guard · worker retries, duplicate fan-outs and bulk
  // re-clicks all funnel through here — only NOT_QUALIFIED + FAILED
  // proceed without force.
  if (
    !options?.force &&
    biz.qualificationStatus !== "NOT_QUALIFIED" &&
    biz.qualificationStatus !== "FAILED"
  ) {
    return {
      businessId: biz.id,
      status: biz.qualificationStatus as QualificationStatusValue,
      flags: biz.qualificationFlags,
      emailDiscovered: biz.emailDiscovered,
      emailDiscoverySource:
        (biz.emailDiscoverySource as EmailCandidate["source"] | null) ?? null,
      candidatesFound: 0,
      websiteUnreachable: false,
      servicesDetected: 0,
      servicesCreated: 0,
      reviewPull: null,
      skippedSettled: true,
    };
  }

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

  // Election gate · a candidate may only WIN (become emailDiscovered →
  // the cold-outreach target) when it's domain-aligned with the
  // business, a free-provider inbox, or the business has no known
  // domain to align against. Unaligned custom-domain emails — web
  // designer footer credits, embedded booking-platform vendors — stay
  // in the audit list but never get elected (2026-06-11 audit: the
  // scrape tier lacked the gate the AI tier already enforces; a
  // CAN-SPAM wrong-target risk).
  const electable = (list: EmailCandidate[]): EmailCandidate[] =>
    list.filter((c) => c.isDomainAligned || c.isFreeProvider || !biz.domain);

  if (biz.website) {
    const scrape = await scrapeEmailsFromWebsite({
      website: biz.website,
      domain: biz.domain,
    });
    scrapeRan = true;
    websiteUnreachable = scrape.websiteUnreachable;
    candidates = scrape.candidates;
    if (scrapeRan && websiteUnreachable) flags.push("website_unreachable");
  } else {
    flags.push("no_website");
  }

  if (electable(candidates).length === 0 && biz.domain) {
    const rdap = await rdapLookup(biz.domain);
    if (rdap.proxiedOnly) flags.push("rdap_proxied");
    candidates = [...candidates, ...rdap.candidates];
  }

  // Tier 3 · AI fallback. Conditions:
  //   1. No candidates from scrape OR RDAP
  //   2. AI hasn't already run for this row (idempotency) — BOTH the
  //      success marker (emailDiscoverySource) AND the attempt marker
  //      (the persisted "ai_attempted" flag). Checking only the source
  //      meant every re-run of a no-email row re-billed the AI
  //      (~$0.027/biz · 2026-06-11 audit: ~$5/click on a 430-cell).
  //   3. We have enough context to search (name + city are required;
  //      a business without a name shouldn't reach here, but defensive)
  const alreadyAiAttempted =
    biz.emailDiscoverySource === "AI_WEB_SEARCH" ||
    biz.qualificationFlags.includes("ai_attempted");
  if (
    electable(candidates).length === 0 &&
    !alreadyAiAttempted &&
    biz.name &&
    biz.city
  ) {
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
            // Same generic-inbox vocabulary as the scrape tier so the
            // emailCandidates audit labels stay consistent across tiers.
            isPersonal: !isGenericLocalPart(localPart),
            isDomainAligned,
            isFreeProvider:
              /@(gmail|yahoo|hotmail|outlook|icloud|me|live|aol|protonmail|msn|proton)\./.test(
                ai.email,
              ),
            aiCitation: ai.source,
          },
          ...candidates,
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

  // Election: best ELECTABLE candidate wins; unelectable ones remain
  // in the persisted audit list only.
  const best = electable(candidates)[0] ?? null;

  // Email ratchet · "found before" beats "found nothing now". A re-run
  // whose scrape transiently fails (site down, WAF block) or whose AI
  // tier is skipped by the idempotency guard must never null out a
  // previously discovered email — that data cost money and is the
  // product's core asset.
  const keptEmail = best?.email ?? biz.emailDiscovered;
  const keptSource =
    best?.source ??
    (biz.emailDiscoverySource as EmailCandidate["source"] | null) ??
    null;

  if (!keptEmail) flags.push("no_email");
  // The attempt marker persists across runs — it's the tier-3 billing
  // guard, so losing it on a flag rewrite would re-arm the AI spend.
  if (aiAttempted || alreadyAiAttempted) flags.push("ai_attempted");

  // Status arbitration · order matters · judged on the KEPT email so a
  // transient scrape failure can't downgrade a previously good row.
  let status: QualificationStatusValue;
  if (!biz.website && !keptEmail) {
    status = "UNREACHABLE";
  } else if (
    keptEmail &&
    biz.isClaimed &&
    (biz.reviewCount ?? 0) >= MIN_REVIEWS
  ) {
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
      emailDiscovered: keptEmail,
      emailDiscoverySource: keptSource,
      emailDiscoveredAt: best ? new Date() : (biz.emailDiscoveredAt ?? null),
      // Persist the top-10 candidates (audit · "why did we pick this one").
      // When this run found none but a prior email is being kept, skip
      // the column entirely so the prior candidate audit trail survives.
      // Cast through unknown · EmailCandidate is structurally JSON-safe
      // but TS can't prove that — the index signature on InputJsonValue
      // is what trips the strict check.
      emailCandidates:
        candidates.length === 0 && keptEmail
          ? undefined
          : (candidates.slice(0, 10) as unknown as Prisma.InputJsonValue),
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
    emailDiscovered: keptEmail,
    emailDiscoverySource: keptSource,
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
      lat: true,
      lng: true,
      radiusKm: true,
      category: { select: { dataforseoId: true } },
    },
  });
  if (!cell) {
    throw new Error(`TrackedLocation ${trackedLocationId} not found`);
  }

  // Cell membership · shared geo bounding-box definition — see
  // modules/business-discovery/cell-membership.ts. Previously exact
  // city match, which silently skipped radius-discovered businesses
  // whose Google city differs (Coral Gables in a Miami cell).
  const businesses = await prisma.business.findMany({
    where: cellMembershipWhere({
      dataforseoCategoryId: cell.category.dataforseoId,
      lat: cell.lat,
      lng: cell.lng,
      radiusKm: cell.radiusKm,
      city: cell.city,
      country: cell.country,
    }),
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
 * TrackedLocation from fresh Business rows. Called both at the end of
 * `qualifyCell()` and after every per-business callback from Boxly
 * Worker so the UI keeps pace with the fan-out.
 *
 * Concurrent callers (25 worker callbacks racing) are safe because the
 * read and the write are ONE SQL statement — each caller's UPDATE
 * counts committed state at its own execution time, so the last commit
 * is genuinely the freshest tally (a separate groupBy-then-update pair
 * did NOT have this property — see the in-function comment).
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
      lat: true,
      lng: true,
      radiusKm: true,
      category: { select: { dataforseoId: true } },
    },
  });
  if (!cell) {
    throw new Error(`TrackedLocation ${trackedLocationId} not found`);
  }

  // ONE statement, read + write atomic. The previous groupBy-then-
  // update pair raced under the worker fan-out (10-25 concurrent
  // callbacks): the last UPDATE to commit could carry a STALE groupBy
  // snapshot, permanently undercounting until the next qualify — the
  // old "last write wins and last write is correct" comment was wrong
  // about the second half. Membership matches cellMembershipWhere
  // (geo box + null-coordinate city fallback) — keep in lock-step.
  const box = boundingBoxForCell({
    lat: cell.lat,
    lng: cell.lng,
    radiusKm: cell.radiusKm,
  });
  const finishedAt = new Date();
  await prisma.$executeRaw`
    UPDATE "TrackedLocation" t SET
      "qualifiedCount"    = s.q,
      "disqualifiedCount" = s.d,
      "unreachableCount"  = s.u,
      "lastQualifyAt"     = ${finishedAt}
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE b."qualificationStatus" = 'QUALIFIED')    AS q,
        COUNT(*) FILTER (WHERE b."qualificationStatus" = 'DISQUALIFIED') AS d,
        COUNT(*) FILTER (WHERE b."qualificationStatus" = 'UNREACHABLE')  AS u
      FROM "Business" b
      WHERE b."categoryIds" @> ARRAY[${cell.category.dataforseoId}]::text[]
        AND (
          (b.lat BETWEEN ${box.latMin} AND ${box.latMax}
            AND b.lng BETWEEN ${box.lngMin} AND ${box.lngMax})
          OR (b.lat IS NULL AND b.city = ${cell.city} AND b.country = ${cell.country})
        )
    ) s
    WHERE t.id = ${cell.id}`;
  return finishedAt;
}
