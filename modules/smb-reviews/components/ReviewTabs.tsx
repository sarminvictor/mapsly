import * as React from "react";

import { Link } from "@/i18n/navigation";

import type { ReviewTab, ReviewTabCounts } from "../types";

/**
 * ReviewTabs · the tab strip at the top of /(smb)/reviews.
 *
 * Server-component-safe — no client state. Each tab is a `Link` that
 * navigates to `?tab=...`. Server reads search params, re-runs the
 * query for the active tab, re-renders. This keeps the route streamable
 * AND shareable: Maria can bookmark the "Negative" tab and send it to a
 * partner without losing context.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Tab labels in plain English (no jargon)
 *   - Count badges use bad-tone (alert background) only for unanswered +
 *     negative; the rest are neutral
 *   - Active tab gets a coral underline
 *
 * Per `.claude/rules/accessibility.md`:
 *   - role="tablist" + role="tab" semantics, aria-current="page" on the
 *     active tab (since this is URL-driven navigation, not in-page
 *     state)
 */

export interface ReviewTabsLabels {
  unanswered: string;
  negative: string;
  all: string;
  byTheme: string;
  replied: string;
}

export interface ReviewTabsProps {
  activeTab: ReviewTab;
  counts: ReviewTabCounts;
  labels: ReviewTabsLabels;
}

interface TabSpec {
  id: ReviewTab;
  label: string;
  count?: number;
  alert?: boolean;
}

export function ReviewTabs({ activeTab, counts, labels }: ReviewTabsProps) {
  const tabs: TabSpec[] = [
    {
      id: "unanswered",
      label: labels.unanswered,
      count: counts.unanswered,
      alert: counts.unanswered > 0,
    },
    {
      id: "negative",
      label: labels.negative,
      count: counts.negative,
      alert: counts.negative > 0,
    },
    { id: "all", label: labels.all, count: counts.all },
    { id: "by-theme", label: labels.byTheme },
    { id: "replied", label: labels.replied, count: counts.replied },
  ];

  return (
    <nav
      role="tablist"
      aria-label="Review tabs"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginBottom: 20,
        borderBottom: "1px solid var(--color-border)",
        overflowX: "auto",
        paddingBottom: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={{ pathname: "/reviews", query: { tab: tab.id } }}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              marginBottom: -1,
              borderBottom: `2px solid ${
                isActive ? "var(--color-coral)" : "transparent"
              }`,
              color: isActive ? "var(--color-text)" : "var(--color-text-2)",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "border-color 0.15s ease, color 0.15s ease",
            }}
          >
            <span>{tab.label}</span>
            {tab.count != null && tab.count > 0 ? (
              <span
                aria-label={`${tab.count} ${tab.label}`}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: tab.alert
                    ? "rgba(181, 61, 71, 0.12)"
                    : "var(--color-bg-3, #f2ebe3)",
                  color: tab.alert
                    ? "var(--color-alert, #b53d47)"
                    : "var(--color-text-2)",
                }}
              >
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
