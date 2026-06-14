/**
 * SMB overview · market-events diff engine (pure).
 *
 * Given each cell business's this-week vs last-week snapshot signals,
 * emit the notable weekly changes Maria sees in the "this week — what
 * changed" feed. Pure (no Prisma) so the unit tests drive it against
 * synthetic fixtures.
 *
 * Per the data audit, every field here is read from columns + `signalsJson`
 * that are written onto EVERY weekly snapshot row, so these deltas are real
 * from day one (unlike the pillar-rank delta, which warms up). Website +
 * services are owner-mostly (we only audit / detect services for owned
 * businesses) — the engine still emits them when the signal is present.
 *
 * Voice is Maria-first per `.claude/rules/copy-voice.md` — plain English,
 * no LCP / CTR / NAP jargon. Bodies are built here (data), not in the
 * `.tsx`, mirroring the prior market-feed precedent.
 */

import type { SmbEventType, SmbMarketChange } from "./types";

/** Snapshot signals the diff engine reads — extracted from a snapshot row +
 * its `signalsJson` bag by the query layer. */
export interface SnapshotSignals {
  snapshotDate: Date;
  rating: number | null;
  reviewCount: number | null;
  photosCount: number | null;
  hasActiveGoogleAds: boolean | null;
  hasActiveMetaAds: boolean | null;
  /** Best local-pack (Google Maps) rank across tracked keywords. */
  localPackRank: number | null;
  /** Best organic-search rank across tracked keywords. */
  organicRankBest: number | null;
  /** Lighthouse mobile performance 0–100. */
  lighthousePerformance: number | null;
}

/** One business's this-week + prior-week signals. */
export interface BizWeek {
  businessId: string;
  name: string;
  isOwn: boolean;
  current: SnapshotSignals;
  prior: SnapshotSignals | null;
}

/** Notability thresholds — keep the feed to "main changes", not noise.
 * Reviews are NOT here: they come from real Review.postedAt activity over a
 * rolling 7-day window (deriveReviewActivity), not snapshot-to-snapshot deltas,
 * so the feed shows actual new reviews even before weekly snapshot history
 * accrues (Viktor 2026-06-14 — snapshot diffs collapsed to a 1-day window). */
const RATING_MIN = 0.1;
const PHOTOS_MIN = 3;
const WEBSITE_MIN = 10;

interface Weighted {
  event: SmbMarketChange;
  weight: number;
}

