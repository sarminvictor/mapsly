import * as React from "react";

import type { RatingDistribution } from "../types";

/**
 * RatingDistributionCard · star-by-star histogram for the right rail.
 *
 * Maria-facing. Plain English at the top ("All-time · 289 reviews"),
 * then 5 rows ★ down to ★. Each row has a label + fill bar + raw count.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - Bars use `role="progressbar"` with aria-valuenow so AT users hear
 *     the percentage, not just the visual width
 *   - Counts are inside the row so the label, bar and count travel
 *     together in reading order
 *
 * Server-component-safe.
 */

export interface RatingDistributionCardLabels {
  /** Title — "Rating distribution". */
  title: string;
  /** Subtitle — "All-time · {total} reviews", with `{total}` placeholder. */
  subtitle: string;
  /** Empty — "No reviews yet. We'll show the breakdown once they come in." */
  empty: string;
  /** "{n}-star" row label, with `{n}` placeholder. */
  starRowLabel: string;
}

export interface RatingDistributionCardProps {
  distribution: RatingDistribution;
  labels: RatingDistributionCardLabels;
}

export function RatingDistributionCard({
  distribution,
  labels,
}: RatingDistributionCardProps) {
  if (distribution.total === 0) {
    return (
      <RailCard title={labels.title}>
        <p
          style={{
            margin: 0,
            color: "var(--color-text-3)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {labels.empty}
        </p>
      </RailCard>
    );
  }

  const rows: Array<{ star: 5 | 4 | 3 | 2 | 1; count: number }> = [
    { star: 5, count: distribution.star5 },
    { star: 4, count: distribution.star4 },
    { star: 3, count: distribution.star3 },
    { star: 2, count: distribution.star2 },
    { star: 1, count: distribution.star1 },
  ];

  return (
    <RailCard title={labels.title}>
      <p
        style={{
          margin: "0 0 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
        }}
      >
        {labels.subtitle.replace("{total}", String(distribution.total))}
      </p>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {rows.map(({ star, count }) => {
          const pct =
            distribution.total > 0
              ? Math.round((count / distribution.total) * 1000) / 10
              : 0;
          const negative = star <= 3;
          return (
            <li
              key={star}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                aria-label={labels.starRowLabel.replace("{n}", String(star))}
                style={{
                  fontSize: 13,
                  color: "var(--color-text-2)",
                  width: 56,
                  letterSpacing: 1,
                }}
              >
                {"★".repeat(star)}
                {"☆".repeat(5 - star)}
              </span>
              <span
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${pct}% ${labels.starRowLabel.replace("{n}", String(star))}`}
                style={{
                  height: 8,
                  background: "var(--color-bg-3, #f2ebe3)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, pct))}%`,
                    background: negative
                      ? "var(--color-alert, #b53d47)"
                      : "var(--color-coral, #c3553a)",
                    borderRadius: 4,
                    transition: "width 0.3s ease",
                  }}
                />
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-text-2)",
                  minWidth: 32,
                  textAlign: "right",
                }}
              >
                {count}
              </span>
            </li>
          );
        })}
      </ul>
    </RailCard>
  );
}

function RailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <h3
        style={{
          margin: "0 0 10px",
          fontFamily: "var(--font-serif)",
          fontSize: 15,
          letterSpacing: "-0.01em",
          color: "var(--color-text)",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}
