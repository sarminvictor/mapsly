import * as React from "react";

import { ServiceBadge } from "../../lists/components/ServiceBadge";
import { SERVICE_TEMPLATE_BY_TYPE } from "../../lists/service-templates";
import type { AgencyListDetailData, ListCadenceValue } from "../types";

/**
 * ListDetailHero · the `/(agency)/lists/[id]` hero card.
 *
 * Per `_design/agency/list-detail.html` and `.claude/rules/ui-ux-agency.md`:
 *
 *   - Pitch quote · indigo left-rule callout (Tom's pitch text to the prospect)
 *   - 5 dense KPI tiles · qualified / new-this-week / contacted / refresh / created
 *   - Mono uppercase labels · big number per tile (24px, weight 800)
 *   - Trend hints in mono ("vs +6 prior", "19% of list", "next: Tue 6:00")
 *
 * Server-component-safe · pure presentational, no hooks. All copy is
 * pre-resolved via the `labels` prop so the caller (page) owns the i18n.
 *
 * Performance: zero JS · pure DOM. The hero is the LCP element so we
 * keep it lean — no heavy SVGs, no client transitions, font is the
 * project's already-preloaded sans + mono stack.
 */

export interface ListDetailHeroLabels {
  /** "The pitch:" prefix bold-prefixed inside the pitch callout. */
  pitchLead: string;
  /** Stat tile labels. */
  qualifiedLabel: string;
  newThisWeekLabel: string;
  contactedLabel: string;
  refreshLabel: string;
  createdLabel: string;
  /** Stat tile meta lines · footnote text under each big number. */
  qualifiedMeta: (totalQualified: number) => string;
  newThisWeekMeta: (priorWeek: number) => string;
  contactedMeta: (pct: number) => string;
  refreshMeta: (cadence: ListCadenceValue) => string;
  createdMeta: (ownerName: string, ageDays: number) => string;
  refreshValue: (cadence: ListCadenceValue) => string;
  /** Format date as "Apr 22" / "22 abr" / "22 avr". */
  formatShortDate: (date: Date) => string;
  /** "n active" / "n paused" subtitle pill. */
  pausedPill: string;
  activePill: string;
  /** Service template fallback label (CUSTOM). */
  customServiceLabel: string;
}

export interface ListDetailHeroProps {
  data: NonNullable<AgencyListDetailData["list"]> & {
    /** Stats from the parent payload. */
    qualifiedCount: number;
    contactedCount: number;
    newThisWeekCount: number;
    newPriorWeekCount: number;
    totalLeads: number;
  };
  labels: ListDetailHeroLabels;
  /**
   * Pre-resolved service-template label (e.g. "Website rebuild") · the
   * page reads it from the same i18n namespace that powers F.1.
   */
  serviceLabel: string;
  /**
   * Current time in ms — passed from the page so the render function stays
   * pure (react-hooks/purity forbids `Date.now()` inside a component body).
   */
  nowMs: number;
}

export function ListDetailHero({
  data,
  labels,
  serviceLabel,
  nowMs,
}: ListDetailHeroProps) {
  const template = SERVICE_TEMPLATE_BY_TYPE[data.serviceType];
  const ageDays = Math.max(
    0,
    Math.floor((nowMs - data.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const contactedPct =
    data.totalLeads > 0
      ? Math.round((data.contactedCount / data.totalLeads) * 100)
      : 0;
  const badgeLabel =
    data.serviceType === "CUSTOM" ? labels.customServiceLabel : serviceLabel;

  return (
    <section
      aria-labelledby="list-detail-hero-title"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "24px 28px",
        marginBottom: 22,
        boxShadow: "0 1px 2px rgba(20,22,32,.04)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
          }}
        >
          <ServiceBadge
            tone={template?.badgeTone ?? "audit"}
            glyph={template?.glyph ?? "📊"}
            label={badgeLabel}
          />
          <h1
            id="list-detail-hero-title"
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
              minWidth: 0,
            }}
          >
            {data.name}
          </h1>
          <span
            data-testid="list-state-pill"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 9px",
              borderRadius: 100,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              background: data.isActive
                ? "rgba(34, 197, 94, .14)"
                : "var(--color-bg-3)",
              color: data.isActive
                ? "var(--color-success)"
                : "var(--color-text-3)",
            }}
          >
            {data.isActive ? labels.activePill : labels.pausedPill}
          </span>
        </div>
      </header>

      {data.pitch ? (
        <blockquote
          style={{
            margin: "0 0 18px",
            fontSize: 14,
            color: "var(--color-text-2)",
            lineHeight: 1.55,
            padding: "14px 16px",
            background: "var(--color-bg-3)",
            borderLeft: "3px solid var(--color-agency-indigo)",
            borderRadius: 8,
            fontStyle: "italic",
          }}
        >
          <b
            style={{
              color: "var(--color-text)",
              fontStyle: "normal",
              fontWeight: 600,
            }}
          >
            {labels.pitchLead}
          </b>{" "}
          {data.pitch}
        </blockquote>
      ) : null}

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: 20,
          paddingTop: 18,
          borderTop: "1px solid var(--color-border)",
          margin: 0,
        }}
        data-testid="list-hero-stats"
      >
        <HeroStat
          label={labels.qualifiedLabel}
          value={String(data.qualifiedCount)}
          valueTone="indigo"
          meta={labels.qualifiedMeta(data.totalLeads)}
        />
        <HeroStat
          label={labels.newThisWeekLabel}
          value={`+${data.newThisWeekCount}`}
          valueTone="green"
          meta={labels.newThisWeekMeta(data.newPriorWeekCount)}
        />
        <HeroStat
          label={labels.contactedLabel}
          value={String(data.contactedCount)}
          valueTone="warn"
          meta={labels.contactedMeta(contactedPct)}
        />
        <HeroStat
          label={labels.refreshLabel}
          value={labels.refreshValue(data.refreshCadence)}
          smallValue
          meta={labels.refreshMeta(data.refreshCadence)}
        />
        <HeroStat
          label={labels.createdLabel}
          value={labels.formatShortDate(data.createdAt)}
          smallValue
          meta={labels.createdMeta(data.ownerName, ageDays)}
        />
      </dl>
    </section>
  );
}

/* --------------------------------------------------------------- stat */

const VALUE_TONE: Record<"default" | "indigo" | "green" | "warn", string> = {
  default: "var(--color-text)",
  indigo: "var(--color-agency-indigo)",
  green: "var(--color-success)",
  warn: "var(--color-warn)",
};

function HeroStat({
  label,
  value,
  valueTone = "default",
  smallValue,
  meta,
}: {
  label: string;
  value: string;
  valueTone?: keyof typeof VALUE_TONE;
  smallValue?: boolean;
  meta: string;
}) {
  return (
    <div>
      <dt
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-3)",
          marginBottom: 5,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: smallValue ? 17 : 24,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          color: VALUE_TONE[valueTone],
        }}
      >
        {value}
      </dd>
      <p
        style={{
          fontSize: 11,
          color: "var(--color-text-3)",
          marginTop: 4,
          marginBottom: 0,
          fontFamily: "var(--font-mono)",
        }}
      >
        {meta}
      </p>
    </div>
  );
}
