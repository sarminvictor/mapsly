import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Pill · small status indicator. Color + label, never color alone.
 *
 * Pair with an icon or label for accessibility. The tone maps to the
 * project palette tokens; pass `tone="custom"` plus inline `style` for
 * one-off colors (rare — prefer adding a new tone token).
 */
export type PillTone =
  | "neutral"
  | "info"
  | "good"
  | "warn"
  | "bad"
  | "new"
  | "contacted"
  | "replied"
  | "won"
  | "lost"
  | "hidden";

export type PillAudience = "smb" | "agency";
export type PillSize = "sm" | "md";

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  size?: PillSize;
  audience?: PillAudience;
  /** Show a leading dot indicator. Default true. */
  dot?: boolean;
  /** Optional title attribute for hover-tooltip. */
  title?: string;
}

const TONE_COLORS: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  neutral: {
    bg: "var(--color-bg-3)",
    fg: "var(--color-text-2)",
    dot: "var(--color-text-3)",
  },
  info: {
    bg: "rgba(91,61,245,.10)",
    fg: "var(--color-agency-indigo)",
    dot: "var(--color-agency-indigo)",
  },
  good: {
    bg: "rgba(45,134,89,.12)",
    fg: "var(--color-success)",
    dot: "var(--color-success)",
  },
  warn: {
    bg: "rgba(212,165,116,.16)",
    fg: "var(--color-berry)",
    dot: "var(--color-gold)",
  },
  bad: {
    bg: "rgba(181,61,71,.12)",
    fg: "var(--color-alert)",
    dot: "var(--color-alert)",
  },
  // Lead-status aliases
  new: {
    bg: "rgba(91,61,245,.10)",
    fg: "var(--color-agency-indigo)",
    dot: "var(--color-agency-indigo)",
  },
  contacted: {
    bg: "rgba(8,145,178,.12)",
    fg: "var(--color-agency-teal)",
    dot: "var(--color-agency-teal)",
  },
  replied: {
    bg: "rgba(212,165,116,.16)",
    fg: "var(--color-berry)",
    dot: "var(--color-gold)",
  },
  won: {
    bg: "rgba(45,134,89,.12)",
    fg: "var(--color-success)",
    dot: "var(--color-success)",
  },
  lost: {
    bg: "rgba(181,61,71,.12)",
    fg: "var(--color-alert)",
    dot: "var(--color-alert)",
  },
  hidden: {
    bg: "var(--color-bg-3)",
    fg: "var(--color-text-3)",
    dot: "var(--color-text-3)",
  },
};

const SIZE_STYLES: Record<PillSize, React.CSSProperties> = {
  sm: { height: 20, fontSize: 11, padding: "0 8px", borderRadius: 10 },
  md: { height: 24, fontSize: 12, padding: "0 10px", borderRadius: 12 },
};

export function Pill({
  tone = "neutral",
  size = "md",
  audience = "smb",
  dot = true,
  className,
  style,
  children,
  ...rest
}: PillProps) {
  const colors = TONE_COLORS[tone];

  return (
    <span
      className={cn("mapsly-pill", className)}
      data-tone={tone}
      data-audience={audience}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: colors.bg,
        color: colors.fg,
        border: "1px solid transparent",
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
        lineHeight: 1,
        ...SIZE_STYLES[size],
        ...style,
      }}
      {...rest}
    >
      {dot ? (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: colors.dot,
            flexShrink: 0,
          }}
        />
      ) : null}
      {children}
    </span>
  );
}
