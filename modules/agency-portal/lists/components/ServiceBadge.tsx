/**
 * ServiceBadge · the per-card "service this list sells" pill.
 *
 * Dense, agency-voice. Renders `{glyph} {label}` with a tone-keyed
 * background tint pulled from the service template. Used on every
 * `ListCard` so Tom can scan the lists grid by service type at a
 * glance.
 *
 * Per `.claude/rules/ui-ux-agency.md`: mono uppercase label, jargon-OK.
 *
 * Server-component-safe. No interactivity, just inline styles.
 */

import * as React from "react";

import type { ServiceTemplateDescriptor } from "../service-templates";

export interface ServiceBadgeProps {
  /** Glyph (emoji or short string) to render before the label. */
  glyph: string;
  /** Human label, already i18n-resolved by the caller. */
  label: string;
  /** Tone token suffix · drives the background tint. */
  tone: ServiceTemplateDescriptor["badgeTone"];
}

const TONE: Record<
  ServiceTemplateDescriptor["badgeTone"],
  { bg: string; fg: string }
> = {
  web: { bg: "rgba(8,145,178,.12)", fg: "var(--color-agency-teal)" },
  ads: { bg: "rgba(91,61,245,.10)", fg: "var(--color-agency-indigo)" },
  seo: { bg: "rgba(217,119,6,.14)", fg: "#9a6a08" },
  review: { bg: "rgba(220,38,38,.10)", fg: "var(--color-alert)" },
  brand: { bg: "rgba(22,163,74,.14)", fg: "var(--color-success)" },
  launch: { bg: "rgba(107,79,155,.14)", fg: "#6b4f9b" },
  audit: { bg: "rgba(28,25,22,.10)", fg: "var(--color-text)" },
};

export function ServiceBadge({ glyph, label, tone }: ServiceBadgeProps) {
  const { bg, fg } = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding: "3px 8px",
        borderRadius: 4,
        background: bg,
        color: fg,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden>{glyph}</span>
      {label}
    </span>
  );
}
