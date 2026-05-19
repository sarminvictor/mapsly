import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Lazy proxy: PrismaClient is constructed on first property access.
// This lets the module import succeed at build time even if DATABASE_URL
// isn't set (Vercel's build phase doesn't always have runtime env vars).
function makeClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL not set — required at runtime. Set in Vercel project env or .env.local.",
    );
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function getClient(): PrismaClient {
  if (!globalThis.__prisma) {
    globalThis.__prisma = makeClient();
  }
  return globalThis.__prisma;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

export default prisma;
export { Prisma } from "@/lib/generated/prisma/client";
