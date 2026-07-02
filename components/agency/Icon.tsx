/**
 * Agency stroke-SVG icon set (WP4-12).
 *
 * A tiny, dependency-free icon component that replaces the emoji / text
 * glyphs that were scattered across the agency portal chrome (⛛ ▤ 🔎 🎓 ✉️
 * 📌 🕒 ⚠️ ✅ …). Per `.claude/rules/copy-voice.md`, no emoji in chrome —
 * emoji render at inconsistent optical weights across platforms and read as
 * SMB-warm, not Tom-tool-y. These are 16px stroke SVGs at a uniform
 * 1.6 stroke-width, matching the two icons already in the prototype
 * (docs/portal-prototype.html:7659-7699 — the Filters funnel + Coverage
 * layers), extended to the rest of the chrome vocabulary in the same style.
 *
 * Decorative by default (`aria-hidden`) — the surrounding button/label
 * already carries the accessible name. Pass `title` only when the icon
 * stands alone with no text label (rare in this portal).
 *
 * `'use client'` is NOT required — this renders pure SVG with no state; it
 * can be used from server or client components.
 */

import type { CSSProperties } from "react";

export type IconName =
  | "search"
  | "filter"
  | "coverage"
  | "expert"
  | "mail"
  | "phone"
  | "link"
  | "pin"
  | "clock"
  | "warning"
  | "check"
  | "star"
  | "chevron-down"
  | "arrow-up"
  | "arrow-down";

export interface IconProps {
  name: IconName;
  /** Square size in px. Default 16 (the chrome standard). */
  size?: number;
  /** Extra class on the <svg> (e.g. to reuse `.si` positioning). */
  className?: string;
  style?: CSSProperties;
  /**
   * When the icon is the ONLY content of its control (no adjacent text
   * label), pass an accessible label. Omit for decorative use next to text.
   */
  title?: string;
}

/**
 * Path data per icon — all drawn in a 16×16 box, stroke-only (fill:none),
 * so `currentColor` + stroke-width carry the styling from the parent.
 * `filter` and `coverage` are the exact prototype paths; the rest match
 * their optical weight (1.6 stroke, round caps/joins).
 */
const PATHS: Record<IconName, string> = {
  // prototype funnel (docs/portal-prototype.html:7674)
  filter: "M2 4h12L9.5 9v4l-3 1.5V9z",
  // prototype 3-layer stack (docs/portal-prototype.html:7695-7699)
  coverage: "M2 4.5 8 2l6 2.5L8 7z M2 8l6 2.5L14 8 M2 11.5 8 14l6-2.5",
  // magnifier
  search: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.4 10.4 14 14",
  // mortarboard (expert findings)
  expert: "M1.5 5.5 8 3l6.5 2.5L8 8z M4 7v3.2c0 .9 1.8 1.8 4 1.8s4-.9 4-1.8V7",
  // envelope
  mail: "M2 4h12v8H2z M2 4.5 8 9l6-4.5",
  // handset
  phone:
    "M3 3.2c-.4 0-.8.3-.9.7C1.8 6.6 3 9 4.8 10.9 6.6 12.7 9 13.9 11.7 13.5c.4 0 .7-.4.7-.8v-1.9c0-.4-.3-.7-.7-.8l-1.8-.4c-.3-.1-.7 0-.9.3l-.5.6C7 9.6 5.9 8.5 5.1 7.1l.6-.5c.3-.2.4-.6.3-.9L5.6 3.9c-.1-.4-.4-.7-.8-.7z",
  // chain link
  link: "M6.5 9.5 9.5 6.5 M5.5 8 4 9.5a2.1 2.1 0 0 0 3 3L8.5 11 M10.5 8 12 6.5a2.1 2.1 0 0 0-3-3L7.5 5",
  // map pin
  pin: "M8 1.8c-2.2 0-4 1.7-4 3.9 0 2.9 4 8 4 8s4-5.1 4-8c0-2.2-1.8-3.9-4-3.9z M8 4.4a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z",
  // clock
  clock: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z M8 4.8V8l2.3 1.4",
  // triangle warning
  warning: "M8 2 15 14H1z M8 6.5v3.2 M8 11.6h.01",
  // check
  check: "M3 8.5 6.5 12 13 4.5",
  // star (outline)
  star: "M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6 4.3 13.6l.7-4.3-3.1-3 4.3-.6z",
  // chevron
  "chevron-down": "M4 6l4 4 4-4",
  "arrow-up": "M8 12.5V3.5 M4.5 7 8 3.5 11.5 7",
  "arrow-down": "M8 3.5v9 M4.5 9 8 12.5 11.5 9",
};

export function Icon({ name, size = 16, className, style, title }: IconProps) {
  const decorative = title == null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={title}
    >
      {title != null ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
