// modules/reviews/recency.ts
//
// Pure recency-depth logic for the reviews rearchitecture (Phase 5).
//
// THE CORE INVARIANT: DataForSEO returns reviews sorted newest-first, so the
// last-12-month window is always a PREFIX of the returned page. That means
// depth must be governed by RECENCY, never by lifetime review count.
//
// A business with 5,000 lifetime reviews but only 80 in the last year must be
// pulled at depth ~200 and NOT escalated to 4,490 — the 200th review is already
// older than the window cutoff, so everything beyond it is out of scope. The
// `shouldEscalate` gate is what enforces this anti-regression.
//
// Every function is PURE. Time is always passed in explicitly as `now: Date`
// so the logic is deterministic and testable — no argless `new Date()`.

/** The recency window: reviews from the last 365 days are "in scope". */
export const REVIEW_WINDOW_DAYS = 365;

/**
 * Escalation ladder for the DataForSEO depth parameter. Each rung is a larger
 * page. We climb the ladder ONLY while the page came back full AND the oldest
 * returned review is still within the window (see `shouldEscalate`). The top
 * rung (4490) is DataForSEO's practical max depth per request.
 */
export const DEPTH_LADDER = [200, 700, 2000, 4490] as const;

/** The maximum reachable depth — the top of the ladder. */
const MAX_DEPTH = DEPTH_LADDER[DEPTH_LADDER.length - 1];

/** Depth used for incremental "delta" pulls (just the newest reviews). */
const DELTA_DEPTH = 50;

/** Clamp `n` into the inclusive range [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Choose the depth for the FIRST page of an initial pull.
 *
 * Round the lifetime review count up to the nearest 10, then clamp into
 * [50, 200]. This gives a small but reasonable first page; if the business is
 * high-velocity (its 200th review is still within the window), `shouldEscalate`
 * will signal a climb up the DEPTH_LADDER on the next request.
 *
 *   0    → 50    (floor)
 *   30   → 50    (ceil(30/10)*10 = 30, clamped up to the 50 floor)
 *   150  → 150
 *   5000 → 200   (ceiling)
 *   1234 → 200   (ceiling)
 */
export function chooseInitialDepth(reviewCount: number | null): number {
  const count = reviewCount ?? 0;
  const rounded = Math.ceil(count / 10) * 10;
  return clamp(rounded, 50, 200);
}

/**
 * Given the depth we just requested, return the NEXT rung on the ladder that is
 * strictly larger — or `null` if we're already at/above the max (4490).
 */
export function nextDepth(currentDepth: number): number | null {
  if (currentDepth >= MAX_DEPTH) return null;
  for (const rung of DEPTH_LADDER) {
    if (rung > currentDepth) return rung;
  }
  return null;
}

/**
 * Is `postedAt` within the recency window ending at `now`?
 *
 * A review posted exactly `windowDays` ago is considered IN the window (the
 * boundary is inclusive). Anything older is out.
 */
export function isWithinWindow(
  postedAt: Date,
  now: Date,
  windowDays: number = REVIEW_WINDOW_DAYS,
): boolean {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return postedAt.getTime() >= cutoff;
}

/**
 * Keep only the reviews whose `postedAt` falls within the recency window.
 * Order is preserved; out-of-window reviews are dropped.
 */
export function trimToWindow<T extends { postedAt: Date }>(
  reviews: T[],
  now: Date,
  windowDays: number = REVIEW_WINDOW_DAYS,
): T[] {
  return reviews.filter((r) => isWithinWindow(r.postedAt, now, windowDays));
}

/**
 * Decide whether to escalate to a deeper page.
 *
 * Return TRUE only when BOTH conditions hold:
 *   1. The page came back FULL (`pageSize >= depthRequested`) — there may be
 *      more reviews beyond what we got.
 *   2. The OLDEST returned review is STILL within the window — we have not yet
 *      reached the cutoff, so a deeper page could surface more in-window data.
 *
 * If the oldest returned review is older than the window, the cutoff lies inside
 * this page and there is nothing more to gain — STOP (return false). This is the
 * anti-regression that prevents a 5,000-lifetime business from being escalated
 * just because of its lifetime count.
 *
 * If the page was NOT full, DataForSEO returned everything it has — STOP too.
 */
export function shouldEscalate(args: {
  pageSize: number;
  depthRequested: number;
  oldestPostedAt: Date | null;
  now: Date;
  windowDays?: number;
}): boolean {
  const {
    pageSize,
    depthRequested,
    oldestPostedAt,
    now,
    windowDays = REVIEW_WINDOW_DAYS,
  } = args;

  // No reviews returned → nothing to escalate from.
  if (oldestPostedAt === null) return false;

  // Page wasn't full → we already have every review the source holds.
  if (pageSize < depthRequested) return false;

  // Page was full → escalate ONLY if the oldest review is still in the window.
  return isWithinWindow(oldestPostedAt, now, windowDays);
}

/**
 * Plan the depth for a fetch.
 *
 *   - "initial" → `chooseInitialDepth(reviewCount)` (first page of a full pull)
 *   - "delta"   → a small fixed page (just the newest reviews)
 */
export function planReviewFetch(args: {
  reviewCount: number | null;
  mode: "initial" | "delta";
}): { depth: number } {
  if (args.mode === "delta") return { depth: DELTA_DEPTH };
  return { depth: chooseInitialDepth(args.reviewCount) };
}
