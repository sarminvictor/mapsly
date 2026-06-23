/**
 * Copy lint · enforce exposure framing, ban legal absolutes
 *
 * The product promise is "NEVER an unverified accusation". Detector
 * explanations describe POTENTIAL EXPOSURE worth checking — never a
 * conclusion of law. This module is the mechanical guard: any explanation that
 * asserts a definitive violation throws at construction time so the bad string
 * never ships.
 *
 * We say:    "potential patient-privacy exposure worth checking"
 * We forbid: "is violating", "violates the law", "illegal", "non-compliant",
 *            "guilty", "breaks the law"
 *
 * See:
 *   - .claude/rules/copy-voice.md — voice + banned words
 *   - modules/playbooks/signals/* — every emitted explanation is linted here
 */

/**
 * Banned absolute phrases (case-insensitive). Each is a definitive accusation
 * we are never permitted to make from automated signals. Word boundaries keep
 * "illegal" from matching inside benign words.
 */
export const BANNED_ABSOLUTE_PATTERNS: readonly RegExp[] = [
  /\bis violating\b/i,
  /\bviolates the law\b/i,
  /\billegal\b/i,
  /\bnon[\s-]?compliant\b/i,
  /\bguilty\b/i,
  /\bbreaks the law\b/i,
];

/** Error thrown when copy contains a banned legal absolute. */
export class ExposurePhrasingError extends Error {
  constructor(
    public readonly matched: string,
    text: string,
  ) {
    super(
      `Exposure-phrasing violation: copy contains banned absolute ` +
        `"${matched}". Detector copy must be exposure-framed, never a ` +
        `definitive legal accusation. Offending text: ${JSON.stringify(text)}`,
    );
    this.name = "ExposurePhrasingError";
  }
}

/**
 * Throw if `text` contains any banned legal absolute. Returns the text
 * unchanged on success so it can be used inline:
 *
 *   explanation: assertExposurePhrasing(`Potential ADA exposure worth ...`)
 */
export function assertExposurePhrasing(text: string): string {
  for (const pattern of BANNED_ABSOLUTE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      throw new ExposurePhrasingError(match[0], text);
    }
  }
  return text;
}
