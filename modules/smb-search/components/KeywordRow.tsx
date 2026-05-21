import * as React from "react";

/**
 * KeywordRow · single row in the SMB search-visibility table.
 *
 * Renders one tracked keyword's plain-English visibility status, the
 * week-over-week delta (↑ improved, ↓ slipped, → flat, • new), and the
 * keyword's estimated monthly search volume. Maria-facing, so the row
 * never says "3-pack" / "SERP" / "MSI" — the visibility status string
 * is i18n-resolved by the page from one of the `status_*` keys.
 *
 * Server-component-safe — no hooks, no event handlers, pure props in.
 * Renders at mobile (380px) and desktop without overflow. Per
 * `.claude/rules/accessibility.md`, the delta arrow is purely decorative
 * and the screen reader gets the spoken delta via the aria-label on
 * the row's delta cell.
 */

/**
 * Plain-English visibility status. Resolved on the page from i18n
 * messages — keep these enum values stable; they map 1:1 to message
 * keys `smb.search.status_*`.
 */
export type VisibilityStatus =
  /** Shown in the local-pack (top 3 in Google Maps). */
  | "in_local_pack"
  /** Ranked in organic top 10 but not in local pack. */
  | "top_organic"
  /** Ranked organic 11+. */
  | "ranking_organic"
  /** Not ranked anywhere yet. */
  | "not_ranked";

export type DeltaDirection =
  /** Better than last week (smaller rank number). */
  | "improved"
  /** Worse than last week. */
  | "slipped"
  /** Same as last week. */
  | "flat"
  /** First scan or newly appearing this week. */
  | "new";

export interface KeywordRowDisplayProps {
  /** The keyword being tracked. */
  keyword: string;
  /** Visibility status — resolved to plain-English text by the page. */
  statusText: string;
  /** Bucket the status falls into, used to colour the status tone. */
  status: VisibilityStatus;
  /** Week-over-week delta direction. `null` when there's no prior
   * scan to compare against (first week of tracking). */
  delta: DeltaDirection | null;
  /** Pre-formatted delta text (e.g. "Up 2 spots" / "First scan"). */
  deltaText: string;
  /** Pre-formatted searches-per-month (e.g. "2.4K / mo" or "—"). */
  searchVolumeText: string;
  /** Accessible label for the volume cell (e.g. "2400 searches per month"). */
  searchVolumeAriaLabel: string;
}

function statusColor(status: VisibilityStatus): string {
  switch (status) {
    case "in_local_pack":
      return "var(--color-success)";
    case "top_organic":
      return "var(--color-gold)";
    case "ranking_organic":
      return "var(--color-text-2)";
    case "not_ranked":
    default:
      return "var(--color-text-3)";
  }
}

function deltaGlyph(delta: DeltaDirection | null): string {
  if (delta === "improved") return "↑";
  if (delta === "slipped") return "↓";
  if (delta === "flat") return "→";
  if (delta === "new") return "•";
  return "";
}

function deltaColor(delta: DeltaDirection | null): string {
  if (delta === "improved") return "var(--color-success)";
  if (delta === "slipped") return "var(--color-alert)";
  if (delta === "new") return "var(--color-coral)";
  return "var(--color-text-3)";
}

export function KeywordRow({
  keyword,
  statusText,
  status,
  delta,
  deltaText,
  searchVolumeText,
  searchVolumeAriaLabel,
}: KeywordRowDisplayProps) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        listStyle: "none",
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 15,
          color: "var(--color-text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {keyword}
      </span>
      <span
        aria-label={statusText}
        style={{
          flexShrink: 0,
          minWidth: 0,
          fontSize: 13,
          color: statusColor(status),
          fontWeight: 500,
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {statusText}
      </span>
      <span
        aria-label={deltaText}
        style={{
          width: 88,
          flexShrink: 0,
          textAlign: "right",
          fontSize: 13,
          color: deltaColor(delta),
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {delta != null ? (
          <span aria-hidden style={{ marginRight: 4 }}>
            {deltaGlyph(delta)}
          </span>
        ) : null}
        {deltaText}
      </span>
      <span
        aria-label={searchVolumeAriaLabel}
        style={{
          width: 72,
          flexShrink: 0,
          textAlign: "right",
          fontSize: 13,
          color: "var(--color-text-2)",
          fontVariantNumeric: "tabular-nums",
          fontFamily: "var(--font-mono)",
        }}
      >
        {searchVolumeText}
      </span>
    </li>
  );
}
