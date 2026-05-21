import * as React from "react";

import type {
  LeadStatusCounts,
  LeadStatusValue,
} from "../types";

import { LEAD_STATUS_TAB_ORDER } from "../types";

/**
 * StatusTabs · the 6-tab status filter for the list-detail leads
 * table. Renders one chip per LeadStatus value with its count.
 *
 * Per `_design/agency/list-detail.html`:
 *
 *   - Pill-shaped chips · status-colored dot · count badge
 *   - The active tab is filled with the indigo tint
 *
 * Server-component-safe. Each tab is a real <a> (anchor) that links
 * to the same route with `?status=NEW`/`CONTACTED`/etc. — the page is
 * a server component that reads searchParams and re-renders with the
 * new active tab. The caller renders next-intl `<Link>`s here as
 * `linkFor(status)` so we stay locale-free.
 */

const DOT_TONE: Record<LeadStatusValue, string> = {
  NEW: "var(--color-agency-indigo)",
  CONTACTED: "var(--color-warn)",
  REPLIED: "var(--color-success)",
  WON: "var(--color-success)",
  LOST: "var(--color-alert)",
  HIDDEN: "var(--color-text-3)",
};

export interface StatusTabsLabels {
  /** Display name per status · "New", "Contacted", "Replied", etc. */
  statusLabel: Record<LeadStatusValue, string>;
  /** aria-label for the tab group · "Filter leads by status". */
  groupAriaLabel: string;
}

export interface StatusTabsProps {
  counts: LeadStatusCounts;
  activeStatus: LeadStatusValue;
  labels: StatusTabsLabels;
  /**
   * Caller produces a next-intl `<Link>` per status. We accept the
   * resolved ReactNode so this component stays locale-agnostic and
   * server-only.
   */
  linkFor: (status: LeadStatusValue, node: React.ReactNode) => React.ReactNode;
}

export function StatusTabs({
  counts,
  activeStatus,
  labels,
  linkFor,
}: StatusTabsProps) {
  return (
    <nav
      aria-label={labels.groupAriaLabel}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        marginBottom: 14,
        flexWrap: "wrap",
      }}
      data-testid="status-tabs"
    >
      {LEAD_STATUS_TAB_ORDER.map((status) => {
        const isActive = status === activeStatus;
        const count = counts[status];
        const content = (
          <span
            data-status={status}
            data-active={isActive ? "true" : undefined}
            aria-current={isActive ? "page" : undefined}
            style={{
              padding: "7px 13px",
              fontSize: 12.5,
              fontWeight: isActive ? 600 : 500,
              color: isActive
                ? "var(--color-agency-indigo)"
                : "var(--color-text-2)",
              background: isActive
                ? "rgba(91,61,245,.10)"
                : "var(--color-bg-2)",
              border: `1px solid ${
                isActive
                  ? "var(--color-agency-indigo)"
                  : "var(--color-border)"
              }`,
              borderRadius: 100,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              textDecoration: "none",
              transition: "background 120ms ease, border-color 120ms ease",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: DOT_TONE[status],
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            {labels.statusLabel[status]}
            <span
              aria-hidden="true"
              style={{
                background: isActive
                  ? "rgba(91,61,245,.18)"
                  : "var(--color-bg-3)",
                color: isActive
                  ? "var(--color-agency-indigo)"
                  : "var(--color-text-2)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 100,
              }}
            >
              {count}
            </span>
          </span>
        );
        return (
          <React.Fragment key={status}>
            {linkFor(status, content)}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
