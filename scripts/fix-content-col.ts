/**
 * One-off repair: ensure LighthouseAudit.contentWithoutJs exists + reset the
 * bogus (empty) migration record so `migrate deploy` re-applies it cleanly.
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/fix-content-col.ts
 */
import prisma from "@/lib/prisma";

const MIG = "20260529225420_lighthouse_content_without_js";

async function main() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "LighthouseAudit" ADD COLUMN IF NOT EXISTS "contentWithoutJs" BOOLEAN',
  );
  // Drop the empty applied record so migrate deploy re-records it with the
  // correct checksum of the now-correct migration.sql (idempotent ALTER).
  await prisma.$executeRawUnsafe(
    `DELETE FROM "_prisma_migrations" WHERE migration_name = '${MIG}'`,
  );
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name::text FROM information_schema.columns
     WHERE table_name = 'LighthouseAudit' AND column_name = 'contentWithoutJs'`,
  );
  console.log("contentWithoutJs column present:", cols.length > 0);
  console.log("bogus migration record cleared (will re-apply on deploy)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