function bestRank(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

/**
 * Produce the market changes for a set of businesses, ordered by
 * significance (most notable first) so a downstream cap keeps the
 * strongest signals. The client re-sorts for display.
 */
export function deriveMarketChanges(
  weeks: readonly BizWeek[],
): SmbMarketChange[] {
  const out: Weighted[] = [];

  for (const w of weeks) {
    const { businessId, name, isOwn, current, prior } = w;
    const at = current.snapshotDate.toISOString();
    const boost = isOwn ? 100 : 0;

    const push = (
      type: SmbEventType,
      idSuffix: string,
      body: string,
      delta: string | null,
      tone: SmbMarketChange["tone"],
      weight: number,
    ) =>
      out.push({
        event: {
          id: `${type}-${idSuffix}-${businessId}`,
          type,
          businessId,
          businessName: name,
          isOwn,
          body,
          delta,
          tone,
          at,
        },
        weight: weight + boost,
      });

    if (!prior) continue;

    // Reviews are sourced from real 7-day activity (deriveReviewActivity), not
    // the snapshot reviewCount delta — see the threshold note above.

    // Rating moved.
    if (current.rating != null && prior.rating != null) {
      const d = round1(current.rating - prior.rating);
      if (Math.abs(d) >= RATING_MIN) {
        push(
          "rating",
          "d",
          `${name}'s Google rating ${d > 0 ? "rose" : "slipped"} to ${current.rating.toFixed(1)}.`,
          `${d > 0 ? "+" : ""}${d.toFixed(1)}`,
          d > 0 ? "good" : "bad",
          Math.abs(d) * 12,
        );
      }
    }

    // New photos.
    if (current.photosCount != null && prior.photosCount != null) {
      const d = current.photosCount - prior.photosCount;
      if (d >= PHOTOS_MIN) {
        push(
          "photos",
          "d",
          `${name} added ${d} new photo${d === 1 ? "" : "s"} to their profile.`,
          `+${d}`,
          "neutral",
          d * 0.6,
        );
      }
    }

    // Ads started / stopped — Google.
    {
      const before = prior.hasActiveGoogleAds === true;
      const now = current.hasActiveGoogleAds === true;
      if (now && !before) {
        push(
          "ads",
          "google",
          `${name} started running Google ads.`,
          "Google",
          "neutral",
          6,
        );
      } else if (before && !now) {
        push(
          "ads",
          "google",
          `${name} stopped running Google ads.`,
          "Google",
          "neutral",
          5,
        );
      }
    }
    // Ads started / stopped — Meta (Facebook + Instagram).
    {
      const before = prior.hasActiveMetaAds === true;
      const now = current.hasActiveMetaAds === true;
      if (now && !before) {
        push(
          "ads",
          "meta",
          `${name} started running Facebook & Instagram ads.`,
          "Meta",
          "neutral",
          6,
        );
      } else if (before && !now) {
        push(
          "ads",
          "meta",
          `${name} stopped running Facebook & Instagram ads.`,
          "Meta",
          "neutral",
          5,
        );
      }
    }

    // Search — broke into the top 3 / top 10.
    {
      const cur = bestRank(current.localPackRank, current.organicRankBest);
      const prev = bestRank(prior.localPackRank, prior.organicRankBest);
      if (cur != null && prev != null) {
        if (cur <= 3 && prev > 3) {
          push(
            "search",
            "top3",
            `${name} broke into the top 3 of local search.`,
            "▲ top 3",
            "good",
            8,
          );
        } else if (cur <= 10 && prev > 10) {
          push(
            "search",
            "top10",
            `${name} climbed into the top 10 of local search.`,
            "▲ top 10",
            "good",
            6,
          );
        }
      }
    }

    // Website speed moved significantly.
    if (
      current.lighthousePerformance != null &&
      prior.lighthousePerformance != null
    ) {
      const d = Math.round(
        current.lighthousePerformance - prior.lighthousePerformance,
      );
      if (Math.abs(d) >= WEBSITE_MIN) {
        push(
          "website",
          "d",
          `${name}'s website speed ${d > 0 ? "jumped" : "dropped"} ${Math.abs(d)} points.`,
          `${d > 0 ? "+" : ""}${d}`,
          d > 0 ? "good" : "bad",
          Math.abs(d) * 0.5,
        );
      }
    }
  }

  out.sort((a, b) => b.weight - a.weight);
  return out.map((w) => w.event);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** One business's REAL new-review activity over the rolling 7-day window —
 * counted from `Review.postedAt` (not a snapshot delta). */
export interface ReviewActivity {
  businessId: string;
  name: string;
  isOwn: boolean;
  /** New reviews posted in the window. */
  newReviews: number;
  /** Most-recent new review's posted date — drives the feed's recency sort. */
  latestPostedAt: Date;
}

/**
 * Build "gained N new reviews this week" events from real 7-day review
 * activity, one per business with at least one new review. Unlike the
 * snapshot-diff engine, this sees actual reviews the moment they land — so the
 * feed is rich at launch, before any week-over-week snapshot history exists.
 * Owner-boosted + significance-sorted like deriveMarketChanges, so a downstream
 * cap keeps the strongest signals; the client re-sorts for display.
 */
export function deriveReviewActivity(
  rows: readonly ReviewActivity[],
): SmbMarketChange[] {
  const out: Weighted[] = [];
  for (const r of rows) {
    if (r.newReviews < 1) continue;
    out.push({
      event: {
        id: `reviews-7d-${r.businessId}`,
        type: "reviews",
        businessId: r.businessId,
        businessName: r.name,
        isOwn: r.isOwn,
        body: `${r.name} gained ${r.newReviews} new review${r.newReviews === 1 ? "" : "s"} this week.`,
        delta: `+${r.newReviews}`,
        tone: "good",
        at: r.latestPostedAt.toISOString(),
      },
      weight: r.newReviews + (r.isOwn ? 100 : 0),
    });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out.map((w) => w.event);
}
