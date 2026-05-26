import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * KPITile · SMB dashboard KPI display.
 *
 * Maria-facing primitive. Cream-card surface, label in mono uppercase,
 * big Fraunces-serif number. Two sizes:
 *
 * - `variant="hero"` — the single dominant KPI on the dashboard
 *   (e.g. Mapsly Score 6.2/10). Number renders at 56px.
 * - `variant="standard"` (default) — secondary KPI row tiles. 32px number.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Mono uppercase label (small caps feel)
 *   - Big Fraunces number — warm, magazine-y
 *   - Optional sublabel with trend glyph (↑/↓/→) for delta context
 *   - Optional `infoTip` renders a hover-revealable jargon explanation
 *
 * The `coral` tone exists in addition to the shared tone set in
 * `components/ui/Tile.tsx` — Maria's hero score sometimes uses the brand
 * accent (e.g. an above-average score that's worth celebrating).
 *
 * Info-tip accessibility (per `.claude/rules/accessibility.md`):
 *   - The "i" indicator is a focusable button so keyboard users can reveal
 *     the tip via Tab + Enter (paired with the global `.info-tip` style).
 *   - `aria-label` carries the tooltip text so screen readers announce it.
 *   - `title` provides a native browser tooltip as a fallback (touch + hover).
 *   - No `role="img"` — the indicator is interactive, not decorative.
 *
 * Server-component-safe: no hooks, no event handlers. Tooltip CSS lives
 * in globals.css and uses `:hover` / `:focus-visible` for reveal.
 */

export type KPITileTone = "neutral" | "good" | "warn" | "bad" | "coral";
export type KPITileTrend = "up" | "down" | "flat";
export type KPITileVariant = "standard" | "hero";

export interface KPITileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Short metric name. Rendered uppercase mono. */
  label: React.ReactNode;
  /** The numeric / textual value. */
  value: React.ReactNode;
  /** Smaller suffix appended to the value. e.g. "/10", "%", "of 40". */
  unit?: React.ReactNode;
  /** Delta line under the value. Pair with `trend` for an arrow. */
  sublabel?: React.ReactNode;
  /** Trend direction for the sublabel arrow. */
  trend?: KPITileTrend;
  /** Color tone of the value. Determines which palette token the number uses. */
  tone?: KPITileTone;
  /** Display size. Hero ~ 56px, standard ~ 32px. */
  variant?: KPITileVariant;
  /** Plain-English explanation surfaced on hover/focus. Per copy-voice rules. */
  infoTip?: string;
  /** Accessible label for the value (override when value alone is ambiguous). */
  valueAriaLabel?: string;
}

function valueColor(tone: KPITileTone): string {
  switch (tone) {
    case "good":
      return "var(--color-success)";
    case "warn":
      return "var(--color-gold)";
    case "bad":
      return "var(--color-alert)";
    case "coral":
      return "var(--color-coral)";
    case "neutral":
    default:
      return "var(--color-text)";
  }
}

function trendGlyph(trend: KPITileTrend | undefined): string | null {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  if (trend === "flat") return "→";
  return null;
}

function trendColor(trend: KPITileTrend | undefined): string {
  if (trend === "up") return "var(--color-success)";
  if (trend === "down") return "var(--color-alert)";
  return "var(--color-text-3)";
}

/**
 * Internal · keyboard-accessible info-tip indicator. Renders as a real
 * <button> so Tab + Enter focus reveals the tooltip via CSS `:focus-visible`.
 */
function InfoTip({ text }: { text: string }) {
  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      data-tip={text}
      className="info-tip"
      tabIndex={0}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: "var(--color-bg-3)",
        color: "var(--color-text-3)",
        fontSize: 10,
        fontWeight: 700,
        cursor: "help",
        border: "none",
        padding: 0,
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
      }}
    >
      i
    </button>
  );
}

export function KPITile({
  label,
  value,
  unit,
  sublabel,
  trend,
  tone = "neutral",
  variant = "standard",
  infoTip,
  valueAriaLabel,
  className,
  style,
  ...rest
}: KPITileProps) {
  const isHero = variant === "hero";
  const numberSize = isHero ? 56 : 32;
  const unitSize = isHero ? 18 : 14;
  const padding = isHero ? 24 : 20;

  return (
    <div
      className={cn("mapsly-kpi-tile", className)}
      data-variant={variant}
      data-tone={tone}
      data-audience="smb"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding,
        boxShadow: "0 2px 8px rgba(28,25,22,.04)",
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-text-3)",
          lineHeight: 1.4,
        }}
      >
        {label}
        {infoTip ? <InfoTip text={infoTip} /> : null}
      </span>

      <span
        aria-label={valueAriaLabel}
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: 4,
          fontFamily: "var(--font-serif)",
          fontSize: numberSize,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: valueColor(tone),
          lineHeight: 1,
        }}
      >
        {value}
        {unit != null ? (
          <span
            style={{
              fontSize: unitSize,
              fontWeight: 500,
              color: "var(--color-text-3)",
              fontFamily: "var(--font-mono)",
              letterSpacing: 0,
            }}
          >
            {unit}
          </span>
        ) : null}
      </span>

      {sublabel != null ? (
        <span
          style={{
            fontSize: 12,
            color: "var(--color-text-2)",
            lineHeight: 1.4,
            marginTop: isHero ? 4 : 2,
          }}
        >
          {trend ? (
            <span
              aria-hidden
              style={{ marginRight: 4, color: trendColor(trend) }}
            >
              {trendGlyph(trend)}
            </span>
          ) : null}
          {sublabel}
        </span>
      ) : null}
    </div>
  );
}
