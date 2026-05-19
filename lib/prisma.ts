import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool } from "@neondatabase/serverless";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function makeClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL not set");

  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const prisma = globalThis.__prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma;

export default prisma;
export { Prisma } from "@/lib/generated/prisma/client";
