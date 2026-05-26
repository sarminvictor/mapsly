#!/usr/bin/env tsx
/**
 * Verify canonicalizeNames() merges the right variants against The
 * Injectionist's actual production data. Shows the BEFORE (raw SQL
 * counts) and AFTER (canonical groups) for inspection.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";
import { canonicalizeNames } from "../modules/reviews/canonicalize-names";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const biz = await prisma.business.findFirst({
    where: { slug: "the-injectionist-aesthetics" },
    select: { id: true, name: true },
  });
  if (!biz) {
    console.log("business not found");
    return;
  }

  const rows = await prisma.$queryRaw<{ name: string; count: bigint }[]>`
    SELECT name, COUNT(*)::bigint AS count
    FROM "Review", unnest("mentionedPeople") AS name
    WHERE "businessId" = ${biz.id}
    GROUP BY name
    ORDER BY count DESC
  `;

  console.log(`=== BEFORE · ${rows.length} raw variants ===`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(30)} ${r.count}`);
  }

  const canonical = canonicalizeNames(
    rows.map((r) => ({ name: r.name, count: Number(r.count) })),
  );

  console.log(`\n=== AFTER · ${canonical.length} canonical buckets ===`);
  for (const c of canonical) {
    const variantsLabel =
      c.variants.length > 1
        ? ` · variants: ${c.variants.filter((v) => v !== c.canonical).join(", ")}`
        : "";
    console.log(`  ${c.canonical.padEnd(30)} ${c.count}${variantsLabel}`);
  }
}

main()
  .catch((err) => {
    console.error("failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
