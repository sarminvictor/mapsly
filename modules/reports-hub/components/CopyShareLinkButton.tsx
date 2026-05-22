"use client";

/**
 * CopyShareLinkButton · client island for copying a `/share/{id}`
 * URL to the clipboard from the agency reports hub.
 *
 * Tom screen-shares the share link in a sales conversation; the
 * fastest path from the hub is "copy → paste". This island wraps
 * `navigator.clipboard.writeText` with a 2s "Copied" affordance.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - `aria-live="polite"` on the status text so screen readers
 *     announce the "Copied" state without stealing focus.
 *   - The button always remains focusable and the keyboard
 *     activation path matches the click path.
 *
 * Per `.claude/rules/conventions.md` this is a leaf client component.
 * The page imports it and renders one per row when the row is a
 * SHARE_LINK type.
 */

import * as React from "react";

export interface CopyShareLinkButtonLabels {
  copy: string;
  copied: string;
  failed: string;
  /** Aria label for the button (includes the share id for context). */
  ariaLabel: (shareId: string) => string;
}

export interface CopyShareLinkButtonProps {
  url: string;
  shareId: string;
  labels: CopyShareLinkButtonLabels;
}

type State = "idle" | "copied" | "error";

export function CopyShareLinkButton({
  url,
  shareId,
  labels,
}: CopyShareLinkButtonProps) {
  const [state, setState] = React.useState<State>("idle");

  const handleClick = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("error");
    }
  }, [url]);

  // Reset back to idle after 2 seconds — wrapped in an effect so the
  // timer is properly cleaned up on unmount + re-click. Uses an
  // empty-array hash on `state` to restart the timer per state change.
  React.useEffect(() => {
    if (state === "idle") return;
    const tid = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(tid);
  }, [state]);

  const text =
    state === "copied"
      ? labels.copied
      : state === "error"
        ? labels.failed
        : labels.copy;

  const tone =
    state === "copied"
      ? "var(--color-agency-teal)"
      : state === "error"
        ? "var(--color-alert)"
        : "var(--color-agency-indigo)";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={labels.ariaLabel(shareId)}
      data-testid={`reports-copy-share-${shareId}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 6,
        background: "transparent",
        border: `1px solid ${tone}`,
        color: tone,
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      <span aria-live="polite">{text}</span>
    </button>
  );
}
