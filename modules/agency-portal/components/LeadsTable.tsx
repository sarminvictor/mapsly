import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * LeadsTable · dense table primitive for the agency portal.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Tables are first-class · sticky headers · sortable columns
 *   - Density toggle (`density="comfortable" | "compact"`)
 *   - Row hover highlights · row click should open detail (caller wires)
 *   - Status pills clickable (composed by caller, see StatusPill)
 *   - Bulk-select via leading checkbox column (consumes BulkActionBar)
 *
 * Composition (not a self-rendering table for any shape — caller controls):
 *
 *   <LeadsTable density="compact">
 *     <LeadsTableHeader>
 *       <LeadsTableRow as="tr">
 *         <LeadsTableHeaderCell select />
 *         <LeadsTableHeaderCell>Business</LeadsTableHeaderCell>
 *         <LeadsTableHeaderCell sortable sorted="desc">Match</LeadsTableHeaderCell>
 *         <LeadsTableHeaderCell align="right">Actions</LeadsTableHeaderCell>
 *       </LeadsTableRow>
 *     </LeadsTableHeader>
 *     <LeadsTableBody>
 *       {leads.map(l => (
 *         <LeadsTableRow key={l.id}>
 *           <LeadsTableCell select><Checkbox /></LeadsTableCell>
 *           <LeadsTableCell>{...}</LeadsTableCell>
 *           ...
 *         </LeadsTableRow>
 *       ))}
 *     </LeadsTableBody>
 *   </LeadsTable>
 *
 * Server-component-safe at every level (composition is plain DOM elements,
 * no hooks, no state). Caller wraps in `'use client'` for selection state.
 *
 * Performance note: this primitive does NOT virtualize. For >100 rows wrap
 * the body in `@tanstack/react-virtual` per `.claude/rules/data-fetching.md`.
 */

export type TableDensity = "comfortable" | "compact";
export type SortDirection = "asc" | "desc" | "none";
export type ColumnAlign = "left" | "right" | "center";

/* ----------------------------------------------------------------- root */

export interface LeadsTableProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: TableDensity;
  /** Optional caption for screen readers · "Qualified leads · 47 rows". */
  caption?: React.ReactNode;
}

export function LeadsTable({
  density = "comfortable",
  caption,
  children,
  className,
  style,
  ...rest
}: LeadsTableProps) {
  return (
    <div
      className={cn("mapsly-leads-table", className)}
      data-density={density}
      data-audience="agency"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        overflow: "hidden",
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
            fontFamily: "var(--font-sans)",
            fontSize: density === "compact" ? 12.5 : 13.5,
          }}
        >
          {caption != null ? (
            <caption
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0,0,0,0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            >
              {caption}
            </caption>
          ) : null}
          {children}
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- header */

export function LeadsTableHeader({
  children,
}: {
  children?: React.ReactNode;
}) {
  return (
    <thead
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        background: "var(--color-bg-3)",
      }}
    >
      {children}
    </thead>
  );
}

export interface LeadsTableHeaderCellProps
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Mark this column as the row-select cell · narrow width + center align. */
  select?: boolean;
  /** Sortable column · renders a small "▲/▼/⇅" affordance. */
  sortable?: boolean;
  /** Current sort direction (when sortable). */
  sorted?: SortDirection;
  /** Click handler to toggle sort. */
  onSortToggle?: () => void;
  /** Column alignment. Default "left", "right" for action columns. */
  align?: ColumnAlign;
  /** Explicit width hint (px or string). */
  width?: number | string;
}

export function LeadsTableHeaderCell({
  select,
  sortable,
  sorted = "none",
  onSortToggle,
  align = "left",
  width,
  children,
  className,
  style,
  ...rest
}: LeadsTableHeaderCellProps) {
  const sortGlyph =
    !sortable ? null : sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "⇅";

  return (
    <th
      scope="col"
      aria-sort={
        sortable
          ? sorted === "asc"
            ? "ascending"
            : sorted === "desc"
              ? "descending"
              : "none"
          : undefined
      }
      className={cn("mapsly-leads-th", className)}
      style={{
        padding: select ? "10px 8px 10px 14px" : "10px 14px",
        textAlign: align,
        width: select ? 32 : width,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--color-text-3)",
        borderBottom: "1px solid var(--color-border)",
        whiteSpace: "nowrap",
        cursor: sortable && onSortToggle ? "pointer" : "default",
        userSelect: "none",
        ...style,
      }}
      onClick={sortable && onSortToggle ? onSortToggle : undefined}
      {...rest}
    >
      {children}
      {sortGlyph != null ? (
        <span
          aria-hidden="true"
          style={{
            marginLeft: 6,
            fontSize: 9,
            color: sorted === "none" ? "var(--color-text-3)" : "var(--color-agency-indigo)",
          }}
        >
          {sortGlyph}
        </span>
      ) : null}
    </th>
  );
}

/* ----------------------------------------------------------------- body */

export function LeadsTableBody({
  children,
}: {
  children?: React.ReactNode;
}) {
  return <tbody>{children}</tbody>;
}

/* ----------------------------------------------------------------- row */

