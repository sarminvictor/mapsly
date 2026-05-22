/**
 * NextAuth v5 type augmentation · adds `id` + `role` to the session
 * user. Without this, `session.user.id` and `session.user.role`
 * surface as `unknown` in TypeScript even though `lib/auth.ts`
 * populates them at runtime.
 *
 * Mirrors Prisma's `UserRole` enum (`prisma/schema.prisma`):
 *   - ADMIN  · internal staff · gates the /dev tree
 *   - MEMBER · the default for every SMB + Agency user
 *
 * Per `.claude/rules/conventions.md` we keep the literal union
 * local instead of importing from the generated Prisma types so the
 * declaration file stays free of build-order dependencies.
 */

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  /**
   * Returned by `auth()`, `useSession()`, `getServerSession()`. The
   * fields here line up with what `callbacks.session` writes in
   * `lib/auth.ts`.
   */
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role?: "ADMIN" | "MEMBER";
    };
  }

  /**
   * Adapter-row shape · matches the `User` model Prisma sends to the
   * JWT callback on first sign-in.
   */
  interface User {
    id?: string;
    role?: "ADMIN" | "MEMBER";
  }
}

declare module "next-auth/jwt" {
  /**
   * JWT payload · what `callbacks.jwt` reads + writes. The token's
   * `sub` claim already carries the user id (standard JWT field), so
   * we only need to declare the custom `role` field here.
   */
  interface JWT {
    role?: "ADMIN" | "MEMBER";
  }
}
