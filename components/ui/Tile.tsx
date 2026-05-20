import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Tile · KPI display · big number + label + optional sublabel and trend.
 *
 * SMB version (default) uses Fraunces serif for the big number — warm, magazine-y.
 * Agency version (`audience="agency"`) uses Inter — tool-y, dashboard-y.
 *
 * The numeric value is rendered as-is (caller formats via Intl).
 */
export type TileAudience = "smb" | "agency";
export type TileTone = "neutral" | "good" | "warn" | "bad";
export type TileTrend = "up" | "down" | "flat";

export interface TileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Short metric name. e.g. "Mapsly Score", "Qualified leads". */
  label: React.ReactNode;
  /** The number/value itself. e.g. "6.2", "47", "$2,900". */
  value: React.ReactNode;
  /** Suffix appended to the value in smaller type. e.g. "/10", "%". */
  unit?: React.ReactNode;
  /** Smaller line below the value. e.g. "↑ 0.4 vs last week". */
  sublabel?: React.ReactNode;
  /** Optional trend arrow rendered with the sublabel. */
  trend?: TileTrend;
  /** Color tone — affects the value color, not the surrounding card. */
  tone?: TileTone;
  audience?: TileAudience;
  /** Accessible label for the value when it's purely numeric. */
  valueAriaLabel?: string;
}

function valueColor(tone: TileTone): string {
  switch (tone) {
    case "good":
      return "var(--color-success)";
    case "warn":
      return "var(--color-gold)";
    case "bad":
      return "var(--color-alert)";
    case "neutral":
    default:
      return "var(--color-text)";
  }
}

function trendGlyph(trend: TileTrend | undefined): string | null {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  if (trend === "flat") return "→";
  return null;
}

export function Tile({
  label,
  value,
  unit,
  sublabel,
  trend,
  tone = "neutral",
  audience = "smb",
  valueAriaLabel,
  className,
  style,
  ...rest
}: TileProps) {
  const numberFont =
    audience === "agency" ? "var(--font-sans)" : "var(--font-serif)";
  const valueFontSize = audience === "agency" ? 28 : 36;

  return (
    <div
      className={cn("mapsly-tile", className)}
      data-audience={audience}
      data-tone={tone}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: audience === "agency" ? 16 : 20,
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.2,
          textTransform: "uppercase",
          color: "var(--color-text-3)",
          lineHeight: 1.4,
        }}
      >
        {label}
      </span>

      <span
        aria-label={valueAriaLabel}
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: 4,
          fontFamily: numberFont,
          fontSize: valueFontSize,
          fontWeight: audience === "agency" ? 600 : 500,
          color: valueColor(tone),
          lineHeight: 1.1,
        }}
      >
        {value}
        {unit != null ? (
          <span
            style={{
              fontSize: valueFontSize * 0.5,
              fontWeight: 500,
              color: "var(--color-text-3)",
              fontFamily: "var(--font-sans)",
            }}
          >
            {unit}
          </span>
        ) : null}
      </span>

      {sublabel != null ? (
        <span
          style={{
            fontSize: 13,
            color: "var(--color-text-2)",
            lineHeight: 1.4,
          }}
        >
          {trend ? (
            <span aria-hidden style={{ marginRight: 4 }}>
              {trendGlyph(trend)}
            </span>
          ) : null}
          {sublabel}
        </span>
      ) : null}
    </div>
  );
}
