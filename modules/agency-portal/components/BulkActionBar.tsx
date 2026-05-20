import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * BulkActionBar · sticky bottom bar shown when ≥1 leads are selected.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Dark surface with white text · pops above the leads table
 *   - "{N} selected" lead + mono meta line + N action buttons trailing
 *   - Sticky to viewport bottom · margin from the table is the caller's
 *     responsibility (wrap in a relative container)
 *
 * Per `.claude/rules/accessibility.md`:
 *   - Renders as a real `<aside role="region">` with aria-label so screen
 *     readers can locate it after a multi-select gesture
 *   - aria-live="polite" announces the new selection count
 *
 * Server-component-safe in the default render (no hooks, no listeners).
 * Caller passes the action buttons as children — they handle their own
 * `onClick` via client-component wrappers.
 *
 * Design intent: this is the ONLY component in the agency library that
 * lives on `position: sticky` to bottom of viewport. The dark surface is
 * intentional · agency density preference says "be loud about bulk power".
 */

export interface BulkActionBarProps {
  /** Number of selected rows. When 0, the component renders nothing. */
  selectedCount: number;
  /** Optional accessible label for the region · default "Bulk actions". */
  regionLabel?: string;
  /** Optional context line · rendered after the selected count, mono small. */
  meta?: React.ReactNode;
  /** Action buttons · rendered at the trailing edge of the bar. */
  children?: React.ReactNode;
  /** Force-hide even when selectedCount > 0 (e.g. during loading). */
  hidden?: boolean;
  /** Override the sticky offset from viewport bottom. Default 20px. */
  stickyBottom?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function BulkActionBar({
  selectedCount,
  regionLabel = "Bulk actions",
  meta,
  children,
  hidden,
  stickyBottom = 20,
  className,
  style,
}: BulkActionBarProps) {
  // Render nothing when nothing's selected — saves layout space & aria noise.
  if (hidden || selectedCount <= 0) return null;

  const noun = selectedCount === 1 ? "lead" : "leads";

  return (
    <aside
      role="region"
      aria-label={regionLabel}
      aria-live="polite"
      aria-atomic="true"
      className={cn("mapsly-bulk-action-bar", className)}
      data-audience="agency"
      data-selected-count={selectedCount}
      style={{
        position: "sticky",
        bottom: stickyBottom,
        marginTop: 18,
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--color-text)",
        color: "#ffffff",
        padding: "14px 22px",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(20,22,32,0.18)",
        fontSize: 13,
        fontFamily: "var(--font-sans)",
        zIndex: 50,
        ...style,
      }}
    >
      <strong style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
        {selectedCount} {noun} selected
      </strong>
      {meta != null ? (
        <span
          style={{
            opacity: 0.7,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            whiteSpace: "nowrap",
          }}
        >
          {meta}
        </span>
      ) : null}
      <span
        style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        {children}
      </span>
    </aside>
  );
}
