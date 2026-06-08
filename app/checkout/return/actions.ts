"use server";

// Post-payment auto-login. Submitted (auto) by /checkout/return after Stripe
// redirects the paid browser back with its checkout `session_id`. Signs the
// prospect in via the "stripe-checkout" Credentials provider, which re-validates
// the session against Stripe (so the id can't be forged) and find-or-creates
// the User + claims the Business. On success → /home; on failure → magic-link.

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth";

export async function completeCheckoutLogin(formData: FormData): Promise<void> {
  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId.startsWith("cs_")) redirect("/signin?intent=smb");

  // Browser-binding nonce set by /api/checkout/start — proves this login comes
  // from the browser that started checkout (defeats session_id replay).
  const cookieStore = await cookies();
  const nonce = cookieStore.get("mapsly_checkout_nonce")?.value ?? "";

  try {
    await signIn("stripe-checkout", {
      stripeSessionId: sessionId,
      nonce,
      redirectTo: "/home",
    });
  } catch (error) {
    // signIn() throws a NEXT_REDIRECT on SUCCESS — re-throw it so Next routes
    // the user to /home. Only a genuine AuthError (bad/expired session) falls
    // back to the magic-link sign-in.
    if (error instanceof AuthError) {
      redirect("/signin?intent=smb&error=checkout");
    }
    throw error;
  }
}
