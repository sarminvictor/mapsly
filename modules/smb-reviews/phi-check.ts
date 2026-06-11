/**
 * PHI risk detector for owner review replies · S2/S3 privacy check.
 *
 * PURE + CLIENT-SAFE. No prisma, no server-only imports — this module is
 * imported by BOTH the server query (`queries.ts`, to flag already
 * published replies) and client components (`ReplyActions`, to run the
 * pre-publish warning on the draft text at post-click). Keep it that way.
 *
 * WHY: US regulators have fined medical practices $10k–$50k for public
 * Google-review replies that confirmed the reviewer was a patient or
 * discussed their treatment. Real flagged examples from a test clinic:
 *
 *   - "Besides the standard consent and release the only mention is to
 *      allow us any follow up required…"  → patient-status ("any follow
 *      up required") · confirms a care relationship in public.
 *   - "Since 2016 we have refrained to offered 1/4 syringe… You wanted
 *      any left over in your face…"       → treatment ("syringe") ·
 *      discusses the reviewer's procedure in public.
 *
 * Detection is curated word-boundary regexes, case-insensitive, over a
 * lightly normalized string (curly apostrophes → straight). Four match
 * kinds:
 *
 *   - `patient-status`  — phrases that confirm (or deny) a specific
 *                          person was a patient / visited
 *   - `treatment`       — generic medical-procedure vocabulary + the
 *                          business's own service names (passed in)
 *   - `visit-or-date`   — concrete visit/date references
 *   - `payment`         — dollar amounts, refunds, deposits
 *
 * Level: `high` when any patient-status OR treatment match (the two
 * patterns regulators actually fine); `caution` otherwise. `level` is
 * only meaningful when `flagged === true`.
 *
 * Bias: tuned against FALSE POSITIVES — generic warm replies ("thank
 * you for the kind words", "we're glad you had a great experience",
 * "please call our office") must NOT flag. Plain "treatment(s)" is
 * deliberately absent ("we offer many treatments" reveals nothing about
 * the reviewer); only "treatment plan" matches. English-only vocabulary
 * for now — see the caveat in the module tests.
 *
 * Whether the detector runs at all is gated UPSTREAM by
 * `isHumanMedicalCategory` (services/ai/medical-category.ts) — the same
 * matcher that flips the PHI guardrail on AI drafts, so the published
 * -reply check, the draft guardrail, and the HIPAA badge never drift.
 */

export type PhiRiskLevel = "high" | "caution";

export type PhiMatchKind =
  | "patient-status"
  | "treatment"
  | "visit-or-date"
  | "payment";

export interface PhiMatch {
  kind: PhiMatchKind;
  /** Short verbatim snippet around the matched phrase (with `…` when
   *  trimmed). Locale-neutral — it quotes the owner's own reply. */
  excerpt: string;
}

export interface PhiRiskResult {
  flagged: boolean;
  /** Meaningful only when `flagged` — defaults to `caution` otherwise. */
  level: PhiRiskLevel;
  matches: PhiMatch[];
}

/** Cap so a worst-case rant doesn't build an unbounded match list. */
const MAX_MATCHES = 8;

/** Context window (chars each side) for the excerpt snippet. */
const EXCERPT_PAD = 24;

// ---------------------------------------------------------------------------
// Curated patterns · all case-insensitive, word-boundary anchored.
// Matching runs on a normalized string (curly quotes → straight) so
// "weren’t" and "weren't" both hit.
// ---------------------------------------------------------------------------

const PATIENT_STATUS_PATTERNS: readonly RegExp[] = [
  /\bcoming in\b/i,
  /\byour visit\b/i,
  /\byour appointment\b/i,
  /\bhaving you as a (?:patient|client)\b/i,
  // "you were a patient" / "you weren't a patient" / "you were never a
  // patient" / "you are not a patient" — confirming AND denying both
  // reveal whether a specific person had a care relationship.
  /\byou (?:were(?:n't| not| never)?|are(?:n't| not)?) (?:a |our |ever a )?patient\b/i,
  /\bno record of you(?:r visit)?\b/i,
  /\byour consent\b/i,
  // "follow up with us" / "any follow up" / "follow up required" — covers
  // the real flagged example ("allow us any follow up required").
  /\b(?:any )?follow[ -]?up (?:with us|required|appointment)\b/i,
  /\bfollow[ -]?up with us\b/i,
  /\byour results\b/i,
  /\byour recovery\b/i,
];

