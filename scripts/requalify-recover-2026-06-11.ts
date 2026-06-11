#!/usr/bin/env tsx
/**
 * One-off recovery for the 2026-06-11 email-erasure incident
 * (INC-2026-06-11-44 · "Qualify (4) sent 380+ jobs").
 *
 * The duplicate fan-out's re-runs nulled ~40 previously discovered
 * emails (228 → 188) and downgraded ~35 rows QUALIFIED → DISQUALIFIED.
 * The erased rows are indistinguishable from genuine no-email rows
 * post-hoc, so recovery re-runs the pipeline (force) over the plausible
 * damage set: Miami members that are DISQUALIFIED with no email, but
 * claimed + reviewed (i.e. they were one email away from QUALIFIED).
 *
 * The `ai_attempted` flag is cleared first so tier-3 may re-run — the
 * AI found these emails once, it will find most again. Run AFTER the
 * v0.15.21 fix pack is deployed (this script depends on the
 * never-erase ratchet + force option). Expected cost: ≤ ~$3 of AI
 * search for ~100 rows; rows whose sites are reachable again recover
 * free via scrape.
 *
 * Usage:
 *   pnpm dotenv -e .env.local -- tsx scripts/requalify-recover-2026-06-11.ts          # dry-run (lists targets)
 *   pnpm dotenv -e .env.local -- tsx scripts/requalify-recover-2026-06-11.ts --apply  # run recovery
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../lib/generated/prisma/client";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

// Miami cell geometry · (25.7617, -80.1918) r=10km — keep in lock-step
// with modules/business-discovery/cell-membership.ts.
const LAT = 25.7617;
const LNG = -80.1918;
const RADIUS_KM = 10;
const latDelta = RADIUS_KM / 111.32;
const lngDelta = RADIUS_KM / (111.32 * Math.cos((LAT * Math.PI) / 180));

const TARGET_WHERE = {
  categoryIds: { has: "medical_spa" },
  OR: [
    {
      lat: { gte: LAT - latDelta, lte: LAT + latDelta },
      lng: { gte: LNG - lngDelta, lte: LNG + lngDelta },
    },
    { lat: null as null, city: "Miami", country: "US" },
  ],
  qualificationStatus: "DISQUALIFIED" as const,
  emailDiscovered: null,
  isClaimed: true,
  reviewCount: { gte: 3 },
};

const APPLY = process.argv.includes("--apply");
const CONCURRENCY = 3;

async function main(): Promise<void> {
  const targets = await prisma.business.findMany({
    where: TARGET_WHERE,
    select: { id: true, name: true, city: true, qualificationFlags: true },
    orderBy: { name: "asc" },
  });
  console.log(
    `[recover] ${targets.length} damage-set rows (DISQUALIFIED · no email · claimed · reviews ≥ 3)`,
  );
  if (!APPLY) {
    for (const t of targets) {
      console.log(`  - ${t.name} (${t.city}) flags=[${t.qualificationFlags}]`);
    }
    console.log("[recover] dry-run · re-run with --apply to execute");
    return;
  }

  // Import lazily so the dry-run path never touches the qualify deps.
  const { qualifyBusiness } =
    await import("../modules/business-qualification/qualify");
  const { withCronRun } = await import("../lib/cost/cost-counter");

  // Clear the AI billing guard for the damage set — we WANT tier-3 to
  // re-run once for these rows.
  for (const t of targets) {
    if (t.qualificationFlags.includes("ai_attempted")) {
      await prisma.business.update({
        where: { id: t.id },
        data: {
          qualificationFlags: t.qualificationFlags.filter(
            (f) => f !== "ai_attempted",
          ),
        },
      });
    }
  }

  let recovered = 0;
  let stillNoEmail = 0;
  let failed = 0;
  const queue = [...targets];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) return;
      try {
        const outcome = await withCronRun(
          "manual:requalify-recover-2026-06-11",
          () => qualifyBusiness(t.id, { force: true }),
        );
        if (outcome.emailDiscovered) {
          recovered += 1;
          console.log(
            `  ✓ ${t.name} → ${outcome.status} · ${outcome.emailDiscovered} (${outcome.emailDiscoverySource})`,
          );
        } else {
          stillNoEmail += 1;
        }
      } catch (err) {
        failed += 1;
        console.warn(
          `  ✗ ${t.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () =>
      worker(),
    ),
  );

  console.log(
    `[recover] done · ${recovered} emails recovered · ${stillNoEmail} still no email · ${failed} failed`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
