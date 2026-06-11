// modules/smb-reviews/components/PrivacyMarkedReplyText.tsx
//
// S5 · Renders a published owner reply with every privacy-flagged
// PHRASE visibly marked inline — light coral background + coral
// underline — so Maria sees the EXACT phrases to edit, right inside the
// reply, instead of hunting for them from a tooltip quote.
//
// Marks the BARE matched phrase (`PhiMatch.phrase`), never the padded
// `excerpt`. Production screenshots showed excerpt-marking starting and
// ending mid-word ("r|efrained to offered 1/4 sy|ringe") and covering
// innocuous connective words (", and opted") — the excerpt is a context
// window, not the risky text. Phrases come from word-boundary-anchored
// regexes, so marks always begin/end at word boundaries. The excerpt
// remains available upstream for tooltips (the hint line's `title`).
//
// Sibling of `HighlightedReviewText` (the R.6 name/service highlighter):
// same safe text-splitting approach, but matching is plain `indexOf`
// over a normalized copy instead of a regex. Why:
//
//   - The phrases come from `detectPhiRisk` (phi-check.ts) VERBATIM —
//     they may contain regex metacharacters ("$50"). indexOf needs no
//     escaping, so weird phrases are inherently safe.
//   - `detectPhiRisk` normalizes curly apostrophes to straight ones
//     before matching, so its phrases carry straight apostrophes while
//     the original reply may use curly ones. We apply the SAME
//     normalization here (1 char → 1 char, indices map 1:1) and slice
//     the ORIGINAL text for rendering — the curly form is preserved.
//   - Leading/trailing "…" are still stripped defensively — a stale
//     cached payload (minutes window post-deploy) could hand us an
//     old padded excerpt; it degrades to its old behavior, never throws.
//
// First occurrence per phrase is marked; overlapping / duplicate
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
  /** Bare matched phrases from `detectPhiRisk` (`PhiMatch.phrase`) —
   *  the exact risky text, no context padding. */
  phrases: string[];
  /** Plain-English explanation reused from the privacy hint copy —
   *  surfaced via `title` on each mark. */
  markTitle?: string;
}

/** Same normalization as `detectPhiRisk` · curly apostrophes →
 *  straight. 1:1 char replacement so indices map onto the original. */
function normalize(s: string): string {
  return s.replace(/[‘’]/g, "'");
}

const WORD_CHAR = /[A-Za-z0-9]/;

/**
 * First occurrence of `needle` in `haystack` that sits on word
 * boundaries — a hit whose word-char edge touches a word char in the
 * haystack is skipped ("toxin" inside "toxins", "dose" inside
 * "overdosed"). The detector matched at a word boundary; the mark must
 * land on the SAME kind of position, not an earlier substring of a
 * larger word. Needles with non-word edges ("$50") accept any
 * neighbour on that side. Returns -1 when no clean occurrence exists.
 */
function indexOfWordAligned(haystack: string, needle: string): number {
  let start = haystack.indexOf(needle);
  while (start !== -1) {
    const end = start + needle.length;
    const startsMidWord =
      start > 0 &&
      WORD_CHAR.test(haystack.charAt(start - 1)) &&
      WORD_CHAR.test(needle.charAt(0));
    const endsMidWord =
      end < haystack.length &&
      WORD_CHAR.test(needle.slice(-1)) &&
      WORD_CHAR.test(haystack.charAt(end));
    if (!startsMidWord && !endsMidWord) return start;
    start = haystack.indexOf(needle, start + 1);
  }
  return -1;
}

export function PrivacyMarkedReplyText({
  text,
  phrases,
  markTitle,
}: PrivacyMarkedReplyTextProps) {
  const haystack = normalize(text).toLowerCase();

  // Locate the first occurrence of each distinct phrase.
  const ranges: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();
  for (const raw of phrases) {
    const needle = normalize(raw ?? "")
      .replace(/^…+/, "")
      .replace(/…+$/, "")
      .trim()
      .toLowerCase();
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    // Word-aligned search, not bare indexOf — a phrase that is also a
    // substring of an EARLIER larger word ("toxin" in "toxins") must
    // mark its own boundary-clean occurrence, never split that word.
    const start = indexOfWordAligned(haystack, needle);
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
