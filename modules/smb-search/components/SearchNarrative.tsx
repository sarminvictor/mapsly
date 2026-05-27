// Server component · one-line plain-English narrative that opens the
// /(smb)/search page above the State Bar. Per `.claude/rules/ui-ux-smb.md`
// — Maria wants "what's happening", not bare numbers. The narrative
// stitches together the headline outcomes she cares about into a single
// sentence so the page reads like a check-in, not a dashboard dump.
//
// Pure presentation · all numbers + copy resolved server-side.

import * as React from "react";

export interface SearchNarrativeProps {
  /** Pre-resolved sentence · the page composes this from the i18n
   *  `state_narrative` template + the numbers, then passes it down so
   *  this component stays free of `t()` (server-component-safe per
   *  Pattern 4b). */
  sentence: string;
}

export function SearchNarrative({ sentence }: SearchNarrativeProps) {
  return (
    <section
      aria-label="Search visibility summary"
      style={{
        marginBottom: 20,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontSize: 19,
          lineHeight: 1.4,
          letterSpacing: "-0.01em",
          color: "var(--color-text)",
        }}
      >
        {sentence}
      </p>
    </section>
  );
}
