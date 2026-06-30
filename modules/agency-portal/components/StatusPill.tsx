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
 * VISUAL · this primitive now renders the ported prototype classes
 * (`.statpill` + `.st-{STATUS}`) defined in `agency-portal.css`, so the
 * portal's cool-gray + indigo design system drives the look. No inline tone
 * styles — the class carries the color.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Uppercase label (Tom's portal · dense, scan-friendly)
 *   - Tone derives from status enum value (Prisma LeadStatus)
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

export interface StatusPillProps {
  /** Current lead status (Prisma LeadStatus enum value). */
  status: LeadStatusValue;
  /** Optional dwell / context suffix · e.g. "3d" or "interested". */
  dwell?: React.ReactNode;
  /** Override the displayed label. Default derives from `status`. */
  label?: React.ReactNode;
  /** Click handler · status-cycle / popover trigger. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** Render as a `<span>` instead of `<button>` (non-interactive). */
  as?: "button" | "span";
  /** Disabled (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Override the auto-generated aria-label. */
  ariaLabel?: string;
  /** Optional title attr (e.g. "Click to change status"). */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** Human label per status. Sentence-case (the CSS handles weight/size). */
const STATUS_LABEL: Record<LeadStatusValue, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  WON: "Won",
  LOST: "Lost",
  HIDDEN: "Hidden",
};

export function StatusPill({
  status,
  dwell,
  label,
  onClick,
  as = "button",
  disabled,
  ariaLabel,
  title,
  className,
  style,
}: StatusPillProps) {
  const baseLabel = label ?? STATUS_LABEL[status];
  const computedAria =
    ariaLabel ??
    (typeof baseLabel === "string"
      ? `Lead status ${baseLabel}${dwell != null ? ` ${String(dwell)}` : ""}`
      : undefined);

  const content = (
    <>
      <span>{baseLabel}</span>
      {dwell != null ? (
        <span style={{ opacity: 0.7, marginLeft: 4 }} aria-hidden="true">
          · {dwell}
        </span>
      ) : null}
    </>
  );

  if (as === "span") {
    return (
      <span
        className={cn("statpill", `st-${status}`, className)}
        data-status={status}
        aria-label={computedAria}
        title={title}
        style={style}
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
      className={cn("statpill", `st-${status}`, className)}
      data-status={status}
      aria-label={computedAria}
      title={title}
      style={{ opacity: disabled ? 0.6 : undefined, ...style }}
    >
      {content}
    </button>
  );
}
