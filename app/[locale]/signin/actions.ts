"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { trackProductEvent } from "@/lib/analytics/product-events";
import { canonicalEmail } from "@/lib/email/canonical";
import {
  rateLimitAction,
  MAGIC_LINK_EMAIL_LIMIT,
  MAGIC_LINK_IP_LIMIT,
} from "@/lib/middleware/rate-limit";

export type SignInState = {
  error?: "invalid_email" | "send_failed" | "rate_limited";
} | null;

// RFC-5322 simplified email check — good enough as a first-line filter
// before NextAuth/Resend does the authoritative validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Best-effort client IP for rate-limit keying only (never logged/persisted —
 * the header is client-controllable off-Vercel). First `x-forwarded-for` hop is
 * the original client; falls back to `x-real-ip`, then a sentinel bucket.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  if (first) return first;
  return h.get("x-real-ip")?.trim() || "ip:unknown";
}

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return { error: "invalid_email" };
  }

  // Rate-limit magic-link sends BEFORE any send work — ≤5/hr per mailbox
  // (canonicalized so +tag / gmail-dot variants share a bucket) plus a per-IP
  // ceiling to blunt a flood that rotates addresses from one source. Mandated
  // by .claude/rules/security.md §Auth Failures. Fail-soft: when KV is absent
  // (local dev / build / tests) rateLimitAction returns { limited: false }.
  const emailLimited = await rateLimitAction(
    MAGIC_LINK_EMAIL_LIMIT,
    canonicalEmail(email),
  );
  if (emailLimited.limited) return { error: "rate_limited" };
  const ipLimited = await rateLimitAction(
    MAGIC_LINK_IP_LIMIT,
    await clientIp(),
  );
  if (ipLimited.limited) return { error: "rate_limited" };

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

/**
 * "Continue with Google" — the OAuth twin of signInAction, agency-focused.
 *
 * Unlike the magic link (which sends an email, then redirects to a waiting
 * page), OAuth redirects the browser straight to Google; `signIn("google")`
 * throws a NEXT_REDIRECT that MUST propagate. On return, Auth.js drops the user
 * at `redirectTo`, and `/post-signin` does all provisioning + the 50-credit
 * grant off the `?audience=agency` marker — identical to the magic-link path.
 *
 * Scope (per the "agency only for now" decision): the button always carries
 * `audience=agency`, EXCEPT when a valid seat-invite token is present — an
 * invitee joins the inviting agency instead of provisioning their own (WP5-8).
 * SMB checkout intent is deliberately NOT wired here: that path is payment-
 * gated and belongs to the magic-link / Stripe flow, not a free Google signup.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  // Same per-IP ceiling as the magic-link path. There's no email to key on
  // yet (Google hasn't run), so IP is the only handle — it bounds abuse of
  // the OAuth kick-off AND the unauthenticated ProductEvent write below
  // (security review 2026-07-15). On limit, bounce back to /signin with a
  // visible error instead of a silent no-op.
  const ipLimited = await rateLimitAction(
    MAGIC_LINK_IP_LIMIT,
    await clientIp(),
  );
  if (ipLimited.limited) {
    const locale = (await getLocale()) as Locale;
    redirect({
      href: { pathname: "/signin", query: { error: "rate_limited" } },
      locale,
    });
  }

  const invite = formData.get("invite");
  const redirectTo =
    typeof invite === "string" && /^[a-f0-9]{48}$/.test(invite)
      ? `/post-signin?invite=${invite}`
      : "/post-signin?audience=agency";

  // Top-of-funnel signup event, mirroring the magic-link action (fires on the
  // request, not the confirmed account — agency_created is the downstream
  // "account exists" checkpoint). No PII: audience + method only.
  void trackProductEvent({
    type: "signup",
    props: { audience: "agency", method: "google" },
  });

  await signIn("google", { redirectTo });
}
