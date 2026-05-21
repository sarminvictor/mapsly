"use server";

// Server actions for the billing settings pages.
//
// `openBillingPortal` creates a Stripe Customer Portal session bound to the
// authenticated user's (or their agency's) Stripe customer and redirects
// the browser there. This is the canonical "manage subscription" path —
// Stripe hosts the UI for updating card, downloading invoices, cancelling.
//
// Per `.claude/rules/security.md`:
//   - Auth check at the top (NextAuth v5 `auth()`).
//   - Zod validates the form-submitted `returnUrl`.
//   - All Stripe interaction goes through the lazy-proxied client (INC-07).
//
// Per `.claude/rules/data-fetching.md`:
//   - Server actions, not API routes — invoked via `<form action={...}>`.
//   - `redirect()` from `next/navigation` short-circuits the response.
//
// Note: `next/navigation` `redirect()` throws a special error that Next
// catches and turns into an HTTP 303. Caller never sees a return value.

import { z } from "zod";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { createPortalSession, PortalError } from "./portal";

const OpenPortalSchema = z.object({
  returnUrl: z.string().url(),
});

/**
 * Open the Stripe Customer Portal for the authenticated user.
 *
 * Form-data shape: `{ returnUrl: string }`.
 *
 * On success: 303 redirect to the Stripe-hosted portal.
 * On portal failure: redirects back to `returnUrl` with `?billing_error=<code>`.
 * On no-customer / no-session: redirects to `returnUrl` with
 * `?billing_error=no_customer` so the page can surface the subscribe CTA.
 */
export async function openBillingPortal(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    // Unauthenticated submissions get bounced to sign-in. Server actions
    // can't return a Response, so a redirect is the standard pattern.
    redirect("/signin");
  }

  const parsed = OpenPortalSchema.safeParse({
    returnUrl: formData.get("returnUrl"),
  });
  if (!parsed.success) {
    // Invalid form — surface a generic error in the URL. Hard to reach
    // legitimately (the page hard-codes returnUrl); a malformed submission
    // is most likely a misconfigured client component.
    redirect("/?billing_error=invalid_input");
  }

  try {
    const result = await createPortalSession({
      userId: session.user.id,
      returnUrl: parsed.data.returnUrl,
    });
    redirect(result.url);
  } catch (err) {
    // `redirect()` throws a Next-internal control-flow exception we must
    // re-throw, NOT swallow. Detect via the `digest` shape Next assigns.
    if (isNextRedirect(err)) throw err;
    if (err instanceof PortalError) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "billing.portal.domain_error",
          userId: session.user.id,
          code: err.code,
          message: err.message,
        }),
      );
      // Append `billing_error` so the page can render a banner explaining
      // why the portal didn't open (e.g. STAFF role tried it).
      const back = appendQuery(
        parsed.data.returnUrl,
        "billing_error",
        err.code,
      );
      redirect(back);
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "billing.portal.internal_error",
        userId: session.user.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    const back = appendQuery(
      parsed.data.returnUrl,
      "billing_error",
      "internal_error",
    );
    redirect(back);
  }
}

function isNextRedirect(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { digest?: unknown };
  return (
    typeof maybe.digest === "string" && maybe.digest.startsWith("NEXT_REDIRECT")
  );
}

function appendQuery(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