// Generic medical-procedure vocabulary. Plain "treatment(s)" is
// intentionally absent (too generic to reveal anything about the
// reviewer); "treatment plan" is specific enough to flag.
const TREATMENT_PATTERNS: readonly RegExp[] = [
  /\bbotox\b/i,
  /\bfillers?\b/i,
  /\bsyringes?\b/i,
  /\binjections?\b/i,
  /\blasers?\b/i,
  /\bunits\b/i,
  /\bprescriptions?\b/i,
  /\bprocedures?\b/i,
  /\bsurger(?:y|ies)\b/i,
  /\btreatment plans?\b/i,
];

const MONTH =
  "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)";

const VISIT_OR_DATE_PATTERNS: readonly RegExp[] = [
  // "on March 12" / "on Mar 12th" — a concrete visit date in a public
  // reply pins the reviewer to a day they were at the practice.
  new RegExp(`\\bon ${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?\\b`, "i"),
  /\blast (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bsince your visit\b/i,
];

const PAYMENT_PATTERNS: readonly RegExp[] = [
  // "$50" / "$1,200.00" — dollar amounts in a public reply.
  /\$\s?\d[\d,]*(?:\.\d{1,2})?/,
  /\brefund(?:ed|s)?\b/i,
  /\byou paid\b/i,
  /\bdeposits?\b/i,
];

/** Escape a service name for safe embedding inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build word-boundary regexes for the business's own service names
 * ("Lip filler", "HydraFacial"). Names shorter than 3 chars are skipped
 * — too noisy ("IV" would hit "Ivy" without heavier tokenizing).
 */
function serviceNamePatterns(serviceNames: readonly string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const raw of serviceNames) {
    const name = (raw ?? "").trim();
    if (name.length < 3) continue;
    out.push(new RegExp(`\\b${escapeRegExp(name)}\\b`, "i"));
  }
  return out;
}

/** Snippet around a match, ellipsized when trimmed mid-text. */
function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - EXCERPT_PAD);
  const end = Math.min(text.length, index + length + EXCERPT_PAD);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Scan `text` (an owner reply — published or draft) for phrases that
 * could reveal a patient relationship, treatment, visit, or payment in
 * public. Pure + synchronous — safe to call at post-click in the client.
 */
export function detectPhiRisk(
  text: string,
  opts?: { serviceNames?: string[] },
): PhiRiskResult {
  const normalized = (text ?? "").replace(/[‘’]/g, "'");
  if (!normalized.trim()) {
    return { flagged: false, level: "caution", matches: [] };
  }

  const matches: PhiMatch[] = [];
  const seen = new Set<string>();

  const scan = (patterns: readonly RegExp[], kind: PhiMatchKind): void => {
    for (const re of patterns) {
      if (matches.length >= MAX_MATCHES) return;
      const m = re.exec(normalized);
      if (!m || !m[0]) continue;
      const excerpt = excerptAround(normalized, m.index, m[0].length);
      const key = `${kind}:${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ kind, excerpt });
    }
  };

  scan(PATIENT_STATUS_PATTERNS, "patient-status");
  scan(
    [...TREATMENT_PATTERNS, ...serviceNamePatterns(opts?.serviceNames ?? [])],
    "treatment",
  );
  scan(VISIT_OR_DATE_PATTERNS, "visit-or-date");
  scan(PAYMENT_PATTERNS, "payment");

  const hasHigh = matches.some(
    (m) => m.kind === "patient-status" || m.kind === "treatment",
  );

  return {
    flagged: matches.length > 0,
    level: hasHigh ? "high" : "caution",
    matches,
  };
}

/**
 * Server-side helper for `getSmbReviewsData` · runs the detector over a
 * batch of published replies and returns only the flagged ones, keyed by
 * review id. `hint` is the first match's excerpt (shown as the tooltip
 * on the per-review hint line). Pure — unit-tested alongside the
 * detector; the query just maps Prisma rows into `{ id, text }`.
 */
export interface ReplyRiskEntry {
  level: PhiRiskLevel;
  /** Verbatim excerpt from the reply that triggered the flag. */
  hint: string;
}

export function summarizeReplyRisks(
  replies: ReadonlyArray<{ id: string; text: string | null }>,
  opts?: { serviceNames?: string[] },
): Map<string, ReplyRiskEntry> {
  const out = new Map<string, ReplyRiskEntry>();
  for (const reply of replies) {
    if (!reply.text) continue;
    const risk = detectPhiRisk(reply.text, opts);
    if (!risk.flagged) continue;
    out.set(reply.id, {
      level: risk.level,
      hint: risk.matches[0]?.excerpt ?? "",
    });
  }
  return out;
}
