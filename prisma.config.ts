import path from "node:path";
import { defineConfig } from "prisma/config";

// Local dev loads env from .env.local via Next.js. For prisma CLI use:
//   pnpm dotenv -e .env.local -- prisma migrate dev
// CI passes env via the workflow `env:` block.

// Prisma 7 config — Migrate + introspect use these URLs.
// The PrismaClient itself connects via the Neon adapter (see lib/prisma.ts).
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  // Prisma 7's Datasource shape is { url, shadowDatabaseUrl } only.
  // For Neon, point migrate at the direct (non-pooled) URL via DATABASE_URL.
  // If you keep both pooled and direct URLs, swap DATABASE_URL for DIRECT_URL
  // when running `prisma migrate` / `prisma db push`.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
