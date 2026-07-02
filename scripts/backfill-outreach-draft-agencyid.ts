#!/usr/bin/env tsx
/**
 * WP5 (finishing WP0-1) · one-shot OutreachDraft.agencyId backfill.
 *
 *   pnpm dotenv -e .env.local -- tsx scripts/backfill-outreach-draft-agencyid.ts
 *
 * For every draft with agencyId IS NULL:
 *   businessId → Business.cellKey → the Discovery rows containing that cellKey.
 *   - Exactly ONE agency discovered the cell → stamp its agencyId.
 *   - AMBIGUOUS (a shared cell — 2+ agencies) → leave null. Null rows stay
 *     reachable via the reads' OR-null arm inside each agency's own cell
 *     scope (modules/outreach/draft-scope.ts), so nothing is lost and nothing
 *     is mis-assigned. Mutations adopt-on-write once ownership is proven.
 *   - No cell / no discovery → leave null (orphan; unreachable anyway).
 *
 * Idempotent: re-running only touches rows still null. Once this reports
 * 0 resolvable nulls, the OR-null read arms can be dropped and
 * touchpoints/page.tsx simplified to a direct `where: { agencyId }`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const BATCH = 500;

async function main(): Promise<void> {
  // Cell → owning agencies map, built once (discoveries are few).
  const discoveries = await prisma.discovery.findMany({
    select: { agencyId: true, cellKeys: true },
  });
  const agenciesByCell = new Map<string, Set<string>>();
  for (const d of discoveries) {
    for (const cell of d.cellKeys) {
      const set = agenciesByCell.get(cell) ?? new Set<string>();
      set.add(d.agencyId);
      agenciesByCell.set(cell, set);
    }
  }

  let stamped = 0;
  let ambiguous = 0;
  let orphaned = 0;
  let cursor: string | undefined;

  for (;;) {
    const drafts = await prisma.outreachDraft.findMany({
      where: { agencyId: null },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, businessId: true },
    });
    if (drafts.length === 0) break;
    cursor = drafts[drafts.length - 1].id;

    const businesses = await prisma.business.findMany({
      where: { id: { in: [...new Set(drafts.map((d) => d.businessId))] } },
      select: { id: true, cellKey: true },
    });
    const cellByBusiness = new Map(businesses.map((b) => [b.id, b.cellKey]));

    // Group stampable drafts per agency → one updateMany per agency per batch.
    const byAgency = new Map<string, string[]>();
    for (const draft of drafts) {
      const cell = cellByBusiness.get(draft.businessId);
      const owners = cell ? agenciesByCell.get(cell) : undefined;
      if (!owners || owners.size === 0) {
        orphaned += 1;
      } else if (owners.size === 1) {
        const [agencyId] = owners;
        const list = byAgency.get(agencyId) ?? [];
        list.push(draft.id);
        byAgency.set(agencyId, list);
      } else {
        ambiguous += 1;
      }
    }

    for (const [agencyId, ids] of byAgency) {
      const res = await prisma.outreachDraft.updateMany({
        // agencyId: null re-check makes the write race-safe vs adopt-on-write.
        where: { id: { in: ids }, agencyId: null },
        data: { agencyId },
      });
      stamped += res.count;
    }

    console.log(
      `[backfill] batch done · stamped=${stamped} ambiguous=${ambiguous} orphaned=${orphaned}`,
    );
  }

  console.log(
    JSON.stringify({
      event: "outreach-draft-agencyid-backfill.done",
      stamped,
      ambiguous,
      orphaned,
    }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
