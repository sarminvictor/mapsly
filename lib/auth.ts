import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Resend({
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
