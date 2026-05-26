"use client";

/**
 * Client-side "show more" pagination for the SMB /reviews tab body.
 * Renders 5 reviews initially, +10 each click. Keeps the page short
 * by default — Maria scrolls through what matters · doesn't drown in
 * 25 cards on load.
 *
 * Server pre-fetched up to MAX_REVIEWS_PER_TAB (25) reviews · this
 * component never re-fetches · just slices what it already has.
 */

import { useState } from "react";

import { ReviewCard, type ReviewCardLabels } from "./ReviewCard";
import type { ReviewItem } from "../types";

const INITIAL_COUNT = 5;
const PAGE_SIZE = 10;

interface Props {
  reviews: ReviewItem[];
  labels: ReviewCardLabels;
  showMoreLabel?: string;
  showingLabel?: string;
}

export function PaginatedReviewList({
  reviews,
  labels,
  showMoreLabel = "Show more",
  showingLabel = "Showing {shown} of {total}",
}: Props) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);

  const total = reviews.length;
  const visible = Math.min(visibleCount, total);
  const remaining = total - visible;

  return (
    <>
      {reviews.slice(0, visible).map((r) => (
        <ReviewCard key={r.id} review={r} labels={labels} />
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
