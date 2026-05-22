import * as React from "react";

import type { ListAnalyticsInsight } from "../types";

/**
 * InsightCallout · headline auto-derived insight rendered between the
 * stat header and the per-list funnel table.
 *
 * Per `.claude/rules/ui-ux-agency.md` — terse, jargon-OK, numbers-first.
 * Tom's voice: "Top performer · Anchor Local · 23% close (32 engaged)".
 *
 * Server-component-safe · pure presentational. The caller (the page)
 * passes a pre-built link node so this leaf stays free of next-intl
 * imports per `.claude/rules/i18n.md`.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - `role="status"` so screen readers announce when the callout
 *     appears (or updates after the cron refresh).
 *   - Pre-built `<a>` from the page renders inside the callout so
 *     keyboard navigation to the cited list works.
 */

export interface InsightCalloutLabels {
  /** Eyebrow above the headline (e.g. "Top performer · last 90 days"). */
  eyebrow: string;
  /**
   * Headline copy · receives the close-rate % string and the list
   * name. The caller composes it so locale-appropriate word order
   * stays right ("23% close · Anchor Local" vs the inverse).
   */
  headline: (args: { closeRatePct: string; listName: string }) => string;
  /** Sub-line · "based on N engaged leads in 90d". */
  subline: (args: { sampleSize: number }) => string;
  /** Action label · "Open list →". */
  actionLabel: string;
}

export interface InsightCalloutProps {
  insight: ListAnalyticsInsight;
  /** Pre-resolved % formatter (locale-aware). */
  formatPct: (rate: number) => string;
  /** Pre-built link to `/lists/[id]` (caller owns i18n routing). */
  actionLink: React.ReactNode;
  labels: InsightCalloutLabels;
}

export function InsightCallout({
  insight,
  formatPct,
  actionLink,
  labels,
}: InsightCalloutProps) {
  const closeRatePct = formatPct(insight.closeRate);

  return (
    <section
      role="status"
      data-testid="list-analytics-insight-callout"
      aria-label={labels.eyebrow}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 16,
        alignItems: "center",
        padding: "14px 18px",
        background:
          "linear-gradient(135deg, rgba(91,61,245,.06), rgba(8,145,178,.04))",
        border: "1px solid rgba(91,61,245,.18)",
        borderRadius: 12,
        marginBottom: 22,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-agency-indigo)",
            marginBottom: 4,
          }}
        >
          {labels.eyebrow}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.4,
            color: "var(--color-text)",
          }}
        >
          {labels.headline({ closeRatePct, listName: insight.listName })}
        </p>
        <p
          style={{
            margin: "4px 0 0",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
          }}
        >
          {labels.subline({ sampleSize: insight.sampleSize })}
        </p>
      </div>
      <div data-testid="list-analytics-insight-action">{actionLink}</div>
    </section>
  );
}
