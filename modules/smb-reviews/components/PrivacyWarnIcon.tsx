import * as React from "react";

/**
 * PrivacyWarnIcon · the coral warning triangle shared by the Privacy
 * tab (`ReviewTabs`) and the privacy summary card
 * (`PrivacySummaryCard`). Single source so the two surfaces can never
 * drift to different glyphs.
 *
 * Decorative — always `aria-hidden`. Per `.claude/rules/accessibility.md`
 * the adjacent label text + count badge carry the meaning, never color
 * (or an icon) alone.
 */
export function PrivacyWarnIcon({
  size = 13,
  style,
}: {
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      style={{ flexShrink: 0, color: "var(--color-coral)", ...style }}
    >
      <path
        fill="currentColor"
        d="M8 1.4 15.4 14.2H.6L8 1.4Zm0 4.1c-.45 0-.8.38-.77.83l.2 2.9a.57.57 0 0 0 1.14 0l.2-2.9A.78.78 0 0 0 8 5.5Zm0 6.9a.85.85 0 1 0 0-1.7.85.85 0 0 0 0 1.7Z"
      />
    </svg>
  );
}
