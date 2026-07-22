// scripts/backfill-cellkeys.ts
//
// Stamp Business.cellKey/metroSlug on NULL-cellKey members of the Phase-1
// seeded cells, exactly the way discovery's persist path would
// (modules/business-discovery/persist.ts re-stamp branch): cellKey =
// `${dataforseoCategoryId}|${nearestMetro(lat,lng).slug}|${country}`.
//
// Why: legacy/geometric members with NULL cellKey are invisible to
// cell-scoped surfaces (getLeadDetail scope gate → public Proof Pack 404s;
// demand raw-list union per persist.ts comment). Never moves a business that
// already owns a cell.
//
// Usage: pnpm tsx scripts/backfill-cellkeys.ts

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { cellMembershipWhere } from "@/modules/business-discovery/cell-membership";
import { nearestMetro } from "@/lib/geo/resolve-metro";
import { cellKey as makeCellKey } from "@/lib/cell";

const MARKETS = [
  { category: "medical_spa", city: "Scottsdale" },
  { category: "medical_spa", city: "Boise" },
  { category: "medical_spa", city: "Miami" },
  { category: "dentist", city: "Austin" },
  { category: "dentist", city: "Frisco" },
  { category: "dentist", city: "Tampa" },
];

async function main() {
  let total = 0;
  for (const m of MARKETS) {
    const loc = await prisma.trackedLocation.findFirst({
      where: {
        city: m.city,
        country: "US",
        category: { dataforseoId: m.category },
      },
      select: { lat: true, lng: true, radiusKm: true },
    });
    if (!loc) {
      console.log(`[backfill] ${m.city}/${m.category}: no cell — skip`);
      continue;
    }
    const where = cellMembershipWhere({
      dataforseoCategoryId: m.category,
      lat: loc.lat,
      lng: loc.lng,
      radiusKm: loc.radiusKm,
      city: m.city,
      country: "US",
    });
    const rows = await prisma.business.findMany({
      where: { ...where, isActive: true, cellKey: null },
      select: { id: true, lat: true, lng: true, country: true },
    });
    let stamped = 0;
    let unresolved = 0;
    for (const b of rows) {
      if (b.lat == null || b.lng == null) {
        unresolved++;
        continue;
      }
      const near = nearestMetro(b.lat, b.lng);
      if (!near) {
        unresolved++;
        continue;
      }
      await prisma.business.update({
        where: { id: b.id },
        data: {
          cellKey: makeCellKey(m.category, near.metro.slug, b.country ?? "US"),
          metroSlug: near.metro.slug,
        },
      });
      stamped++;
    }
    total += stamped;
    console.log(
      `[backfill] ${m.city}/${m.category}: stamped=${stamped} unresolved=${unresolved} (of ${rows.length} null-cellKey members)`,
    );
  }
  console.log(`[backfill] TOTAL stamped=${total}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
