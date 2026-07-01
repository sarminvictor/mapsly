#!/usr/bin/env tsx

/**
 * Seed the discovery registry with Phase-1 launch verticals + cities.
 *
 * Pulls from `_design/local-intel-preplan.md` § 3.2 + § 11.1 W2:
 *   - Vertical: Med Spa / Aesthetics (highest niche score, 79/100)
 *   - Cities: Los Angeles, Miami, Phoenix, Toronto
 *
 * Idempotent — re-runs only touch rows that don't yet exist. Existing
 * rows keep their stats (`businessCount`, `totalRuns`, etc.) so the
 * script is safe to run after manual discovery has populated data.
 *
 * Run:
 *   pnpm tsx scripts/seed-discovery-registry.ts
 *
 * After seeding, open /admin/discovery (signed in as ADMIN) and click
 * Run on a Phase-1 city to grow the index.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../lib/generated/prisma/client";
import {
  KNOWN_CATEGORIES,
  PHASE_1_LAUNCH_CITIES,
} from "../modules/business-discovery/known-categories";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  console.log("[seed-discovery-registry] starting…");

  // 1. Upsert the ENTIRE curated catalog into BusinessCategory (active +
  //    verified). The agency /discover Market step lists every active row, so
  //    this is what makes the full ~400 categories selectable. createMany
  //    skipDuplicates keeps existing rows (and their createdByUserId/verifiedAt)
  //    intact while inserting every new slug. Every slug is a real DfS category
  //    (curated from the DfS Business Listings category CSV).
  const now = new Date();
  const inserted = await prisma.businessCategory.createMany({
    data: KNOWN_CATEGORIES.map((c) => ({
      dataforseoId: c.dataforseoId,
      label: c.label,
      groupKey: c.groupKey,
      verifiedAt: now,
    })),
    skipDuplicates: true,
  });
  console.log(
    `[seed-discovery-registry] categories · inserted ${inserted.count} new · ${KNOWN_CATEGORIES.length} total in catalog`,
  );

  // 2. Seed the Phase-1 launch cities as TrackedLocation rows under Med Spa
  //    (for /admin/discovery). The AGENCY flow reads metros from the gazetteer
  //    (lib/geo), not TrackedLocation, so this is admin-only convenience.
  const medspa = await prisma.businessCategory.findUnique({
    where: { dataforseoId: "medical_spa" },
    select: { id: true, label: true },
  });
  if (medspa) {
    let created = 0;
    let skipped = 0;
    for (const city of PHASE_1_LAUNCH_CITIES) {
      const existing = await prisma.trackedLocation.findUnique({
        where: {
          categoryId_city_province_country: {
            categoryId: medspa.id,
            city: city.city,
            province: city.province,
            country: city.country,
          },
        },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.trackedLocation.create({
        data: {
          categoryId: medspa.id,
          city: city.city,
          province: city.province,
          country: city.country,
          lat: city.lat,
          lng: city.lng,
          radiusKm: city.radiusKm,
          verifiedAt: now,
        },
      });
      created += 1;
    }
    console.log(
      `[seed-discovery-registry] med-spa launch cities · created=${created} · skipped=${skipped}`,
    );
  }

  console.log("[seed-discovery-registry] done.");
}

main()
  .catch((err) => {
    console.error("[seed-discovery-registry] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
