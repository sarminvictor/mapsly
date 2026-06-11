// modules/smb-reviews/components/PrivacyMarkedReplyText.tsx
//
// S5 · Renders a published owner reply with every privacy-flagged
// excerpt visibly marked inline — light coral background + coral
// underline — so Maria sees the EXACT phrases to edit, right inside the
// reply, instead of hunting for them from a tooltip quote.
//
// Sibling of `HighlightedReviewText` (the R.6 name/service highlighter):
// same safe text-splitting approach, but matching is plain `indexOf`
// over a normalized copy instead of a regex. Why:
//
//   - The excerpts come from `detectPhiRisk` (phi-check.ts) VERBATIM —
//     they may contain regex metacharacters ("$50 (deposit)"). indexOf
//     needs no escaping, so weird excerpts are inherently safe.
//   - `detectPhiRisk` normalizes curly apostrophes to straight ones
//     before matching, so its excerpts carry straight apostrophes while
//     the original reply may use curly ones. We apply the SAME
//     normalization here (1 char → 1 char, indices map 1:1) and slice
//     the ORIGINAL text for rendering — the curly form is preserved.
//   - Excerpts are ellipsized ("…") when trimmed mid-text; the ellipses
//     are stripped before matching.
//
// First occurrence per excerpt is marked; overlapping / duplicate
// ranges are merged so nested <mark>s can never render. Per
// `.claude/rules/security.md`: text-only rendering, React escapes
// everything — no dangerouslySetInnerHTML.
//
// Accessibility (`.claude/rules/accessibility.md`): the mark styling is
// NEVER the only signal — the visible privacy hint line under the reply
// (ReviewCard) carries the same meaning for touch, keyboard, and screen
// readers. `title` on each mark adds the explanation on hover as a
// bonus, mirroring the module's existing lightweight tooltip pattern.

import * as React from "react";

export interface PrivacyMarkedReplyTextProps {
  /** The published owner reply, rendered verbatim. */
  text: string;
  /** Verbatim excerpts from `detectPhiRisk` (may carry leading /
   *  trailing `…` from the excerpt window). */
  excerpts: string[];
  /** Plain-English explanation reused from the privacy hint copy —
   *  surfaced via `title` on each mark. */
  markTitle?: string;
}

/** Same normalization as `detectPhiRisk` · curly apostrophes →
 *  straight. 1:1 char replacement so indices map onto the original. */
function normalize(s: string): string {
  return s.replace(/[‘’]/g, "'");
}

export function PrivacyMarkedReplyText({
  text,
  excerpts,
  markTitle,
}: PrivacyMarkedReplyTextProps) {
  const haystack = normalize(text).toLowerCase();

  // Locate the first occurrence of each distinct excerpt.
  const ranges: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();
  for (const raw of excerpts) {
    const needle = normalize(raw ?? "")
      .replace(/^…+/, "")
      .replace(/…+$/, "")
      .trim()
      .toLowerCase();
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    const start = haystack.indexOf(needle);
    if (start === -1) continue;
    ranges.push({ start, end: start + needle.length });
  }

  if (ranges.length === 0) {
    return <>{text}</>;
  }

  // Merge overlapping ranges so marks never nest or collide.
  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach((r, i) => {
    if (r.start > cursor) {
      parts.push(
        <React.Fragment key={`plain-${i}`}>
          {text.slice(cursor, r.start)}
        </React.Fragment>,
      );
    }
    parts.push(
      <mark
        key={`mark-${i}`}
        title={markTitle}
        style={{
          // Light coral wash + coral underline · same accent family as
          // the card's urgent state and the privacy hint line. Browsers
          // default <mark> to yellow — override explicitly.
          background: "rgba(195, 85, 58, 0.14)",
          color: "inherit",
          borderRadius: 3,
          padding: "0 1px",
          textDecorationLine: "underline",
          textDecorationColor: "var(--color-coral)",
          textDecorationThickness: 2,
          textUnderlineOffset: 2,
        }}
      >
        {text.slice(r.start, r.end)}
      </mark>,
    );
    cursor = r.end;
  });
  if (cursor < text.length) {
    parts.push(
      <React.Fragment key="plain-tail">{text.slice(cursor)}</React.Fragment>,
    );
  }

  return <>{parts}</>;
}
