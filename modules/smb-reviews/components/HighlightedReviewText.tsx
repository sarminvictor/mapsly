// modules/smb-reviews/components/HighlightedReviewText.tsx
//
// R.6 · Renders review text with mentioned names + services highlighted.
//
// Names: literal-match against `people` array (AI returns the exact form
// the reviewer used).
//
// Services: canonical names in `services` (e.g. "Dermal fillers") rarely
// appear verbatim in reviews — customers say "filler" / "lip filler" /
// "fillers". So we expand each canonical service to its known synonyms
// via SERVICE_SYNONYMS_MED_SPA before building the regex. Med-spa is the
// only vertical today; broader synonym maps land when more verticals
// come online.
//
// Per security.md, we render only text — no dangerouslySetInnerHTML, no
// HTML in user input. React escapes by default.

import * as React from "react";

/** Synonyms grouped by canonical service name from BusinessService.
 *  Add new entries as Maria's catalog expands. All matching is
 *  case-insensitive at the regex level. Order within each array
 *  doesn't matter — longest wins via sort below. */
const SERVICE_SYNONYMS_MED_SPA: Record<string, readonly string[]> = {
  "Dermal fillers": [
    "dermal fillers",
    "dermal filler",
    "lip filler",
    "lip fillers",
    "cheek filler",
    "filler",
    "fillers",
    "juvederm",
    "restylane",
  ],
  Botox: ["botox", "botulinum", "dysport", "xeomin", "tox"],
  Microneedling: [
    "microneedling",
    "micro needling",
    "micro-needling",
    "skinpen",
    "skin pen",
  ],
  "Laser hair removal": ["laser hair removal", "laser hair", "lhr"],
  CoolSculpting: [
    "coolsculpting",
    "cool sculpting",
    "fat freezing",
    "cryolipolysis",
  ],
  // Generic catch-alls when canonical name isn't in the map · the
  // canonical itself is the only term to highlight.
};

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

  // Expand services through the synonym map · lowercase + dedupe so
  // matching is fast.
  const peopleLower = new Set(people.map((p) => p.toLowerCase()));
  const serviceTermsLower = new Set<string>();
  for (const canonical of services) {
    const syns = SERVICE_SYNONYMS_MED_SPA[canonical] ??
      // Unknown canonical · highlight the literal name only.
      [canonical];
    for (const s of syns) serviceTermsLower.add(s.toLowerCase());
  }

  const allTerms = Array.from(
    new Set<string>([
      ...Array.from(peopleLower),
      ...Array.from(serviceTermsLower),
    ]),
  )
    .filter((s) => s.length > 1)
    .sort((a, b) => b.length - a.length);

  if (allTerms.length === 0) {
    return <>{text}</>;
  }

  const pattern = new RegExp(
    `\\b(${allTerms.map(escapeRegex).join("|")})\\b`,
    "gi",
  );

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
    const color = peopleLower.has(lower)
      ? nameColor
      : serviceTermsLower.has(lower)
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
