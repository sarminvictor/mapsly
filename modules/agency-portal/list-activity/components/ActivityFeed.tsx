import * as React from "react";

import type { ActivityItem as ActivityItemData } from "../types";
import {
  ActivityItem,
  type ActivityItemLabels,
  type ActivityItemProps,
} from "./ActivityItem";

/**
 * ActivityFeed · the rendered list of `ActivityItem` rows.
 *
 * Server-component-safe. The caller passes a pre-built link
 * constructor (`linkForItem`) so this component stays decoupled
 * from next-intl's `Link` per `.claude/rules/i18n.md`.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Dense rows · 10px gap between cards
 *   - Mono uppercase verbs as the left-anchor
 *   - Tabular-nums timestamps right-anchored
 *   - Empty state explains WHY ("Nothing happened across your lists
 *     in the last 14 days") and WHAT TO DO ("Tweak filters or wait
 *     for next refresh").
 */

export interface ActivityFeedLabels {
  /** Aria label for the feed section. */
  feedAria: string;
  /** Empty state copy. */
  emptyTitle: string;
  emptyBody: string;
  /** Shown when the feed is at the rendered cap. */
  cappedFooter: (args: { shown: number; total: number }) => string;
  /** Last-refresh footer ("Last refresh · 2h ago"). */
  lastRefreshLabel: (relative: string) => string;
  /** Row-level pre-resolved labels (shared formatters). */
  row: ActivityItemLabels;
}

export interface ActivityFeedProps {
  items: ActivityItemData[];
  totalEvents: number;
  /** Pre-resolved relative time of the last list refresh; null when never. */
  lastListRefreshRelative: string | null;
  labels: ActivityFeedLabels;
  /**
   * Per-row link constructor · builds the (business, list) Link
   * pair using the caller's i18n-aware navigation. The caller owns
   * routing so this leaf never imports next-intl directly.
   */
  linkForItem: (
    item: ActivityItemData,
  ) => Pick<ActivityItemProps, "businessLink" | "listLink">;
}

export function ActivityFeed({
  items,
  totalEvents,
  lastListRefreshRelative,
  labels,
  linkForItem,
}: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <section
        aria-label={labels.feedAria}
        data-testid="agency-activity-feed-empty"
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "32px 24px",
          textAlign: "center",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text)",
          }}
        >
          {labels.emptyTitle}
        </p>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 12,
            color: "var(--color-text-2)",
            lineHeight: 1.5,
          }}
        >
          {labels.emptyBody}
        </p>
        {lastListRefreshRelative ? (
          <p
            style={{
              margin: "12px 0 0",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-text-3)",
            }}
          >
            {labels.lastRefreshLabel(lastListRefreshRelative)}
          </p>
        ) : null}
      </section>
    );
  }

  const capped = items.length < totalEvents;

  return (
    <section aria-label={labels.feedAria} data-testid="agency-activity-feed">
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 8,
        }}
      >
        {items.map((item) => {
          const { businessLink, listLink } = linkForItem(item);
          return (
            <ActivityItem
              key={item.id}
              item={item}
              labels={labels.row}
              businessLink={businessLink}
              listLink={listLink}
            />
          );
        })}
      </ul>
      <div
        style={{
          marginTop: 14,
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
        }}
      >
        {capped ? (
          <span data-testid="activity-feed-capped-footer">
            {labels.cappedFooter({ shown: items.length, total: totalEvents })}
          </span>
        ) : (
          <span />
        )}
        {lastListRefreshRelative ? (
          <span data-testid="activity-feed-last-refresh">
            {labels.lastRefreshLabel(lastListRefreshRelative)}
          </span>
        ) : null}
      </div>
    </section>
  );
}
