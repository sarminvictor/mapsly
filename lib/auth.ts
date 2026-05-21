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
    async session({ session, token }) {
      if (token?.sub) session.user.id = token.sub;
      return session;
    },
  },
});
