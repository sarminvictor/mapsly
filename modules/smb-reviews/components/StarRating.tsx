import * as React from "react";

/**
 * StarRating · `★★★☆☆` style star indicator for review cards.
 *
 * Server-component-safe: no hooks, no event handlers. Renders a small
 * accessible label so screen readers say "3 out of 5 stars" instead of
 * reading the unicode glyph stream.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - Color is paired with shape (filled vs hollow star) — never
 *     conveyed by color alone
 *   - aria-label carries the human-readable rating
 *   - The visual glyphs are aria-hidden so AT users hear only the label
 */
export interface StarRatingProps {
  /** Stars filled. Clamped to 0-5. */
  value: number;
  /** Total max stars. Defaults to 5; only here for forward-compat. */
  max?: number;
  /** Font size in px. Defaults to 14. */
  size?: number;
  /** Override the aria-label (e.g. localized "3 de 5"). */
  ariaLabel?: string;
}

export function StarRating({
  value,
  max = 5,
  size = 14,
  ariaLabel,
}: StarRatingProps) {
  const filled = Math.max(0, Math.min(max, Math.round(value)));
  const empty = max - filled;
  const label = ariaLabel ?? `${filled} out of ${max} stars`;

  // Coral when high (4-5), gold when mid (3), alert when low (1-2). Pair
  // with the filled/hollow shape so the meaning carries without color.
  const color =
    filled >= 4
      ? "var(--color-coral)"
      : filled === 3
        ? "var(--color-gold)"
        : "var(--color-alert)";

  return (
    <span
      role="img"
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1,
        color,
        fontSize: size,
        letterSpacing: 1,
        lineHeight: 1,
      }}
    >
      {Array.from({ length: filled }).map((_, i) => (
        <span aria-hidden key={`f${i}`}>
          ★
        </span>
      ))}
      {Array.from({ length: empty }).map((_, i) => (
        <span
          aria-hidden
          key={`e${i}`}
          style={{ color: "var(--color-text-4, #c0b5a8)" }}
        >
          ☆
        </span>
      ))}
    </span>
  );
}
