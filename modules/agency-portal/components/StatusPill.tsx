import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * StatusPill · interactive lead status indicator.
 *
 * The Agency portal's per-row status surface. Each row in the leads table
 * renders one — clicking it cycles status (New → Contacted → Replied → Won
 * → Lost → Hidden) or opens a popover for explicit selection (caller wires
 * the interaction via `onClick` on the underlying button).
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Mono uppercase label (Tom's portal · dense, scan-friendly)
 *   - Tone derives from status enum value (Prisma LeadStatus)
 *   - Optional trailing "⌄" disclosure glyph signals "this is interactive"
 *   - Optional dwell suffix ("· 3d", "· interested") for context
 *   - Clickable by default (acts as a real <button> for keyboard a11y)
 *
 * Per `.claude/rules/accessibility.md`:
 *   - Real <button> · Tab + Enter focusable
 *   - aria-label includes status + dwell when present
 *   - Status is NEVER color-alone — label always rendered
 *
 * Server-component-safe if rendered as `as="span"` (read-only). Default
 * `as="button"` requires a client-component caller to wire interactions.
 */

export type LeadStatusValue =
  | "NEW"
  | "CONTACTED"
  | "REPLIED"
  | "WON"
  | "LOST"
  | "HIDDEN";

export type StatusPillSize = "sm" | "md";

export interface StatusPillProps {
  /** Current lead status (Prisma LeadStatus enum value). */
  status: LeadStatusValue;
  /** Optional dwell / context suffix · e.g. "3d" or "interested". */
  dwell?: React.ReactNode;
  /** Override the displayed label. Default derives from `status`. */
  label?: React.ReactNode;
  /** Pill size. Default "sm" (matches list-detail table density). */
  size?: StatusPillSize;
  /** Show the trailing disclosure glyph "⌄". Default true. */
  showDisclosure?: boolean;
  /** Click handler · status-cycle / popover trigger. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** Render as a `<span>` instead of `<button>` (non-interactive). */
  as?: "button" | "span";
  /** Disabled (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Override the auto-generated aria-label. */
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

const STATUS_LABEL: Record<LeadStatusValue, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  WON: "Won ✓",
  LOST: "Lost",
  HIDDEN: "Hidden",
};

const STATUS_STYLES: Record<
  LeadStatusValue,
  { bg: string; fg: string; border: string }
> = {
  NEW: {
    bg: "rgba(91,61,245,.10)",
    fg: "var(--color-agency-indigo)",
    border: "transparent",
  },
  CONTACTED: {
    bg: "rgba(8,145,178,.12)",
    fg: "var(--color-agency-teal)",
    border: "transparent",
  },
  REPLIED: {
    bg: "rgba(212,165,116,.20)",
    fg: "var(--color-berry)",
    border: "transparent",
  },
  WON: {
    bg: "var(--color-success)",
    fg: "#ffffff",
    border: "var(--color-success)",
  },
  LOST: {
    bg: "rgba(181,61,71,.14)",
    fg: "var(--color-alert)",
    border: "transparent",
  },
  HIDDEN: {
    bg: "var(--color-bg-3)",
    fg: "var(--color-text-3)",
    border: "transparent",
  },
};

const SIZE_STYLES: Record<StatusPillSize, React.CSSProperties> = {
  sm: {
    fontSize: 10.5,
    padding: "4px 10px",
    borderRadius: 5,
    letterSpacing: "0.05em",
    gap: 5,
  },
  md: {
    fontSize: 11.5,
    padding: "5px 12px",
    borderRadius: 6,
    letterSpacing: "0.05em",
    gap: 6,
  },
};

export function StatusPill({
  status,
  dwell,
  label,
  size = "sm",
  showDisclosure = true,
  onClick,
  as = "button",
  disabled,
  ariaLabel,
  className,
  style,
}: StatusPillProps) {
  const tone = STATUS_STYLES[status];
  const baseLabel = label ?? STATUS_LABEL[status];
  const computedAria =
    ariaLabel ??
    (typeof baseLabel === "string"
      ? `Lead status ${baseLabel}${dwell != null ? ` ${String(dwell)}` : ""}`
      : undefined);

  const mergedStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontFamily: "var(--font-mono)",
    fontWeight: 700,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    lineHeight: 1,
    cursor: as === "button" && !disabled ? "pointer" : "default",
    background: tone.bg,
    color: tone.fg,
    border: `1px solid ${tone.border}`,
    opacity: disabled ? 0.5 : 1,
    transition: "filter 120ms ease",
    ...SIZE_STYLES[size],
    ...style,
  };

  const content = (
    <>
      <span>{baseLabel}</span>
      {dwell != null ? (
        <span
          style={{ opacity: 0.7, fontWeight: 600, marginLeft: -2 }}
          aria-hidden="true"
        >
          · {dwell}
        </span>
      ) : null}
      {showDisclosure && as === "button" ? (
        <span
          aria-hidden="true"
          style={{
            marginLeft: 1,
            fontSize: 9,
            opacity: 0.6,
            lineHeight: 1,
          }}
        >
          ⌄
        </span>
      ) : null}
    </>
  );

  if (as === "span") {
    return (
      <span
        className={cn("mapsly-status-pill", className)}
        data-status={status}
        data-audience="agency"
        aria-label={computedAria}
        style={mergedStyle}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn("mapsly-status-pill", className)}
      data-status={status}
      data-audience="agency"
      aria-label={computedAria}
      style={mergedStyle}
    >
      {content}
    </button>
  );
}
