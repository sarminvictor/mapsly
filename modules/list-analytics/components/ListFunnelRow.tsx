import * as React from "react";

import type { ListFunnelRow as FunnelRowData } from "../types";

/**
 * ListFunnelRow · one row of the per-list funnel table.
 *
 * Renders the list name + 5 numeric cells (new / contacted / replied /
 * won / lost) + a compact 5-segment SVG funnel viz scaled to the row's
 * `totalLeads`. The SVG is bar-style (not Sankey) per `.claude/rules/
 * ui-ux-agency.md` "Charts can be complex if they serve a workflow"
 * — bar viz is the cleanest read for a 5-stage funnel.
 *
 * The list-name cell accepts a pre-built `nameLink` ReactNode so the
 * caller (the page) can wire the i18n-aware `Link` from `@/i18n/
 * navigation` without leaking next-intl imports into this leaf
 * component. Per `.claude/rules/i18n.md` — the page owns routing.
 *
 * Server-component-safe · pure presentational. No state, no hooks.
 *
 * Accessibility:
 *   - SVG has `role="img"` + `aria-label` describing the funnel
 *   - Table cells use `<td>` (parent owns the `<tr>` wrap so callers
 *     can control row striping / hover styles)
 */

export interface ListFunnelRowLabels {
  /** Pre-resolved integer formatter ("1,247" / "1.247" / "1 247"). */
  formatInt: (n: number) => string;
  /** Pre-resolved paused-pill label · rendered next to the list name when paused. */
  pausedPill: string;
  /** Funnel aria-label · receives the 5 totals + listName. */
  funnelAria: (args: {
    listName: string;
    new: number;
    contacted: number;
    replied: number;
    won: number;
    lost: number;
  }) => string;
  /** Empty-row affordance · shown when totalLeads === 0. */
  emptyRowHint: string;
}

export interface ListFunnelRowProps {
  row: FunnelRowData;
  labels: ListFunnelRowLabels;
  /**
   * Pre-built link node wrapping the list name. The page constructs
   * this with the i18n-aware `Link` so route translation works
   * (e.g. `/lists/[id]` → `/es/listas/[id]`).
   */
  nameLink: React.ReactNode;
}

/* ------------------------------------------------------ funnel SVG */

interface FunnelSegment {
  label: string;
  count: number;
  fill: string;
}

function FunnelSvg({
  segments,
  total,
  ariaLabel,
}: {
  segments: FunnelSegment[];
  total: number;
  ariaLabel: string;
}) {
  // SVG geometry: 120 wide × 22 tall · each segment is a horizontal
  // band with width proportional to its share of `total`. Single
  // horizontal bar with 5 segments — a "stacked funnel" that scans
  // left-to-right (NEW → LOST).
  const width = 120;
  const height = 22;
  if (total <= 0) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block" }}
      >
        <rect
          x={0}
          y={6}
          width={width}
          height={10}
          rx={3}
          fill="var(--color-bg-3, #eef0f5)"
        />
      </svg>
    );
  }

  // Pre-compute x offsets via reduce — no mutation during .map. React 19
  // compiler's react-hooks/immutability rule forbids reassignment of
  // render-scope vars after render completes.
  const positioned = segments.reduce<
    { label: string; fill: string; count: number; x: number; w: number }[]
  >((acc, s) => {
    const w = (s.count / total) * width;
    const prev = acc[acc.length - 1];
    const x = prev ? prev.x + prev.w : 0;
    acc.push({ label: s.label, fill: s.fill, count: s.count, x, w });
    return acc;
  }, []);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      {positioned.map((s) =>
        s.w <= 0 ? null : (
          <rect
            key={s.label}
            x={s.x}
            y={6}
            width={s.w}
            height={10}
            fill={s.fill}
          >
            <title>{`${s.label}: ${s.count}`}</title>
          </rect>
        ),
      )}
    </svg>
  );
}

/* ------------------------------------------------------------ row */

export function ListFunnelRow({ row, labels, nameLink }: ListFunnelRowProps) {
  const { totals, totalLeads } = row;

  const segments: FunnelSegment[] = [
    { label: "New", count: totals.new, fill: "var(--color-text-3, #94a3b8)" },
    {
      label: "Contacted",
      count: totals.contacted,
      fill: "var(--color-agency-indigo, #5b3df5)",
    },
    {
      label: "Replied",
      count: totals.replied,
      fill: "var(--color-agency-teal, #0891b2)",
    },
    { label: "Won", count: totals.won, fill: "var(--color-success, #16a34a)" },
    { label: "Lost", count: totals.lost, fill: "var(--color-alert, #dc2626)" },
  ];

  const cellStyle: React.CSSProperties = {
    padding: "10px 8px",
    fontVariantNumeric: "tabular-nums",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--color-text)",
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  const nameStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 13,
    color: "var(--color-text)",
    fontWeight: 600,
    textAlign: "left",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 280,
  };

  const funnelAria = labels.funnelAria({
    listName: row.listName,
    new: totals.new,
    contacted: totals.contacted,
    replied: totals.replied,
    won: totals.won,
    lost: totals.lost,
  });

  return (
    <>
      <td style={nameStyle}>
        {nameLink}
        {row.isActive ? null : (
          <span
            style={{
              marginLeft: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-3)",
            }}
          >
            {labels.pausedPill}
          </span>
        )}
      </td>
      <td style={cellStyle}>{labels.formatInt(totals.new)}</td>
      <td style={cellStyle}>{labels.formatInt(totals.contacted)}</td>
      <td style={cellStyle}>{labels.formatInt(totals.replied)}</td>
      <td style={cellStyle}>{labels.formatInt(totals.won)}</td>
      <td style={cellStyle}>{labels.formatInt(totals.lost)}</td>
      <td
        style={{
          padding: "10px 12px",
          textAlign: "left",
          minWidth: 132,
        }}
      >
        {totalLeads === 0 ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-text-3)",
            }}
          >
            {labels.emptyRowHint}
          </span>
        ) : (
          <FunnelSvg
            segments={segments}
            total={totalLeads}
            ariaLabel={funnelAria}
          />
        )}
      </td>
    </>
  );
}
