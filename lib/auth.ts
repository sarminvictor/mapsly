import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";

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
