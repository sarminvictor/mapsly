/**
 * ListCard · one card on the agency lists grid.
 *
 * Server-component-safe rendering. The hover-revealed action buttons
 * are presentational placeholders for F.1 — wired to clone/pause/more
 * server actions in a follow-up phase (F.3 list detail surfaces them
 * more prominently). They're rendered as real <button>s so keyboard
 * users CAN tab to them; clicking is a no-op for now (no `onClick`).
 *
 * The whole card is a clickable link wrapping the body, with the
 * action buttons stop-propagating their own click events so they can
 * be wired without bubbling to the card link. For F.1 the card link
 * points at `/lists/${listId}` (F.3 destination, still pending) — the
 * route returns 404 today which is acceptable for a scaffold landing.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Dense, scan-friendly, mono uppercase labels for stats
 *   - Hover lifts border to indigo
 *   - "Fresh" treatment when there are new leads this week
 *
 * Per `.claude/rules/accessibility.md`:
 *   - Real `<a>` for card click + real `<button>` for actions
 *   - Card has an accessible-name from the visible list name
 *   - Stats use mono numerals so screen-readers say "47, qualified"
 */

import * as React from "react";

import {
  SERVICE_TEMPLATE_BY_TYPE,
  type ServiceTemplateDescriptor,
} from "../service-templates";
import type { AgencyListSummary } from "../types";

import { ServiceBadge } from "./ServiceBadge";

export interface ListCardLabels {
  badge: string;
  newPill: (n: number) => string;
  pausedPill: string;
  /** Stat labels · qualified / this week / engaged. */
  qualifiedLabel: string;
  thisWeekLabel: string;
  engagedLabel: string;
  /** Cadence footer fragment, e.g. "Refreshes daily 6am". */
  cadenceLabel: (cadence: AgencyListSummary["refreshCadence"]) => string;
  /** Action button titles for screen-readers / tooltips. */
  cloneAction: string;
  pauseAction: string;
  resumeAction: string;
  moreAction: string;
  /** Target line, e.g. "target: med spas · Miami · 5mi". */
  targetLabel: (parts: {
    category: string | null;
    metro: string | null;
    radiusMi: number | null;
  }) => string;
}

export interface ListCardProps {
  list: AgencyListSummary;
  /** Already-i18n-resolved fallback service label (e.g. for CUSTOM). */
  customServiceLabel: string;
  /** Pre-resolved labels for stats, pills, actions. */
  labels: ListCardLabels;
}

export function ListCard({ list, customServiceLabel, labels }: ListCardProps) {
  const template: ServiceTemplateDescriptor | undefined =
    SERVICE_TEMPLATE_BY_TYPE[list.serviceType];
  const glyph = template?.glyph ?? "📊";
  const tone = template?.badgeTone ?? "audit";
  const badgeLabel =
    list.serviceType === "CUSTOM" ? customServiceLabel : labels.badge;

  const hasNew = list.newThisWeekCount > 0;
  const accent = list.isActive
    ? "var(--color-agency-indigo)"
    : "var(--color-border)";

  return (
    <article
      className="mapsly-agency-list-card"
      style={{
        position: "relative",
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "20px 22px",
        opacity: list.isActive ? 1 : 0.7,
      }}
    >
      {/* Fresh-status accent strip · only when the list has new leads */}
      {hasNew && list.isActive ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background:
              "linear-gradient(90deg, var(--color-agency-indigo), var(--color-agency-teal))",
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
          }}
        />
      ) : null}

      {/* Hover-revealed action cluster · placeholder for F.3 wiring.
          The visibility toggle lives in app/globals.css under the
          .mapsly-agency-card-actions selector — inline styles can't
          express :hover or :focus-within. */}
      <div
        className="mapsly-agency-card-actions"
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          display: "flex",
          gap: 4,
          zIndex: 2,
        }}
      >
        <ActionButton title={labels.cloneAction} glyph={cloneGlyph} />
        <ActionButton
          title={list.isActive ? labels.pauseAction : labels.resumeAction}
          glyph={list.isActive ? pauseGlyph : playGlyph}
        />
        <ActionButton title={labels.moreAction} glyph={moreGlyph} />
      </div>

      {/* Card link covers the body content. Stop-propagation on the
          action buttons means the link still wraps everything else. */}
      <a
        href={`/lists/${list.id}`}
        aria-label={list.name}
        style={{
          display: "block",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div style={{ marginBottom: 10 }}>
          <ServiceBadge glyph={glyph} label={badgeLabel} tone={tone} />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <h3
            style={{
              flex: 1,
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.3,
              color: "var(--color-text)",
            }}
          >
            {list.name}
          </h3>
          <StatusPill
            text={
              list.isActive
                ? labels.newPill(list.newThisWeekCount)
                : labels.pausedPill
            }
            tone={list.isActive && hasNew ? "fresh" : "muted"}
          />
        </div>

        <p
          style={{
            margin: "0 0 10px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
          }}
        >
          {labels.targetLabel({
            category: list.category,
            metro: list.metro,
            radiusMi: list.radiusMi,
          })}
        </p>

        {list.pitch ? (
          <p
            style={{
              margin: "0 0 14px",
              fontSize: 12.5,
              fontStyle: "italic",
              lineHeight: 1.5,
              color: "var(--color-text-2)",
            }}
          >
            “{list.pitch}”
          </p>
        ) : null}

        {/* 3-column stat row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
            padding: "12px 0",
            borderTop: "1px solid var(--color-border)",
            borderBottom: "1px solid var(--color-border)",
            marginBottom: 12,
          }}
        >
          <Stat
            value={list.qualifiedCount}
            label={labels.qualifiedLabel}
            tone="indigo"
          />
          <Stat
            value={
              list.newThisWeekCount > 0
                ? `+${list.newThisWeekCount}`
                : list.newThisWeekCount
            }
            label={labels.thisWeekLabel}
            tone={hasNew ? "green" : "neutral"}
          />
          <Stat
            value={list.engagedCount}
            label={labels.engagedLabel}
            tone="neutral"
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
          }}
        >
          <span>{labels.cadenceLabel(list.refreshCadence)}</span>
          <span aria-hidden style={{ color: accent }}>
            ›
          </span>
        </div>
      </a>
    </article>
  );
}

function StatusPill({ text, tone }: { text: string; tone: "fresh" | "muted" }) {
  const palette =
    tone === "fresh"
      ? { bg: "rgba(91,61,245,.10)", fg: "var(--color-agency-indigo)" }
      : { bg: "var(--color-bg-3)", fg: "var(--color-text-3)" };
  return (
    <span
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
      {text}
    </span>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone: "indigo" | "green" | "neutral";
}) {
  const color =
    tone === "indigo"
      ? "var(--color-agency-indigo)"
      : tone === "green"
        ? "var(--color-success)"
        : "var(--color-text)";
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--color-text-3)",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** Decorative action button (placeholder until F.3 wires server actions). */
function ActionButton({
  title,
  glyph,
}: {
  title: string;
  glyph: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-2)",
        cursor: "pointer",
        padding: 0,
      }}
    >
      {glyph}
    </button>
  );
}

// Inline SVG glyphs (lucide-react copy, kept as React nodes to avoid
// pulling lucide into this server component module).
const cloneGlyph = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const pauseGlyph = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden
  >
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);
const playGlyph = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden
  >
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);
const moreGlyph = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden
  >
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </svg>
);
