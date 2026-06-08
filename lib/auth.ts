import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import stripeClient from "@/lib/stripe";
import { provisionSmbFromCheckout } from "@/modules/billing/provision";

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

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Resend({
      apiKey: RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL ?? "login@mapsly.ai",
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
          const session =
            await stripeClient.checkout.sessions.retrieve(sessionId);
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
