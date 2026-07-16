// Pure decision logic for Google account-linking — the gate behind
// `allowDangerousEmailAccountLinking: true` in lib/auth.ts.
//
// Dangerous linking merges a Google sign-in into any existing User with the
// same email. That is safe ONLY when the existing row has proven mailbox
// ownership. Two of our three providers guarantee that (magic link = inbox
// click, which sets `emailVerified`; Google = OIDC email_verified). The third
// does NOT: the stripe-checkout provider mints a User from the PAYER-TYPED
// email with `emailVerified` null — an attacker can pre-seed a victim's
// address by paying for a checkout. Without this gate, the victim's later
// Google sign-in would silently link into (and legitimize) that
// attacker-created account (security review 2026-07-15, High).
//
// Kept as a pure function (no Prisma, no Auth.js types) so the auth gate has
// pass AND fail unit tests per .claude/rules/testing.md.

/** What the signIn callback looked up about the pre-existing user, if any. */
export interface GoogleLinkCandidate {
  /** `User.emailVerified` — set by the magic-link flow, null on stripe-seeded rows. */
  emailVerified: Date | null;
  /** Whether a `google` Account row is already linked (normal repeat login). */
  hasGoogleAccount: boolean;
}

export type GoogleLinkDecision = "allow" | "deny" | "verify_email_first";

export function googleLinkDecision(
  /** Google's OIDC `email_verified` claim — must be asserted true. */
  emailVerifiedByGoogle: boolean,
  /** The existing User matched by email, or null for a fresh signup. */
  existing: GoogleLinkCandidate | null,
): GoogleLinkDecision {
  if (!emailVerifiedByGoogle) return "deny";
  // Fresh signup — the adapter creates the user; nothing to hijack.
  if (!existing) return "allow";
  // Already linked to Google — this is a normal repeat login.
  if (existing.hasGoogleAccount) return "allow";
  // Mailbox ownership proven via magic link — safe to merge channels.
  if (existing.emailVerified) return "allow";
  // Unverified pre-existing row (stripe-checkout seed): refuse the silent
  // link. The user proves the mailbox via magic link first; Google links
  // cleanly on their next attempt.
  return "verify_email_first";
}
