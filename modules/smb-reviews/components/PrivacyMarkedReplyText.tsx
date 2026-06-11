// modules/smb-reviews/components/PrivacyMarkedReplyText.tsx
//
// S5/S6 · Renders a published owner reply with privacy-flagged ranges
// visibly marked inline, so Maria sees exactly what to edit right
// inside the reply, instead of hunting for it from a tooltip quote.
//
// Two tiers of mark (2026-06 production feedback — every mark carried a
// 2px underline, so a reply with several flagged sentences read as an
// unreadable picket fence):
//
//   - PRECISE (range ≤ PRECISE_MARK_MAX_CHARS) · light coral wash +
//     coral underline. These are the short phrase hits ("Botox",
//     "your visit") — the useful pointers.
//   - BROAD (longer ranges · AI sentences / coalesced spans) · the SAME
//     wash, NO underline. A flagged sentence reads as a calm tinted
//     block, not a fence of underlines.
//
// Adjacent ranges separated only by whitespace / light punctuation
// (gap ≤ 3 chars of [\s,.;:·—-]) coalesce into ONE span — neighbouring
// phrase hits become a continuous mark instead of broken fragments.
//
// Saturation collapse: when more than SATURATION_THRESHOLD of the
// reply's characters sit inside marks, inline marking is noise — the
// component renders the reply WITHOUT marks. The parent (ReviewCard's
// OwnerReply) detects the same condition via the exported pure
// `computePrivacyMarkLayout` and swaps the hint line to the stronger
// "replace this reply" message. Pure-function seam (no callback during
// render): both sides derive the verdict from the same inputs, so they
// can never disagree.
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

/** Ranges at or under this length render the PRECISE tier (wash +
 *  underline). Longer ranges — AI sentences and coalesced spans —
 *  render wash-only so they read as a tinted block, not a fence. */
export const PRECISE_MARK_MAX_CHARS = 40;

/** Marked-character coverage above which inline marks collapse
 *  entirely — at that point the marks are noise, and the hint line
 *  (ReviewCard) escalates to the "replace this reply" message. */
export const SATURATION_THRESHOLD = 0.55;

/** Max gap (in chars) bridged when coalescing adjacent ranges. */
const COALESCE_MAX_GAP = 3;

/** A gap merges only when EVERY char is whitespace / light
 *  punctuation — never across words. */
const COALESCE_GAP = /^[\s,.;:·—-]*$/;

/** One final marked range over the original text (slice indices). */
export interface PrivacyMarkRange {
  start: number;
  end: number;
}

/** Pure layout verdict shared by the component and ReviewCard. */
export interface PrivacyMarkLayout {
  /** Non-overlapping, coalesced ranges in text order. Empty when no
   *  phrase locates cleanly. */
  ranges: PrivacyMarkRange[];
  /** Fraction (0–1) of the reply's characters inside `ranges`. */
  coverage: number;
  /** True when coverage exceeds SATURATION_THRESHOLD — render the
   *  reply without inline marks and escalate the hint line instead. */
  saturated: boolean;
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

/**
 * Locate, merge, and coalesce every flagged phrase into final marked
 * ranges, plus the coverage / saturation verdict. Pure — ReviewCard
 * calls this to decide the hint-line copy; the component calls it to
 * render. Same inputs, same verdict, no drift.
 */
export function computePrivacyMarkLayout(
  text: string,
  phrases: string[],
): PrivacyMarkLayout {
  const haystack = normalize(text).toLowerCase();

  // Locate the first occurrence of each distinct phrase.
  const ranges: PrivacyMarkRange[] = [];
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
    return { ranges: [], coverage: 0, saturated: false };
  }

  // Merge overlapping ranges so marks never nest or collide.
  ranges.sort((a, b) => a.start - b.start);
  const merged: PrivacyMarkRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  // Coalesce neighbours separated only by a tiny whitespace /
  // punctuation gap ("Botox, Dysport") into one continuous span — the
  // gap chars are pulled INSIDE the mark, so reconstruction (plain +
  // marked slices rejoin byte-for-byte) is preserved.
  const coalesced: PrivacyMarkRange[] = [];
  for (const r of merged) {
    const last = coalesced[coalesced.length - 1];
    if (last) {
      const gap = text.slice(last.end, r.start);
      if (gap.length <= COALESCE_MAX_GAP && COALESCE_GAP.test(gap)) {
        last.end = r.end;
        continue;
      }
    }
    coalesced.push({ ...r });
  }

  const markedChars = coalesced.reduce((n, r) => n + (r.end - r.start), 0);
  const coverage = text.length > 0 ? markedChars / text.length : 0;
  return {
    ranges: coalesced,
    coverage,
    saturated: coverage > SATURATION_THRESHOLD,
  };
}

// Light coral wash · same accent family as the card's urgent state and
// the privacy hint line. Browsers default <mark> to yellow — override
// explicitly. BROAD ranges get exactly this — a calm tinted block.
const broadMarkStyle: React.CSSProperties = {
  background: "rgba(195, 85, 58, 0.14)",
  color: "inherit",
  borderRadius: 3,
  padding: "0 1px",
};

// PRECISE ranges (short phrase hits) add the coral underline — the
// pointer that says "this exact phrase".
const preciseMarkStyle: React.CSSProperties = {
  ...broadMarkStyle,
  textDecorationLine: "underline",
  textDecorationColor: "var(--color-coral)",
  textDecorationThickness: 2,
  textUnderlineOffset: 2,
};

export function PrivacyMarkedReplyText({
  text,
  phrases,
  markTitle,
}: PrivacyMarkedReplyTextProps) {
  const layout = computePrivacyMarkLayout(text, phrases);

  // No locatable phrase → plain text. Saturated → plain text too: when
  // most of the reply is flagged, inline marks are noise; the hint line
  // (ReviewCard, via the same pure layout) carries the message instead.
  if (layout.ranges.length === 0 || layout.saturated) {
    return <>{text}</>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  layout.ranges.forEach((r, i) => {
    if (r.start > cursor) {
      parts.push(
        <React.Fragment key={`plain-${i}`}>
          {text.slice(cursor, r.start)}
        </React.Fragment>,
      );
    }
    const precise = r.end - r.start <= PRECISE_MARK_MAX_CHARS;
    parts.push(
      <mark
        key={`mark-${i}`}
        title={markTitle}
        style={precise ? preciseMarkStyle : broadMarkStyle}
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
