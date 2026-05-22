import * as React from "react";

import type { ParadoxTier } from "../types";

/**
 * ParadoxAlert · the "you're spending without showing up" callout.
 *
 * Renders ONLY when `tier !== null`. The tier comes from
 * `detectParadoxTier()` in types.ts. Two visual treatments:
 *
 *   - `high`   · coral / strong — Maria spends actively, lanes covered < 25%
 *   - `medium` · gold / soft   — fewer ads or less severe gap (< 50%)
 *
 * Server-component-safe. Plain props in, markup out.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Warm, plain English (no "lane coverage ratio")
 *   - Outcome over metric ("you're paying for ads that don't show your services")
 *   - One CTA visible — "What to do" is a single guided sentence, not a list
 */
export interface ParadoxAlertLabels {
  /** Tagged eyebrow, e.g. "Heads up" / "Worth a check". */
  eyebrow: string;
  /** Headline rendered with values interpolated. Caller passes
   * `headline(totalActiveAds, lanesCovered, totalLanes)`. */
  headline: string;
  /** Body prose explaining what's happening + what to do. */
  body: string;
  /** Single CTA — used when the alert ships with an action. Optional. */
  cta?: string;
}

export interface ParadoxAlertProps {
  tier: NonNullable<ParadoxTier>;
  labels: ParadoxAlertLabels;
}

export function ParadoxAlert({ tier, labels }: ParadoxAlertProps) {
  const isHigh = tier === "high";
  return (
    <aside
      role="alert"
      aria-live="polite"
      data-testid="ads-paradox-alert"
      style={{
        background: isHigh ? "rgba(195,85,58,.08)" : "rgba(212,165,116,.14)",
        border: `1px solid ${
          isHigh ? "var(--color-coral)" : "var(--color-gold)"
        }`,
        borderRadius: 14,
        padding: "18px 22px",
        marginBottom: 18,
        display: "grid",
        gap: 8,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: isHigh ? "var(--color-coral)" : "var(--color-berry)",
          fontWeight: 600,
        }}
      >
        {labels.eyebrow}
      </p>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontSize: 22,
          lineHeight: 1.2,
          letterSpacing: "-0.01em",
          color: "var(--color-text)",
        }}
      >
        {labels.headline}
      </h2>
      <p
        style={{
          margin: 0,
          color: "var(--color-text-2)",
          fontSize: 14.5,
          lineHeight: 1.55,
          maxWidth: 680,
        }}
      >
        {labels.body}
      </p>
      {labels.cta ? (
        <p
          style={{
            margin: "4px 0 0",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-text-2)",
          }}
        >
          {labels.cta}
        </p>
      ) : null}
    </aside>
  );
}
