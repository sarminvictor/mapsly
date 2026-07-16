import { describe, expect, test } from "vitest";

import { googleLinkDecision } from "../google-link-gate";

// The invariant behind allowDangerousEmailAccountLinking (lib/auth.ts):
// Google may silently merge into an existing account ONLY when that account
// has proven mailbox ownership. A stripe-checkout-seeded user (emailVerified
// null, no Google account) must be refused — security review 2026-07-15.
describe("googleLinkDecision", () => {
  test("fresh signup (no existing user) is allowed", () => {
    expect(googleLinkDecision(true, null)).toBe("allow");
  });

  test("repeat login on an already-linked Google account is allowed", () => {
    expect(
      googleLinkDecision(true, {
        emailVerified: null,
        hasGoogleAccount: true,
      }),
    ).toBe("allow");
  });

  test("magic-link-verified user may link Google", () => {
    expect(
      googleLinkDecision(true, {
        emailVerified: new Date("2026-01-01"),
        hasGoogleAccount: false,
      }),
    ).toBe("allow");
  });

  test("REFUSES linking onto an unverified pre-existing user (stripe seed)", () => {
    expect(
      googleLinkDecision(true, {
        emailVerified: null,
        hasGoogleAccount: false,
      }),
    ).toBe("verify_email_first");
  });

  test("denies outright when Google does not assert email_verified", () => {
    expect(googleLinkDecision(false, null)).toBe("deny");
    expect(
      googleLinkDecision(false, {
        emailVerified: new Date("2026-01-01"),
        hasGoogleAccount: true,
      }),
    ).toBe("deny");
  });
});
