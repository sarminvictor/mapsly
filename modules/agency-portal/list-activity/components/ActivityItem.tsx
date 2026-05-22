import * as React from "react";

import type {
  ActivityEventKind,
  ActivityItem as ActivityItemData,
  LeadStatusValue,
} from "../types";

/**
 * ActivityItem · one row in the agency activity feed.
 *
 * Server-component-safe · pure presentational, no hooks, no state.
 * The caller (the page) passes pre-built locale-aware Links and
 * pre-resolved labels so this leaf stays free of next-intl imports
 * per `.claude/rules/i18n.md` — same pattern as the list-analytics
 * ListFunnelRow.
 *
 * Visual rhythm per `.claude/rules/ui-ux-agency.md`:
 *   - Mono uppercase verb badge per event kind ("NEW LEAD",
 *     "CONTACTED", "REPLIED", "WON", "LOST") · 10px mono · indigo /
 *     teal / success / alert tone driven by `kind`
 *   - Business name as the primary 13px label
 *   - Locale blurb + list link as 11px mono secondary line
 *   - "12m ago" timestamp right-aligned · tabular-nums
 */

export interface ActivityItemLabels {
  /** Pre-resolved verb badge per event kind. */
  verb: Record<ActivityEventKind, string>;
  /** Pre-resolved status pill label · "NEW" / "Won" etc. */
  statusPill: (status: LeadStatusValue) => string;
  /** Pre-resolved relative-time formatter ("12m ago" / "il y a 12 min"). */
  relativeTime: (iso: string) => string;
  /** Pre-resolved aria-label · "Anchor Local · contacted 12 minutes ago". */
  rowAria: (args: {
    businessName: string;
    verb: string;
    relativeTime: string;
  }) => string;
  /** "→ list" connector · "in" / "en" / "dans". */
  inListConnector: string;
}

export interface ActivityItemProps {
  item: ActivityItemData;
  labels: ActivityItemLabels;
  /** Pre-built next-intl Link to `/prospect/[businessId]`. */
  businessLink: React.ReactNode;
  /** Pre-built next-intl Link to `/lists/[id]`. */
  listLink: React.ReactNode;
}

/* ----------------------------------------------------- tone map */

type Tone = "neutral" | "indigo" | "teal" | "success" | "alert";

const KIND_TONE: Record<ActivityEventKind, Tone> = {
  lead_new: "neutral",
  lead_contacted: "indigo",
  lead_replied: "teal",
  lead_won: "success",
  lead_lost: "alert",
};

function toneColor(tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case "indigo":
      return {
        bg: "rgba(91,61,245,.10)",
        fg: "var(--color-agency-indigo)",
      };
    case "teal":
      return {
        bg: "rgba(8,145,178,.10)",
        fg: "var(--color-agency-teal)",
      };
    case "success":
      return {
        bg: "rgba(45,134,89,.12)",
        fg: "var(--color-success)",
      };
    case "alert":
      return {
        bg: "rgba(181,61,71,.10)",
        fg: "var(--color-alert)",
      };
    case "neutral":
    default:
      return {
        bg: "var(--color-bg-3)",
        fg: "var(--color-text-3)",
      };
  }
}

/* ----------------------------------------------------- component */

export function ActivityItem({
  item,
  labels,
  businessLink,
  listLink,
}: ActivityItemProps) {
  const tone = KIND_TONE[item.kind];
  const palette = toneColor(tone);
  const verb = labels.verb[item.kind];
  const relativeTime = labels.relativeTime(item.at);
  const rowAria = labels.rowAria({
    businessName: item.businessName,
    verb,
    relativeTime,
  });

  return (
    <li
      aria-label={rowAria}
      data-testid={`activity-item-${item.id}`}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "12px 16px",
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          padding: "3px 8px",
          borderRadius: 4,
          background: palette.bg,
          color: palette.fg,
          whiteSpace: "nowrap",
        }}
      >
        {verb}
      </span>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-text)",
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {businessLink}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 3,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
            lineHeight: 1.3,
          }}
        >
          {item.businessLocale ? <span>{item.businessLocale}</span> : null}
          {item.businessLocale ? <span aria-hidden>·</span> : null}
          <span>{labels.inListConnector}</span>
          {listLink}
        </div>
      </div>

      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {relativeTime}
      </span>
    </li>
  );
}