export interface LeadsTableRowProps
  extends React.HTMLAttributes<HTMLTableRowElement> {
  /** When true, paints the row with a subtle "selected" tint. */
  selected?: boolean;
  /** When true, renders the trailing "Open →" affordance as a real button. */
  interactive?: boolean;
}

export function LeadsTableRow({
  selected,
  interactive,
  children,
  className,
  style,
  ...rest
}: LeadsTableRowProps) {
  return (
    <tr
      className={cn("mapsly-leads-row", className)}
      data-selected={selected ? "true" : undefined}
      data-interactive={interactive ? "true" : undefined}
      style={{
        background: selected ? "rgba(91,61,245,.06)" : "transparent",
        cursor: interactive ? "pointer" : "default",
        transition: "background 120ms ease",
        ...style,
      }}
      {...rest}
    >
      {children}
    </tr>
  );
}

/* ---------------------------------------------------------------- cell */

export interface LeadsTableCellProps
  extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Mark this cell as the row-select cell (narrow + checkbox container). */
  select?: boolean;
  /** Cell alignment. Default "left". */
  align?: ColumnAlign;
  /** Suppress vertical padding (for nested layout cells). */
  flush?: boolean;
}

export function LeadsTableCell({
  select,
  align = "left",
  flush,
  children,
  className,
  style,
  ...rest
}: LeadsTableCellProps) {
  return (
    <td
      className={cn("mapsly-leads-cell", className)}
      style={{
        padding: flush
          ? "0 14px"
          : select
            ? "12px 8px 12px 14px"
            : "12px 14px",
        textAlign: align,
        verticalAlign: "middle",
        borderBottom: "1px solid var(--color-border)",
        color: "var(--color-text)",
        whiteSpace: align === "right" ? "nowrap" : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------- business cell */

export interface BusinessCellProps {
  /** Display name. */
  name: React.ReactNode;
  /** Secondary mono line · "5 yrs · 4.4★ · 342 reviews · added 3d ago". */
  meta?: React.ReactNode;
  /** Optional 1–2 letter avatar (computed by caller). */
  avatar?: React.ReactNode;
  /** Avatar background gradient · pick from a stable hash to keep colors. */
  avatarTone?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  className?: string;
  style?: React.CSSProperties;
}

const AVATAR_GRADIENTS: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, string> = {
  1: "linear-gradient(135deg, var(--color-agency-indigo), var(--color-agency-indigo-2))",
  2: "linear-gradient(135deg, var(--color-agency-teal), #075e7a)",
  3: "linear-gradient(135deg, var(--color-success), #1e6644)",
  4: "linear-gradient(135deg, var(--color-gold), #92590a)",
  5: "linear-gradient(135deg, var(--color-coral), var(--color-berry))",
  6: "linear-gradient(135deg, var(--color-alert), #841a1a)",
  7: "linear-gradient(135deg, #1c1d24, #54586a)",
};

/**
 * BusinessCell · the canonical "{avatar} {name + meta}" cell. Reused inside
 * any LeadsTableCell rendering a business identifier. Keeps avatar tone
 * consistent across pages by deriving from a stable hash (caller-supplied).
 */
export function BusinessCell({
  name,
  meta,
  avatar,
  avatarTone = 1,
  className,
  style,
}: BusinessCellProps) {
  return (
    <div
      className={cn("mapsly-business-cell", className)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 0,
        ...style,
      }}
    >
      {avatar != null ? (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            background: AVATAR_GRADIENTS[avatarTone],
            color: "#ffffff",
            fontWeight: 800,
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {avatar}
        </span>
      ) : null}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        {meta != null ? (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-3)",
              fontFamily: "var(--font-mono)",
              marginTop: 3,
              lineHeight: 1.45,
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- signal chips */

export type SignalChipTone = "neutral" | "warn" | "alert" | "teal";

export interface SignalChipProps {
  tone?: SignalChipTone;
  children?: React.ReactNode;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

const CHIP_TONE: Record<SignalChipTone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--color-bg-3)", fg: "var(--color-text-2)" },
  warn: { bg: "rgba(212,165,116,.20)", fg: "var(--color-berry)" },
  alert: { bg: "rgba(181,61,71,.14)", fg: "var(--color-alert)" },
  teal: { bg: "rgba(8,145,178,.14)", fg: "var(--color-agency-teal)" },
};

/**
 * SignalChip · single "Perf 58" / "LCP 3.4s" / "no schema" chip inside the
 * "Why qualified" cell. Composable inside any LeadsTableCell.
 */
export function SignalChip({
  tone = "neutral",
  children,
  title,
  className,
  style,
}: SignalChipProps) {
  const t = CHIP_TONE[tone];
  return (
    <span
      className={cn("mapsly-signal-chip", className)}
      data-tone={tone}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        padding: "2.5px 7px",
        borderRadius: 4,
        background: t.bg,
        color: t.fg,
        fontWeight: 600,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * SignalChipGroup · wraps a flex-row of SignalChips inside the "Why
 * qualified" cell. Caps the max width so the column stays readable.
 */
export function SignalChipGroup({
  children,
  maxWidth = 300,
  className,
  style,
}: {
  children?: React.ReactNode;
  maxWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("mapsly-signal-chip-group", className)}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        maxWidth,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
