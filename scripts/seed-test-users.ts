#!/usr/bin/env tsx

/**
 * Idempotent seed for the three canonical test accounts.
 *
 * Run after any `prisma migrate reset` to restore the test users
 * Viktor signs in as while developing locally / in CI:
 *
 *   sarminvictor@gmail.com        · ADMIN   · global root, both portals
 *   sarminvictor+smb@gmail.com    · MEMBER  · SMB portal (Maria)
 *   sarminvictor+agency@gmail.com · MEMBER  · AgencyMember of "Test Agency" (Tom)
 *
 * NextAuth's PrismaAdapter handles real-world User row creation on
 * magic-link sign-in, so these rows go in with `emailVerified` set so
 * the verification gate doesn't require another click.
 *
 * Idempotent: every action is an upsert. Safe to re-run any time.
 *
 * Invoke:
 *   pnpm dotenv -e .env.local -- tsx scripts/seed-test-users.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../lib/generated/prisma/client";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface TestUser {
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
}

const TEST_USERS: readonly TestUser[] = [
  {
    email: "sarminvictor@gmail.com",
    name: "Viktor (admin)",
    role: "ADMIN",
  },
  {
    email: "sarminvictor+smb@gmail.com",
    name: "Maria (SMB)",
    role: "MEMBER",
  },
  {
    email: "sarminvictor+agency@gmail.com",
    name: "Tom (agency)",
    role: "MEMBER",
  },
];

const TEST_AGENCY = {
  name: "Test Agency",
  slug: "test-agency",
  plan: "GROWTH" as const,
};

async function main(): Promise<void> {
  console.log("[seed-test-users] starting");

  // 1. Upsert the three users.
  const users = new Map<string, string>(); // email → id
  for (const u of TEST_USERS) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, emailVerified: new Date() },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        emailVerified: new Date(),
      },
      select: { id: true, email: true, role: true },
    });
    users.set(row.email, row.id);
    console.log(`[seed-test-users] user · ${row.email} · ${row.role}`);
  }

  // 2. Upsert the test agency.
  const agency = await prisma.agency.upsert({
    where: { slug: TEST_AGENCY.slug },
    update: { name: TEST_AGENCY.name, plan: TEST_AGENCY.plan },
    create: {
      name: TEST_AGENCY.name,
      slug: TEST_AGENCY.slug,
      plan: TEST_AGENCY.plan,
    },
    select: { id: true, name: true, plan: true },
  });
  console.log(
    `[seed-test-users] agency · ${agency.name} · plan=${agency.plan}`,
  );

  // 3. Attach the agency test user as OWNER.
  const agencyUserId = users.get("sarminvictor+agency@gmail.com");
  if (!agencyUserId) {
    throw new Error("agency test user missing — upsert above should've run");
  }

  const membership = await prisma.agencyMember.upsert({
    where: {
      agencyId_userId: { agencyId: agency.id, userId: agencyUserId },
    },
    update: { role: "OWNER" },
    create: { agencyId: agency.id, userId: agencyUserId, role: "OWNER" },
    select: { id: true, role: true },
  });
  console.log(
    `[seed-test-users] agency member · sarminvictor+agency@gmail.com · ${membership.role}`,
  );

  console.log("[seed-test-users] done");
}

main()
  .catch((err) => {
    console.error("[seed-test-users] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
