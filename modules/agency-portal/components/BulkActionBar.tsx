import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * BulkActionBar · sticky bar shown when ≥1 rows are selected.
 *
 * VISUAL · renders the ported prototype `.bulkbar` markup (defined in
 * `agency-portal.css`): a `.cnt` count lead, an optional `.lk` link
 * (select-all-filtered), a `.spacer`, and trailing `.bb` action buttons the
 * caller supplies as children. The design-system class carries the look.
 *
 * Per `.claude/rules/ui-ux-agency.md`: bulk actions are mandatory on every
 * agency table; the bar is loud about bulk power.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - Renders as a real `<div role="region">` with aria-label so screen
 *     readers can locate it after a multi-select gesture
 *   - aria-live="polite" announces the new selection count
 *
 * Server-component-safe in the default render (no hooks). Caller passes the
 * action buttons as children — they handle their own `onClick` via client
 * wrappers.
 */

export interface BulkActionBarProps {
  /** Number of selected rows. When 0, the component renders nothing. */
  selectedCount: number;
  /** Accessible label for the region · default "Bulk actions". */
  regionLabel?: string;
  /** Noun for the count line · default "selected" (rendered as "N selected"). */
  countLabel?: (count: number) => string;
  /** Optional "select all N filtered" link rendered before the spacer. */
  selectAll?: { label: string; onClick: () => void } | null;
  /** Action buttons · rendered at the trailing edge of the bar. */
  children?: React.ReactNode;
  /** Force-hide even when selectedCount > 0 (e.g. during loading). */
  hidden?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function BulkActionBar({
  selectedCount,
  regionLabel = "Bulk actions",
  countLabel,
  selectAll,
  children,
  hidden,
  className,
  style,
}: BulkActionBarProps) {
  // Render nothing when nothing's selected — saves layout space & aria noise.
  if (hidden || selectedCount <= 0) return null;

  const text = countLabel
    ? countLabel(selectedCount)
    : `${selectedCount} selected`;

  return (
    <div
      role="region"
      aria-label={regionLabel}
      aria-live="polite"
      aria-atomic="true"
      className={cn("bulkbar", className)}
      data-selected-count={selectedCount}
      style={style}
    >
      <span className="cnt">{text}</span>
      {selectAll ? (
        <button type="button" className="lk" onClick={selectAll.onClick}>
          {selectAll.label}
        </button>
      ) : null}
      <span className="spacer" />
      {children}
    </div>
  );
}
