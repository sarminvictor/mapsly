/**
 * SMB · service-context chip · the always-visible "lens" affordance.
 *
 * Renders at the top of every analysis page (Reviews · Search · Ads ·
 * Website · Home) so Maria sees WHICH of her services drove this report
 * and can correct the list with one click.
 *
 * Per the SMB portal restructure v0.8.x:
 *
 *   - Services aren't a setting — they're the lens. This chip makes the
 *     lens explicit.
 *   - Click anywhere on the chip → deep-link to /my-business so the
 *     edit affordance is one tap away from every analysis page.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Warm tone — "Reading this for…", not "Filter applied".
 *   - Plain English. No "services context" jargon shown to Maria.
 *   - Mobile-first — wraps cleanly at 380px.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - The whole chip is a link (`<Link>`) so keyboard users tab to it.
 *   - Visible focus ring inherited from globals.css.
 *
 * Per `.claude/rules/cache-components.md` Pattern 4b:
 *   - No function props cross the server→client boundary. The wrapper
 *     pre-resolves the overflow label (which needs a count value) so
 *     this presentational chip only ever receives plain strings.
 *
 * Server-renderable (no client hooks).
 */

import type { CSSProperties } from "react";

import { Link } from "@/i18n/navigation";

export interface ServiceContextChipLabels {
  /** "Reading this for" — fixed lead-in copy. */
  prefix: string;
  /** "No services yet — add some" — used when the list is empty. */
  empty: string;
  /** "Manage in My business" — visible edit affordance text. */
  manage: string;
}

export interface ServiceContextChipProps {
  /** Service names to display inline · already truncated by the caller. */
  visibleServices: string[];
  /** Full count, used for the aria-label (read-aloud experience). */
  totalCount: number;
  /**
   * Pre-resolved overflow string (e.g. "+2 more"). Pass `null` when
   * there's nothing to overflow — the chip skips the overflow pill.
   * Resolving lives in the caller because it needs the i18n `{count}`
   * value, which the chip can't pass cleanly across the server boundary
   * (Pattern 4b).
   */
  overflowLabel: string | null;
  labels: ServiceContextChipLabels;
}

export function ServiceContextChip({
  visibleServices,
  totalCount,
  overflowLabel,
  labels,
}: ServiceContextChipProps) {
  const isEmpty = totalCount === 0;

  return (
    <Link
      href="/my-business"
      style={chipContainerStyle()}
      aria-label={
        isEmpty
          ? labels.empty
          : `${labels.prefix} ${visibleServices.join(", ")} · ${labels.manage}`
      }
    >
      <span style={prefixStyle()}>{labels.prefix}</span>

      {isEmpty ? (
        <span style={emptyStyle()}>{labels.empty}</span>
      ) : (
        <span style={listStyle()}>
          {visibleServices.map((name, idx) => (
            <span key={`${name}-${idx}`} style={servicePillStyle()}>
              {name}
            </span>
          ))}
          {overflowLabel ? (
            <span style={overflowPillStyle()}>{overflowLabel}</span>
          ) : null}
        </span>
      )}

      <span style={manageStyle()} aria-hidden>
        {labels.manage}
        <span style={{ marginLeft: 4 }}>→</span>
      </span>
    </Link>
  );
}

function chipContainerStyle(): CSSProperties {
  return {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px 12px",
    padding: "10px 14px",
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
    color: "var(--color-text)",
    textDecoration: "none",
    fontSize: 13,
    lineHeight: 1.4,
  };
}

function prefixStyle(): CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--color-text-3)",
    whiteSpace: "nowrap",
  };
}

function listStyle(): CSSProperties {
  return {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    flex: "1 1 auto",
    minWidth: 0,
  };
}

function servicePillStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 500,
    background: "var(--color-bg)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  };
}

function overflowPillStyle(): CSSProperties {
  return {
    ...servicePillStyle(),
    color: "var(--color-text-2)",
    background: "var(--color-bg-3)",
  };
}

function emptyStyle(): CSSProperties {
  return {
    color: "var(--color-coral)",
    fontWeight: 500,
    flex: "1 1 auto",
    minWidth: 0,
  };
}

function manageStyle(): CSSProperties {
  return {
    color: "var(--color-coral)",
    fontWeight: 500,
    fontSize: 13,
    whiteSpace: "nowrap",
  };
}
