// modules/smb-reviews/components/HighlightedReviewText.tsx
//
// R.6 · Renders review text with mentioned names + services highlighted.
//
// Builds a regex from the union of mentionedPeople + mentionedServices
// (escaped + sorted by length DESC so "Dr. Smith" wins over "Smith"),
// splits the review text by match, wraps matches in <strong>.
//
// Per security.md, we render only text — no dangerouslySetInnerHTML, no
// HTML in user input. React escapes by default.

import * as React from "react";

interface Props {
  text: string;
  people: string[];
  services: string[];
  /** Color for name highlights · defaults to coral. */
  nameColor?: string;
  /** Color for service highlights · defaults to berry. */
  serviceColor?: string;
}

export function HighlightedReviewText({
  text,
  people,
  services,
  nameColor = "var(--color-coral)",
  serviceColor = "var(--color-berry)",
}: Props) {
  if (people.length === 0 && services.length === 0) {
    return <>{text}</>;
  }

  // Build patterns. People + services in one regex; classify each match
  // by which set it belongs to for color selection.
  const peopleSet = new Set(people.map((p) => p.toLowerCase()));
  const serviceSet = new Set(services.map((s) => s.toLowerCase()));
  const all = Array.from(new Set([...people, ...services]))
    .filter((s) => s.length > 1)
    .sort((a, b) => b.length - a.length);

  if (all.length === 0) {
    return <>{text}</>;
  }

  // Word-boundary regex (case-insensitive). For multi-word service
  // names (e.g. "Lip filler"), \b boundaries still work on the start/end.
  const pattern = new RegExp(`\\b(${all.map(escapeRegex).join("|")})\\b`, "gi");
  const parts: Array<{
    text: string;
    kind: "match" | "plain";
    color?: string;
  }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, m.index), kind: "plain" });
    }
    const matched = m[0];
    const lower = matched.toLowerCase();
    const color = peopleSet.has(lower)
      ? nameColor
      : serviceSet.has(lower)
        ? serviceColor
        : undefined;
    parts.push({ text: matched, kind: "match", color });
    lastIndex = m.index + matched.length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), kind: "plain" });
  }

  return (
    <>
      {parts.map((p, i) =>
        p.kind === "match" ? (
          <strong
            key={i}
            style={{
              color: p.color ?? "inherit",
              fontWeight: 600,
            }}
          >
            {p.text}
          </strong>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
