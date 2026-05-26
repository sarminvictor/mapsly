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

  // 1. Seed the Phase-1 category (Med Spa)
  const phase1 = KNOWN_CATEGORIES.find((c) => c.phase === 1);
  if (!phase1) {
    throw new Error(
      "No Phase 1 category in known-categories.ts — preplan §3.2 expects Med Spa.",
    );
  }
  const category = await prisma.businessCategory.upsert({
    where: { dataforseoId: phase1.dataforseoId },
    create: {
      dataforseoId: phase1.dataforseoId,
      label: phase1.label,
      groupKey: phase1.groupKey,
      verifiedAt: new Date(),
    },
    update: {
      // Keep verifiedAt + label fresh; don't blow away createdByUserId
      label: phase1.label,
      groupKey: phase1.groupKey,
    },
    select: { id: true, dataforseoId: true, label: true },
  });
  console.log(
    `[seed-discovery-registry] category · ${category.label} (${category.dataforseoId}) · id=${category.id}`,
  );

  // 2. Seed the 4 Phase-1 launch cities
  let created = 0;
  let skipped = 0;
  for (const city of PHASE_1_LAUNCH_CITIES) {
    const existing = await prisma.trackedLocation.findUnique({
      where: {
        categoryId_city_province_country: {
          categoryId: category.id,
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
        categoryId: category.id,
        city: city.city,
        province: city.province,
        country: city.country,
        lat: city.lat,
        lng: city.lng,
        radiusKm: city.radiusKm,
        verifiedAt: new Date(),
      },
    });
    created += 1;
  }
  console.log(
    `[seed-discovery-registry] locations · created=${created} · skipped=${skipped} (already present)`,
  );

  // Hint to the operator
  const phase1Count = PHASE_1_LAUNCH_CITIES.length;
  const otherCats = KNOWN_CATEGORIES.filter((c) => c.phase !== 1).length;
  console.log(
    `[seed-discovery-registry] done · ${phase1Count} Phase-1 cells under ${category.label} ready to run from /admin/discovery.`,
  );
  console.log(
    `[seed-discovery-registry] ${otherCats} more curated verticals (Phases 2–5) are pickable in the UI when ready.`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-discovery-registry] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
