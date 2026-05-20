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
    // NextAuth v5 server-action `signIn`. On success it throws a
    // NEXT_REDIRECT to `redirectTo` (after the magic-link click) and
    // immediately to `pages.verifyRequest` (which we set to
    // /signin/check-email). We append the email as a query param so
    // the check-email page can show "we sent a link to {email}".
    await signIn("resend", {
      email,
      redirectTo: `/signin/check-email?email=${encodeURIComponent(email)}`,
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
