import * as React from "react";

import type { ListAnalyticsStats, ListAnalyticsSampleSizes } from "../types";

/**
 * StatHeader · the 4-stat hero row for `/(agency)/list-analytics`.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - 4 dense KPI tiles in a single row · mono uppercase labels
 *   - Big number (28px, weight 800) per tile · help-text in mono below
 *   - Tom's voice: numbers over adjectives, jargon-OK
 *
 * Server-component-safe · pure presentational, no hooks, no state.
 * All copy pre-resolved via the `labels` prop so the caller owns i18n.
 *
 * Per `.claude/rules/accessibility.md` the help text is `aria-describedby`-
 * linked to the value cell so screen readers announce "Reply rate · 12% ·
 * Replied or further / contacted-or-further".
 */

export interface StatHeaderLabels {
  surfacedTitle: string;
  surfacedHelp: string;
  contactRateTitle: string;
  contactRateHelp: string;
  replyRateTitle: string;
  replyRateHelp: string;
  closedWonTitle: string;
  closedWonHelp: string;
  /** Pre-resolved percentage formatter ("12%" / "12 %" / "12 %") per locale. */
  formatPct: (rate: number) => string;
  /** Pre-resolved integer formatter ("1,247" / "1.247" / "1 247") per locale. */
  formatInt: (n: number) => string;
  /**
   * Per-tile meta lines · short numeric sample-size hints rendered
   * under the help text. Tom's voice — "across 7 lists", "32 of 84 leads".
   * All pre-resolved so the component owns no i18n.
   */
  surfacedMeta: string;
  contactRateMeta: string;
  replyRateMeta: string;
  closedWonMeta: string;
}

export interface StatHeaderProps {
  stats: ListAnalyticsStats;
  /** Sample sizes feeding each tile · drives the meta line under each. */
  sampleSizes: ListAnalyticsSampleSizes;
  labels: StatHeaderLabels;
}

export function StatHeader({ stats, labels }: StatHeaderProps) {
  const tiles: Array<{
    id: string;
    title: string;
    help: string;
    value: string;
    meta: string;
  }> = [
    {
      id: "surfaced",
      title: labels.surfacedTitle,
      help: labels.surfacedHelp,
      value: labels.formatInt(stats.surfaced90d),
      meta: labels.surfacedMeta,
    },
    {
      id: "contact-rate",
      title: labels.contactRateTitle,
      help: labels.contactRateHelp,
      value: labels.formatPct(stats.contactRate),
      meta: labels.contactRateMeta,
    },
    {
      id: "reply-rate",
      title: labels.replyRateTitle,
      help: labels.replyRateHelp,
      value: labels.formatPct(stats.replyRate),
      meta: labels.replyRateMeta,
    },
    {
      id: "closed-won",
      title: labels.closedWonTitle,
      help: labels.closedWonHelp,
      value: labels.formatPct(stats.closedWon),
      meta: labels.closedWonMeta,
    },
  ];

  return (
    <section
      aria-label="List analytics summary"
      data-testid="list-analytics-stat-header"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginBottom: 22,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.id}
          data-testid={`stat-${t.id}`}
          style={{
            background: "var(--color-bg-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-3)",
            }}
          >
            {t.title}
          </span>
          <span
            aria-describedby={`stat-${t.id}-help`}
            style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              lineHeight: 1.1,
            }}
          >
            {t.value}
          </span>
          <span
            id={`stat-${t.id}-help`}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-text-3)",
              lineHeight: 1.4,
            }}
          >
            {t.help}
          </span>
          {t.meta ? (
            <span
              data-testid={`stat-${t.id}-meta`}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                fontWeight: 600,
                color: "var(--color-agency-indigo)",
                lineHeight: 1.4,
              }}
            >
              {t.meta}
            </span>
          ) : null}
        </div>
      ))}
    </section>
  );
}
