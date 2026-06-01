/**
 * One-time cleanup: strip query strings + fragments from existing
 * Business.website values (GMB/UTM tracking params) so the DB holds only
 * canonical links. Idempotent — re-running is a no-op once clean.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/clean-website-params.ts
 */
import prisma from "@/lib/prisma";

async function main() {
  const before = await prisma.business.count({
    where: {
      OR: [{ website: { contains: "?" } }, { website: { contains: "#" } }],
    },
  });
  console.log(`rows with params/fragments before: ${before}`);

  // Strip everything from the first "?" or "#" to the end of the URL.
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "Business" SET website = regexp_replace(website, '[?#].*$', '') WHERE website ~ '[?#]'`,
  );
  console.log(`cleaned ${affected} website value(s)`);

  const after = await prisma.business.count({
    where: {
      OR: [{ website: { contains: "?" } }, { website: { contains: "#" } }],
    },
  });
  console.log(`rows with params/fragments after: ${after}`);

  // Spot-check the one from the report.
  const sample = await prisma.business.findFirst({
    where: { name: { contains: "Injection", mode: "insensitive" } },
    select: { name: true, website: true },
  });
  console.log("sample:", JSON.stringify(sample));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
