import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import { googleLinkDecision } from "@/lib/google-link-gate";
import stripeClient from "@/lib/stripe";
import {
  provisionSmbFromCheckout,
  recordSmbSubscriptionFromSession,
} from "@/modules/billing/provision";

/** Replay window for the Stripe-checkout login credential (defense-in-depth). */
const STRIPE_LOGIN_MAX_AGE_MS = 15 * 60 * 1000; // 15m — a real redirect lands in seconds

// Auth.js's Resend provider auto-resolves `apiKey` from the env var
// `AUTH_RESEND_KEY` (see @auth/core/lib/utils/env.js). Our project
// stores the same secret under `RESEND_API_KEY` for parity with our
// transactional-email code paths, so we wire it through explicitly.
// Falling back to `AUTH_RESEND_KEY` keeps the framework's default
// convention working too. INC: prod /signin returned Configuration
// error because neither env var was passed to the provider.
const RESEND_API_KEY =
  process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;

// Google OAuth ("Continue with Google"). Auth.js v5 auto-reads AUTH_GOOGLE_ID /
// AUTH_GOOGLE_SECRET, but we pass them explicitly for parity with the Resend
// wiring above and so a missing binding is visible here rather than magic. When
// unset (local dev / preview without creds) the provider is simply inert — the
// button 500s at the Google redirect but magic-link keeps working.
const GOOGLE_CLIENT_ID = process.env.AUTH_GOOGLE_ID;
const GOOGLE_CLIENT_SECRET = process.env.AUTH_GOOGLE_SECRET;

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Resend({
      apiKey: RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL ?? "login@mapsly.ai",
      // Branded magic-link email (house shell) — the provider default is an
      // unstyled bare link with no footer (owner feedback 2026-07-22).
      async sendVerificationRequest({ identifier, url, provider }) {
        const { renderEmailShell } = await import("@/lib/email/shell");
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: provider.from,
            to: identifier,
            subject: "Sign in to Mapsly",
            html: renderEmailShell({
              heading: "Sign in to Mapsly",
              bodyHtml:
                "Click the button below to sign in. The link works once and expires in 24 hours.",
              cta: { label: "Sign in", url },
              reason:
                "You're receiving this because a sign-in link was requested for this address. If that wasn't you, ignore this email.",
            }),
            text: `Sign in to Mapsly:\n\n${url}\n\nThe link works once and expires in 24 hours. If you did not request it, ignore this email.`,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          throw new Error(`resend signin email failed: ${res.status}`);
        }
      },
    }),
    // "Continue with Google" — a one-click alternative to the magic link. It's
    // provider-agnostic downstream: like the magic link it lands the user on
    // `/post-signin`, which does all provisioning (agency + wallet + the 50
    // free credits via grantFreeTierIfNew) off the `?audience=agency` marker,
    // NOT off which provider signed them in. So no bespoke Google provisioning.
    //
    // allowDangerousEmailAccountLinking: someone who first signed up via magic
    // link (User row, no OAuth Account) and later clicks Google with the SAME
    // address gets linked to that one account instead of hitting Auth.js's
    // default OAuthAccountNotLinked error. Safe for the magic-link↔Google pair
    // (both prove ownership of the mailbox: Google asserts email_verified, the
    // magic link is a click in that inbox) — but NOT for a User minted by the
    // stripe-checkout provider from a payer-TYPED email (emailVerified null).
    // The `signIn` callback below closes that gap: it refuses the silent link
    // onto any pre-existing user who never verified their email.
    Google({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    // Post-payment auto-login for the direct-from-landing flow. The ONLY
    // credential is a Stripe Checkout Session id, which is re-validated against
    // the Stripe API here (must be a real, complete, recent subscription
    // checkout) — so it cannot be forged. On success we find-or-create the
    // User from the Stripe-confirmed email and claim the prospect Business.
    // This is the headless equivalent of clicking a magic link; payment is the
    // proof of intent. Hardening TODO: single-use via a consumed-session table.
    Credentials({
      id: "stripe-checkout",
      name: "Stripe Checkout",
      credentials: { stripeSessionId: {}, nonce: {} },
      async authorize(credentials) {
        const sessionId =
          typeof credentials?.stripeSessionId === "string"
            ? credentials.stripeSessionId
            : null;
        const nonce =
          typeof credentials?.nonce === "string" ? credentials.nonce : null;
        if (!sessionId || !sessionId.startsWith("cs_")) return null;
        try {
          const session = await stripeClient.checkout.sessions.retrieve(
            sessionId,
            { expand: ["subscription"] },
          );
          if (session.status !== "complete") return null;
          if (
            typeof session.created === "number" &&
            session.created * 1000 < Date.now() - STRIPE_LOGIN_MAX_AGE_MS
          ) {
            return null; // stale session — refuse the credential
          }
          const md = (session.metadata ?? {}) as Record<
            string,
            string | undefined
          >;
          if (md.audience !== "smb") return null;
          // Browser binding: the login must come from the SAME browser that
          // started checkout (the nonce was set in an httpOnly cookie there).
          // Defeats replay of a session_id leaked via logs / referrers.
          // Fail-CLOSED: every direct-from-landing SMB session sets a nonce, so
          // a missing/mismatched one is rejected (→ magic-link fallback).
          if (md.nonce !== nonce) return null;

          const email =
            session.customer_details?.email ?? session.customer_email ?? null;
          const customer = session.customer;
          const customerId =
            typeof customer === "string" ? customer : (customer?.id ?? null);
          if (!email || !customerId) return null;

          const result = await provisionSmbFromCheckout({
            email,
            customerId,
            landingToken: md.landingToken,
          });
          // SECURITY: never auto-login an EXISTING account matched only by the
          // typed (unverified) email — that is account takeover (Stripe lets the
          // payer type any address). Only a user this payment CREATED, or one
          // already owning this Stripe customer, may be signed in headlessly.
          // Email-matched users must verify via magic link.
          if (result.matchedBy === "email") return null;

          // Record the subscription state immediately (webhook-independent) so
          // the paid user is marked subscribed the instant they log in. The
          // webhook keeps it in sync afterward. Best-effort — never block login.
          await recordSmbSubscriptionFromSession(session, result.userId).catch(
            () => {},
          );

          const user = await prisma.user.findUnique({
            where: { id: result.userId },
            select: { id: true, email: true, role: true },
          });
          if (!user) return null;
          return { id: user.id, email: user.email, role: user.role };
        } catch (err) {
          // Payment-adjacent failure — fail closed (magic-link fallback) but
          // make it observable per .claude/rules/observability.md.
          console.error(
            JSON.stringify({
              level: "error",
              event: "billing.stripe_login.authorize_failed",
              feature: "billing",
              audience: "smb",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
  },
  callbacks: {
    /**
     * Gate for `allowDangerousEmailAccountLinking` (see lib/google-link-gate).
     * Runs BEFORE Auth.js persists the link, so returning false / a redirect
     * here prevents the merge entirely. Only the google provider is gated —
     * magic-link and stripe-checkout keep their existing behavior.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const email =
        typeof profile?.email === "string"
          ? profile.email.trim().toLowerCase()
          : null;
      if (!email) return false;
      const existing = await prisma.user.findUnique({
        where: { email },
        select: {
          emailVerified: true,
          accounts: {
            where: { provider: "google" },
            select: { id: true },
            take: 1,
          },
        },
      });
      const decision = googleLinkDecision(
        profile?.email_verified === true,
        existing
          ? {
              emailVerified: existing.emailVerified,
              hasGoogleAccount: existing.accounts.length > 0,
            }
          : null,
      );
      if (decision === "allow") return true;
      if (decision === "verify_email_first") {
        // The signin page maps this to a "use the email link first" message.
        return "/signin?error=verify_email";
      }
      return false;
    },
    /**
     * JWT callback enriches the token with `role` so downstream
     * `auth()` calls (and middleware-equivalent checks) see the user's
     * `UserRole` without re-hitting Prisma per request.
     *
     * The role is loaded once on first sign-in (when the adapter
     * populates `user`) and cached on the JWT. Tokens minted before
     * this callback existed get a backfill via a single
     * `findUnique({ select: { role: true } })` — bounded + cheap.
     *
     * If a user's role changes server-side (e.g. promoted to ADMIN),
     * they re-sign-in to pick it up. For an internal-only admin gate
     * that's an acceptable trade — admin grants are rare + intentional.
     */
    async jwt({ token, user }) {
      // First sign-in · `user` is the freshly-loaded adapter row.
      const userRole = (user as { role?: string } | undefined)?.role;
      if (userRole === "ADMIN" || userRole === "MEMBER") {
        token.role = userRole;
        return token;
      }
      // Backfill for tokens minted before this callback existed.
      if (!token.role && token.sub) {
        try {
          const row = await prisma.user.findUnique({
            where: { id: token.sub },
            select: { role: true },
          });
          if (row?.role === "ADMIN" || row?.role === "MEMBER") {
            token.role = row.role;
          }
        } catch {
          // Degrade open · the admin gate falls back to "non-admin"
          // behavior, which is safer than failing loud here.
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.sub) session.user.id = token.sub;
      if (token?.role === "ADMIN" || token?.role === "MEMBER") {
        session.user.role = token.role;
      }
      return session;
    },
  },
});
