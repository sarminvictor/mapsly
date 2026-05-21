"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";

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
    // (ADMIN/SMB → /dashboard, agency member → /lists).
    await signIn("resend", {
      email,
      redirectTo: "/post-signin",
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
