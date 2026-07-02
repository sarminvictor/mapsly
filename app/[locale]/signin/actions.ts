"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import { trackProductEvent } from "@/lib/analytics/product-events";

export type SignInState = {
  error?: "invalid_email" | "send_failed";
} | null;

// RFC-5322 simplified email check — good enough as a first-line filter
// before NextAuth/Resend does the authoritative validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return { error: "invalid_email" };
  }

  // Carry a landing-driven checkout intent through the magic-link round-trip.
  // `redirectTo` is baked into the email URL, so after the click /post-signin
  // sees `?intent=smb&landing=<token>` and starts the $29 checkout. Validated +
  // bounded so nothing arbitrary rides along.
  const intent = formData.get("intent");
  const landing = formData.get("landing");
  const audience = formData.get("audience");
  const invite = formData.get("invite");
  let redirectTo = "/post-signin";
  if (
    intent === "smb" &&
    typeof landing === "string" &&
    /^[1-9][0-9]{15}$/.test(landing)
  ) {
    redirectTo = `/post-signin?intent=smb&landing=${landing}`;
  } else if (typeof invite === "string" && /^[a-f0-9]{48}$/.test(invite)) {
    // WP5-8 · seat invite from a team email. Format-validated (48-hex token
    // minted by inviteMemberAction) so nothing arbitrary rides the redirect.
    // /post-signin resolves the token, enforces the seat cap, and seats the
    // user on the INVITING agency (skipping WP2-1 self-provision).
    redirectTo = `/post-signin?invite=${invite}`;
  } else if (audience === "agency") {
    // WP2-1 · agency intent from the /for-agencies CTAs. Exact-match validated
    // (a literal, never interpolated), so nothing arbitrary rides the
    // redirect. The SMB checkout intent above wins if both are somehow
    // present — a paid landing click is the stronger signal.
    redirectTo = "/post-signin?audience=agency";
  }

  // WP6-4 · signup — the top of the activation funnel. Fired here (before the
  // NEXT_REDIRECT throw) when the request carries agency intent (the CTA the
  // agency funnel measures), so it can't be missed on the throw path. It's a
  // magic-link REQUEST, not a confirmed account — agency_created (WP2-1) is the
  // downstream "account exists" checkpoint. No PII: the email domain only, as a
  // coarse cohort signal (ids/counts rule — a full address never lands).
  if (audience === "agency") {
    void trackProductEvent({
      type: "signup",
      props: { audience: "agency", emailDomain: email.split("@")[1] ?? null },
    });
  }

  try {
    // NextAuth v5 server-action `signIn` for an email provider has TWO
    // distinct redirects:
    //   1. On form submit: the action sends the magic-link email and
    //      throws NEXT_REDIRECT to `pages.verifyRequest`
    //      (= /signin/check-email). The user sees the waiting screen.
    //   2. On magic-link click: /api/auth/callback/resend verifies the
    //      token, mints the session cookie, and redirects to the
    //      `redirectTo` value that was baked into the email URL.
    //
    // So `redirectTo` MUST be the POST-signin destination, not the
    // check-email waiting page — else the user bounces straight back
    // to the waiting screen after clicking the magic link, without
    // ever landing in a signed-in state.
    //
    // We send everyone to /post-signin which does role-based routing
    // (ADMIN/SMB → /home, agency member → /lists).
    await signIn("resend", {
      email,
      redirectTo,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // Resend send failure, configuration error, etc.
      return { error: "send_failed" };
    }
    // NEXT_REDIRECT control-flow throws MUST propagate.
    throw err;
  }

  return null;
}
