/**
 * Agency reports hub components · barrel export.
 *
 * `ReportsTable` is server-component-safe. `CopyShareLinkButton` is a
 * client island used by the table's action cell when the row is a
 * SHARE_LINK type.
 */

export { ReportsTable } from "./ReportsTable";
export type { ReportsTableProps, ReportsTableLabels } from "./ReportsTable";

export { CopyShareLinkButton } from "./CopyShareLinkButton";
export type {
  CopyShareLinkButtonProps,
  CopyShareLinkButtonLabels,
} from "./CopyShareLinkButton";
