// NextAuth v5 catch-all handler.
// Exposes /api/auth/signin, /api/auth/callback, /api/auth/session, /api/auth/signout, etc.
// All config lives in `@/lib/auth`.
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
