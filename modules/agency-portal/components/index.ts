/**
 * Agency portal · audience-specific component library.
 *
 * Built on top of `components/ui` primitives (Button, Card, Pill, Modal).
 * These are Tom-facing components — cool gray + indigo palette, dense,
 * scan-friendly. Do not use in SMB routes; use the
 * `modules/smb-home/components` library instead.
 *
 * See `.claude/rules/ui-ux-agency.md` for voice and density conventions and
 * `_design/agency/list-detail.html` + `_design/agency/search.html` for
 * the original visual reference.
 *
 * F.0 ships the foundation primitives used across hunter, lists, list-
 * detail, and prospect routes:
 *
 *   - StatusPill · interactive lead status indicator (NEW → ... → HIDDEN)
 *   - FilterRow · Hunter filter editor row (label + comparator + value)
 *   - BulkActionBar · sticky multi-select action bar
 *   - LeadsTable + LeadsTableHeader/Body/Row/Cell · dense table primitives
 *   - LeadRow · composed lead-table row (avatar + signals + status + contact)
 *   - BusinessCell · canonical "{avatar} {name + meta}" cell
 *   - SignalChip · single chip inside "Why qualified" cell
 *   - SignalChipGroup · wraps multiple chips
 *
 * Follow-ups (later phases):
 *   - FilterGroup · collapsible accordion wrapping FilterRows (F.2 Hunter UI)
 *   - LiveCountBar · sticky preview "47 matches · 42 verified" (F.2)
 *   - ServiceTemplateStrip · per-service starter filter strip (F.2)
 */

export { StatusPill } from "./StatusPill";
export type { StatusPillProps, LeadStatusValue } from "./StatusPill";

export { FilterRow } from "./FilterRow";
export type {
  FilterRowProps,
  FilterRowKind,
  FilterComparator,
} from "./FilterRow";

export { BulkActionBar } from "./BulkActionBar";
export type { BulkActionBarProps } from "./BulkActionBar";

export {
  LeadsTable,
  LeadsTableHeader,
  LeadsTableHeaderCell,
  LeadsTableBody,
  LeadsTableRow,
  LeadsTableCell,
  BusinessCell,
  SignalChip,
  SignalChipGroup,
} from "./LeadsTable";
export type {
  LeadsTableProps,
  LeadsTableHeaderCellProps,
  LeadsTableRowProps,
  LeadsTableCellProps,
  BusinessCellProps,
  SignalChipProps,
  SignalChipTone,
  TableDensity,
  SortDirection,
  ColumnAlign,
} from "./LeadsTable";

export { LeadRow } from "./LeadRow";
export type { LeadRowProps, LeadRowSignal } from "./LeadRow";
