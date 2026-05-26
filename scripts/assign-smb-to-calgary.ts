#!/usr/bin/env tsx
/**
 * One-off · assign one Calgary qualified business to the SMB test user
 * (sarminvictor+smb@gmail.com) so /(smb)/home + /(smb)/reviews render
 * with real-world data.
 *
 * Selection rule (default · auto-pick):
 *   QUALIFIED status + has Google CID + highest review count.
 *   Tie-breaker: highest rating, then earliest qualifiedAt.
 *
 * Override:
 *   --business-id <id>   · explicit pick (must be in Calgary CA + QUALIFIED)
 *   --slug <slug>        · alternate pick by slug
 *   --list-only          · print top candidates without making changes
 *
 * What this writes:
 *   - Business.ownerUserId = SMB user id
 *   - Business.isClaimed   = true
 *   - User.role            = ensures MEMBER (no demote of ADMIN)
 *
 * Idempotent: re-running on the same biz is a no-op. Re-running with a
 * different biz CLEARS the prior ownership (one biz per SMB test user)
 * and writes the new one.
 *
 * Invoke:
 *   pnpm dotenv -e .env.local -- tsx scripts/assign-smb-to-calgary.ts
 *   pnpm dotenv -e .env.local -- tsx scripts/assign-smb-to-calgary.ts --list-only
 *   pnpm dotenv -e .env.local -- tsx scripts/assign-smb-to-calgary.ts --slug <slug>
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../lib/generated/prisma/client";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const SMB_EMAIL = "sarminvictor+smb@gmail.com";

interface Args {
  businessId: string | null;
  slug: string | null;
  listOnly: boolean;
}

function parseArgs(): Args {
  const args: Args = { businessId: null, slug: null, listOnly: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--list-only") args.listOnly = true;
    if (a === "--business-id") args.businessId = process.argv[++i] ?? null;
    if (a === "--slug") args.slug = process.argv[++i] ?? null;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();

  // ---- 1. Resolve the SMB user -----------------------------------------
  const user = await prisma.user.findUnique({
    where: { email: SMB_EMAIL },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) {
    throw new Error(
      `[assign-smb-to-calgary] No User row for ${SMB_EMAIL}. ` +
        `Run \`pnpm dotenv -e .env.local -- tsx scripts/seed-test-users.ts\` first.`,
    );
  }
  console.log(
    `[assign-smb-to-calgary] user · ${user.email} · role=${user.role} · id=${user.id.slice(0, 8)}…`,
  );

  // ---- 2. Pick the target business -------------------------------------
  //
  // Default ranking: QUALIFIED first, then reviewCount desc, then rating
  // desc, then earliest qualifiedAt. This biases toward established
  // businesses with rich data — Maria's UX is most compelling there.
  const candidates = await prisma.business.findMany({
    where: {
      city: "Calgary",
      country: "CA",
      qualificationStatus: "QUALIFIED",
      googleCid: { not: null },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      googleCid: true,
      reviewCount: true,
      rating: true,
      emailDiscovered: true,
      qualifiedAt: true,
      ownerUserId: true,
    },
    orderBy: [
      { reviewCount: { sort: "desc", nulls: "last" } },
      { rating: { sort: "desc", nulls: "last" } },
      { qualifiedAt: { sort: "asc", nulls: "last" } },
    ],
    take: 10,
  });

  if (candidates.length === 0) {
    console.error(
      "[assign-smb-to-calgary] No Calgary QUALIFIED businesses with googleCid · qualify a cell first.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\n=== Top candidates ===");
  for (const [i, c] of candidates.entries()) {
    const owned = c.ownerUserId
      ? `(owned by ${c.ownerUserId.slice(0, 8)}…)`
      : "";
    console.log(
      `${(i + 1).toString().padStart(2)}. ${c.name.padEnd(50)} ★${(c.rating ?? 0).toFixed(1)} · ${c.reviewCount ?? 0} reviews · ${c.emailDiscovered ? "✓email" : "—"} ${owned}`,
    );
    console.log(`    slug=${c.slug} · id=${c.id}`);
  }

  if (args.listOnly) {
    console.log("\n[assign-smb-to-calgary] --list-only · no changes made");
    return;
  }

  // Choose the target
  let target = candidates[0]!;
  if (args.businessId) {
    const found = candidates.find((c) => c.id === args.businessId);
    if (!found) {
      // Fall back to a wider lookup so user can pick any QUALIFIED row
      const fallback = await prisma.business.findUnique({
        where: { id: args.businessId },
        select: {
          id: true,
          slug: true,
          name: true,
          googleCid: true,
          reviewCount: true,
          rating: true,
          emailDiscovered: true,
          qualifiedAt: true,
          ownerUserId: true,
          city: true,
          country: true,
          qualificationStatus: true,
        },
      });
      if (!fallback) {
        throw new Error(
          `[assign-smb-to-calgary] --business-id ${args.businessId} not found`,
        );
      }
      if (
        fallback.city !== "Calgary" ||
        fallback.country !== "CA" ||
        fallback.qualificationStatus !== "QUALIFIED"
      ) {
        throw new Error(
          `[assign-smb-to-calgary] --business-id ${args.businessId} is ${fallback.city}/${fallback.country}/${fallback.qualificationStatus} · must be Calgary/CA/QUALIFIED`,
        );
      }
      target = fallback;
    } else {
      target = found;
    }
  } else if (args.slug) {
    const found = candidates.find((c) => c.slug === args.slug);
    if (!found) {
      throw new Error(
        `[assign-smb-to-calgary] --slug ${args.slug} not in top-10 candidates · use --business-id or rerun discovery to surface it`,
      );
    }
    target = found;
  }

  console.log(
    `\n[assign-smb-to-calgary] target · ${target.name} (${target.slug})`,
  );

  // ---- 3. Clear any prior ownership (one biz per SMB test user) -------
  const prior = await prisma.business.findMany({
    where: { ownerUserId: user.id, NOT: { id: target.id } },
    select: { id: true, name: true },
  });
  if (prior.length > 0) {
    console.log(
      `[assign-smb-to-calgary] clearing ${prior.length} prior owned business(es): ${prior.map((b) => b.name).join(", ")}`,
    );
    await prisma.business.updateMany({
      where: { ownerUserId: user.id, NOT: { id: target.id } },
      data: { ownerUserId: null, isClaimed: false },
    });
  }

  // ---- 4. Assign --------------------------------------------------------
  const updated = await prisma.business.update({
    where: { id: target.id },
    data: {
      ownerUserId: user.id,
      isClaimed: true,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      ownerUserId: true,
      isClaimed: true,
      rating: true,
      reviewCount: true,
      emailDiscovered: true,
    },
  });

  console.log("\n=== AFTER ===");
  console.log(`Business      : ${updated.name}`);
  console.log(`slug          : ${updated.slug}`);
  console.log(`ownerUserId   : ${updated.ownerUserId}`);
  console.log(`isClaimed     : ${updated.isClaimed}`);
  console.log(`rating        : ${updated.rating}`);
  console.log(`reviewCount   : ${updated.reviewCount}`);
  console.log(`email         : ${updated.emailDiscovered ?? "—"}`);
  console.log(
    `\nSign in as ${SMB_EMAIL} and visit /(smb)/home + /(smb)/reviews.`,
  );
}

main()
  .catch((err) => {
    console.error("[assign-smb-to-calgary] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
