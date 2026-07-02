#!/usr/bin/env tsx
/**
 * TEMP · E2E provisioning — attaches the freshly-registered test user to a
 * free-tier agency (the missing self-service agency-onboarding step). Delete
 * after the prod E2E. Idempotent upserts.
 *
 *   pnpm dotenv -e .env.local -- tsx scripts/e2e-provision-agency.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const EMAIL = "sarminvictor+e2etest@gmail.com";
const AGENCY = { name: "E2E Test Agency", slug: "e2e-test-agency" };

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, email: true, role: true },
  });
  if (!user) throw new Error(`user ${EMAIL} not found — register first`);
  console.log(`[e2e] user ${user.email} (${user.id}) role=${user.role}`);

  const agency = await prisma.agency.upsert({
    where: { slug: AGENCY.slug },
    update: { name: AGENCY.name },
    create: { name: AGENCY.name, slug: AGENCY.slug }, // plan defaults SOLO, no stripeStatus = free
    select: { id: true, name: true, plan: true, stripeStatus: true },
  });
  console.log(
    `[e2e] agency ${agency.name} (${agency.id}) plan=${agency.plan} stripeStatus=${agency.stripeStatus}`,
  );

  const member = await prisma.agencyMember.upsert({
    where: { agencyId_userId: { agencyId: agency.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { agencyId: agency.id, userId: user.id, role: "OWNER" },
    select: { id: true, role: true },
  });
  console.log(`[e2e] member ${member.id} role=${member.role}`);
  console.log("[e2e] done — user can now reach /discover");
}

main()
  .catch((e) => {
    console.error("[e2e] failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
