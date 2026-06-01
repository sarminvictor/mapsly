"use client";

/**
 * Client-side "show more" pagination for the SMB /reviews tab body.
 * Renders 5 reviews initially, +10 each click. Keeps the page short
 * by default — Maria scrolls through what matters · doesn't drown in
 * 25 cards on load.
 *
 * Also owns the optimistic queue state. Skipping (or restoring, in the
 * Skipped tab) a review removes it from the current tab INSTANTLY via
 * `useOptimistic`, then the server action runs inside a transition. When
 * the transition settles the server-revalidated list reconciles:
 *   - success → the card stays gone (server list no longer has it here)
 *   - failure → the card reappears (server list unchanged, optimistic
 *     removal is discarded)
 * Per `.claude/rules/realtime-and-optimistic.md` — optimistic mutation
 * wrapped in `startTransition`, auto-revert on failure.
 *
 * Server pre-fetched up to MAX_REVIEWS_PER_TAB (25) reviews · this
 * component never re-fetches · just slices what it already has.
 */

import { useOptimistic, useState, useTransition } from "react";

import {
  skipReviewAction,
  unskipReviewAction,
} from "@/app/[locale]/(smb)/reviews/actions";

import { ReviewCard, type ReviewCardLabels } from "./ReviewCard";
import type { ReviewItem, ReviewTab } from "../types";

const INITIAL_COUNT = 5;
const PAGE_SIZE = 10;

interface Props {
  reviews: ReviewItem[];
  labels: ReviewCardLabels;
  /** Business Google reviews URL (from googlePlaceId) · null hides Post. */
  googleReviewsUrl: string | null;
  /** Active tab · decides whether a card's queue button skips or restores. */
  activeTab: ReviewTab;
  showMoreLabel?: string;
  showingLabel?: string;
}

export function PaginatedReviewList({
  reviews,
  labels,
  googleReviewsUrl,
  activeTab,
  showMoreLabel = "Show more",
  showingLabel = "Showing {shown} of {total}",
}: Props) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);
  const [, startTransition] = useTransition();

  // Optimistic queue · removing an id hides that card immediately. The
  // base value is the server-fetched `reviews`; React resets the
  // optimistic layer to it once each transition completes.
  const [optimisticReviews, removeOptimistic] = useOptimistic(
    reviews,
    (state, removedId: string) => state.filter((r) => r.id !== removedId),
  );

  const isSkippedTab = activeTab === "skipped";

  // Skip (active tabs) / Restore (Skipped tab) share one handler: hide the
  // card now, run the matching server action, let revalidation reconcile.
  const handleMove = (reviewId: string) => {
    startTransition(async () => {
      removeOptimistic(reviewId);
      const fd = new FormData();
      fd.set("reviewId", reviewId);
      const action = isSkippedTab ? unskipReviewAction : skipReviewAction;
      await action(null, fd);
    });
  };

  const total = optimisticReviews.length;
  const visible = Math.min(visibleCount, total);
  const remaining = total - visible;

  return (
    <>
      {optimisticReviews.slice(0, visible).map((r) => (
        <ReviewCard
          key={r.id}
          review={r}
          labels={labels}
          googleReviewsUrl={googleReviewsUrl}
          isSkippedTab={isSkippedTab}
          onMove={handleMove}
        />
      ))}

      {remaining > 0 ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 16,
            padding: "20px 0 8px",
          }}
        >
          <button
            type="button"
            onClick={() =>
              setVisibleCount((c) => Math.min(c + PAGE_SIZE, total))
            }
            style={{
              background: "var(--color-bg-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 999,
              padding: "10px 22px",
              fontSize: 13,
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              color: "var(--color-coral)",
              cursor: "pointer",
              transition: "background-color 0.15s ease",
            }}
            onMouseOver={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "rgba(195, 85, 58, 0.08)")
            }
            onMouseOut={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "var(--color-bg-2)")
            }
          >
            {showMoreLabel} ({Math.min(remaining, PAGE_SIZE)})
          </button>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-text-3)",
            }}
          >
            {showingLabel
              .replace("{shown}", String(visible))
              .replace("{total}", String(total))}
          </span>
        </div>
      ) : null}
    </>
  );
}
