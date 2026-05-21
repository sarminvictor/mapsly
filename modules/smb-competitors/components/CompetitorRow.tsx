import * as React from "react";

/**
 * CompetitorRow · single row in the SMB competitors comparison list.
 *
 * Renders one business's name + rating + reviews + Mapsly Score in a
 * single horizontally-laid-out card. The user's own row gets a coral
 * accent border + "You" tag so Maria can locate herself instantly
 * (per `.claude/rules/ui-ux-smb.md` — "redundant" visual cues, never
 * color alone).
 *
 * Server-component-safe — no hooks, no event handlers, pure props in.
 * Renders at mobile (380px) and desktop without overflow. Per
 * `.claude/rules/accessibility.md`, the "You" indicator is announced
 * to screen readers via aria-label on the row itself, not just visually.
 */

export interface CompetitorRowDisplayProps {
  /** 1-indexed rank within the displayed list. */
  rank: number;
  /** Business display name. */
  name: string;
  /** Whether this row is the user's own business. */
  isOwn: boolean;
  /** Google rating 0-5, nullable until the first snapshot. */
  rating: number | null;
  /** Total reviews on Google. */
  reviewCount: number | null;
  /** Composite Mapsly Score 0-10. */
  mapslyScore: number | null;
  /** Labels (i18n-resolved by the page). */
  labels: {
    /** "You" badge text on the user's own row. */
    youBadge: string;
    /** Accessible label "{name} (your business)" for the row when isOwn. */
    youAriaSuffix: string;
    /** Accessible label like "Mapsly score" for the score number. */
    scoreLabel: string;
    /** Accessible label for the rating. */
    ratingLabel: string;
    /** Accessible label for the review count. */
    reviewsLabel: string;
    /** Em-dash sentinel for null values. */
    noDataDash: string;
  };
}

function scoreColor(score: number | null): string {
  if (score == null) return "var(--color-text-3)";
  if (score >= 7) return "var(--color-success)";
  if (score >= 4) return "var(--color-gold)";
  return "var(--color-alert)";
}

export function CompetitorRow({
  rank,
  name,
  isOwn,
  rating,
  reviewCount,
  mapslyScore,
  labels,
}: CompetitorRowDisplayProps) {
  const dash = labels.noDataDash;
  const scoreText = mapslyScore != null ? mapslyScore.toFixed(1) : dash;
  const ratingText = rating != null ? rating.toFixed(1) : dash;
  const reviewsText =
    reviewCount != null ? String(reviewCount) : dash;

  const ariaLabel = isOwn ? `${name} (${labels.youAriaSuffix})` : name;

  return (
    <li
      aria-label={ariaLabel}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        background: isOwn ? "rgba(195,85,58,.06)" : "var(--color-bg-2)",
        border: `1px solid ${
          isOwn ? "var(--color-coral)" : "var(--color-border)"
        }`,
        borderRadius: 12,
        listStyle: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 28,
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color: "var(--color-text-3)",
          flexShrink: 0,
        }}
      >
        {rank}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 15,
          color: "var(--color-text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
        {isOwn ? (
          <span
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              background: "var(--color-coral)",
              color: "#fff",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              verticalAlign: "middle",
            }}
          >
            {labels.youBadge}
          </span>
        ) : null}
      </span>
      <span
        aria-label={`${labels.ratingLabel} ${ratingText}`}
        style={{
          width: 64,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontSize: 14,
          color: "var(--color-text-2)",
          flexShrink: 0,
        }}
      >
        {ratingText}
        <span
          aria-hidden
          style={{ color: "var(--color-text-3)", marginLeft: 2 }}
        >
          ★
        </span>
      </span>
      <span
        aria-label={`${labels.reviewsLabel} ${reviewsText}`}
        style={{
          width: 56,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontSize: 14,
          color: "var(--color-text-2)",
          flexShrink: 0,
        }}
      >
        {reviewsText}
      </span>
      <span
        aria-label={`${labels.scoreLabel} ${scoreText}`}
        style={{
          width: 56,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontSize: 16,
          fontFamily: "var(--font-serif)",
          fontWeight: 600,
          color: scoreColor(mapslyScore),
          flexShrink: 0,
        }}
      >
        {scoreText}
      </span>
    </li>
  );
}
