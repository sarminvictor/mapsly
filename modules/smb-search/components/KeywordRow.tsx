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

/** One slot of the local-pack 3-slot view rendered inside the row. */
export interface KeywordRowSlot {
  rank: 1 | 2 | 3;
  name: string;
  kind: "you" | "competitor" | "empty";
}

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
  /** 3-slot local-pack view. */
  packSlots: KeywordRowSlot[];
  /** Heading copy for the pack-slot block (e.g. "Top 3 in maps"). */
  packLabel: string;
  /** Pre-formatted "+N patients/mo missed" text. Empty string hides it. */
  estPatientsLostText: string;
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
  packSlots,
  packLabel,
  estPatientsLostText,
}: KeywordRowDisplayProps) {
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        listStyle: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
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
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-3)",
            flexShrink: 0,
          }}
        >
          {packLabel}
        </span>
        <ol
          aria-label={packLabel}
          style={{
            display: "flex",
            gap: 6,
            margin: 0,
            padding: 0,
            listStyle: "none",
            flexWrap: "wrap",
          }}
        >
          {packSlots.map((slot) => (
            <li key={slot.rank}>
              <span
                title={slot.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  ...slotStyle(slot.kind),
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    opacity: 0.7,
                  }}
                >
                  #{slot.rank}
                </span>
                {slot.name}
              </span>
            </li>
          ))}
        </ol>
        {estPatientsLostText ? (
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-coral)",
              fontWeight: 600,
            }}
          >
            {estPatientsLostText}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function slotStyle(kind: KeywordRowSlot["kind"]): React.CSSProperties {
  switch (kind) {
    case "you":
      return {
        background: "var(--color-coral)",
        color: "#fff",
        fontWeight: 600,
      };
    case "competitor":
      return {
        background: "var(--color-bg-3)",
        color: "var(--color-text-2)",
      };
    case "empty":
    default:
      return {
        background: "transparent",
        color: "var(--color-text-3)",
        border: "1px dashed var(--color-border)",
      };
  }
}
