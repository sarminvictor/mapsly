/**
 * Test users seed · creates 3 representative accounts for end-to-end
 * exploration of every audience surface.
 *
 *   - admin · sarminvictor+admin@gmail.com  · User.role = ADMIN
 *   - agency · sarminvictor+agency@gmail.com · Agency owner of
 *     "Test Agency Co" (plan = GROWTH, stripeStatus = active) with a
 *     REVIEW_MANAGEMENT list of 3 leads.
 *   - smb · sarminvictor+smb@gmail.com · SMB owner of a Miami med-spa
 *     (stripeStatus = active) with a fresh BusinessSnapshot so the
 *     dashboard renders real numbers.
 *
 * Gmail's `+` aliases all deliver to sarminvictor@gmail.com so a single
 * inbox receives every magic-link verification email.
 *
 * Idempotent · run `pnpm tsx scripts/seed-test-users.ts` repeatedly;
 * each row is keyed by a stable identifier (email / slug / unique pair)
 * and re-runs leave the data untouched.
 */

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const TEST_USERS = {
  admin: {
    email: "sarminvictor+admin@gmail.com",
    name: "Admin (test)",
    role: "ADMIN" as const,
  },
  agency: {
    email: "sarminvictor+agency@gmail.com",
    name: "Tom (test agency owner)",
    role: "MEMBER" as const,
  },
  smb: {
    email: "sarminvictor+smb@gmail.com",
    name: "Maria (test SMB owner)",
    role: "MEMBER" as const,
  },
};

const TEST_AGENCY = {
  slug: "test-agency-co",
  name: "Test Agency Co",
  plan: "GROWTH" as const,
  defaultMetro: "Miami, FL",
};

const TEST_LIST = {
  name: "Miami med spas · review management",
  serviceType: "REVIEW_MANAGEMENT" as const,
  pitch:
    "Med spas in Miami with low reply rate and 100+ reviews — ripe for a review-management retainer.",
  category: "med_spa",
  metro: "Miami, FL",
  radiusMi: 15,
};

async function main(): Promise<void> {
  console.log("Seeding test users…");

  /* ----------------------------------------------------- users */
  const now = new Date();

  const admin = await prisma.user.upsert({
    where: { email: TEST_USERS.admin.email },
    update: {
      role: TEST_USERS.admin.role,
      name: TEST_USERS.admin.name,
      emailVerified: now,
    },
    create: {
      email: TEST_USERS.admin.email,
      name: TEST_USERS.admin.name,
      role: TEST_USERS.admin.role,
      emailVerified: now,
    },
  });
  console.log(`  ✓ admin · ${admin.email} · ${admin.id}`);

  const agencyUser = await prisma.user.upsert({
    where: { email: TEST_USERS.agency.email },
    update: {
      role: TEST_USERS.agency.role,
      name: TEST_USERS.agency.name,
      emailVerified: now,
    },
    create: {
      email: TEST_USERS.agency.email,
      name: TEST_USERS.agency.name,
      role: TEST_USERS.agency.role,
      emailVerified: now,
    },
  });
  console.log(`  ✓ agency user · ${agencyUser.email} · ${agencyUser.id}`);

  const smbUser = await prisma.user.upsert({
    where: { email: TEST_USERS.smb.email },
    update: {
      role: TEST_USERS.smb.role,
      name: TEST_USERS.smb.name,
      emailVerified: now,
    },
    create: {
      email: TEST_USERS.smb.email,
      name: TEST_USERS.smb.name,
      role: TEST_USERS.smb.role,
      emailVerified: now,
      stripeStatus: "active",
      stripePlan: "smb_paid",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log(`  ✓ smb user · ${smbUser.email} · ${smbUser.id}`);

  /* --------------------------------------------------- agency */
  const agency = await prisma.agency.upsert({
    where: { slug: TEST_AGENCY.slug },
    update: {
      name: TEST_AGENCY.name,
      plan: TEST_AGENCY.plan,
      defaultMetro: TEST_AGENCY.defaultMetro,
      stripeStatus: "active",
      stripePlan: "agency_growth",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    create: {
      slug: TEST_AGENCY.slug,
      name: TEST_AGENCY.name,
      plan: TEST_AGENCY.plan,
      defaultMetro: TEST_AGENCY.defaultMetro,
      categoriesServed: ["med_spa", "restaurant", "auto_body"],
      stripeStatus: "active",
      stripePlan: "agency_growth",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log(`  ✓ agency · ${agency.name} · ${agency.id} · plan=${agency.plan}`);

  const agencyMember = await prisma.agencyMember.upsert({
    where: { agencyId_userId: { agencyId: agency.id, userId: agencyUser.id } },
    update: { role: "OWNER" },
    create: {
      agencyId: agency.id,
      userId: agencyUser.id,
      role: "OWNER",
    },
  });
  console.log(
    `  ✓ agency member · ${agencyMember.role} · ${agencyMember.id}`,
  );

  /* ------------------------------------- SMB owned business */
  const smbBusiness = await prisma.business.findFirst({
    where: {
      city: "Miami",
      category: "med_spa",
      slug: { startsWith: "dev-seed-" },
    },
    orderBy: { reviewCount: "desc" },
    select: { id: true, name: true, slug: true },
  });

  if (!smbBusiness) {
    throw new Error(
      "No dev-seed Miami med_spa business found. Run `pnpm tsx scripts/seed-dev.ts` first.",
    );
  }

  await prisma.business.update({
    where: { id: smbBusiness.id },
    data: { ownerUserId: smbUser.id, isClaimed: true },
  });
  console.log(
    `  ✓ smb business · ${smbBusiness.name} (${smbBusiness.slug}) → owner=${smbUser.email}`,
  );

  /* --------- SMB snapshot so the dashboard renders numbers */
  const snapExists = await prisma.businessSnapshot.findFirst({
    where: { businessId: smbBusiness.id },
    select: { id: true },
  });
  if (!snapExists) {
    await prisma.businessSnapshot.create({
      data: {
        businessId: smbBusiness.id,
        snapshotDate: now,
        rating: 4.4,
        reviewCount: 342,
        replyRate: 0.42,
        photosCount: 28,
        velocityLast30d: 11,
        mapslyScore: 6.2,
        msiRank: 18,
        msiTotal: 40,
        communicationScore: 0.42,
        profileCompletenessScore: 0.78,
      },
    });
    console.log(`  ✓ smb snapshot · mapslyScore=6.2 · MSI #18/40`);
  } else {
    console.log(`  · smb snapshot already exists · skipping`);
  }

  /* ------------------------------------- agency list + leads */
  const leadBusinesses = await prisma.business.findMany({
    where: {
      city: "Miami",
      category: "med_spa",
      slug: { startsWith: "dev-seed-" },
      ownerUserId: null, // don't include the SMB user's claimed business
    },
    take: 3,
    select: { id: true, name: true },
  });

  if (leadBusinesses.length < 3) {
    throw new Error(`Need ≥3 unclaimed Miami med spas; found ${leadBusinesses.length}`);
  }

  let list = await prisma.list.findFirst({
    where: { agencyId: agency.id, name: TEST_LIST.name },
    select: { id: true },
  });
  if (!list) {
    list = await prisma.list.create({
      data: {
        agencyId: agency.id,
        ownerMemberId: agencyMember.id,
        name: TEST_LIST.name,
        serviceType: TEST_LIST.serviceType,
        pitch: TEST_LIST.pitch,
        filterJson: {
          city: "Miami",
          category: "med_spa",
          replyRate: { op: "lt", value: 0.25 },
          reviewCount: { op: "gte", value: 100 },
        },
        category: TEST_LIST.category,
        metro: TEST_LIST.metro,
        radiusMi: TEST_LIST.radiusMi,
        refreshCadence: "WEEKLY",
        lastRefreshedAt: now,
      },
      select: { id: true },
    });
    console.log(`  ✓ agency list · ${TEST_LIST.name} · ${list.id}`);
  } else {
    console.log(`  · agency list already exists · ${list.id}`);
  }

  for (const biz of leadBusinesses) {
    const exists = await prisma.lead.findFirst({
      where: { listId: list.id, businessId: biz.id },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.lead.create({
      data: {
        listId: list.id,
        agencyId: agency.id,
        businessId: biz.id,
        status: "NEW",
        matchScore: 0.7 + Math.random() * 0.25,
      },
    });
    console.log(`     ✓ lead · ${biz.name}`);
  }

  // BusinessSnapshots for lead businesses so the prospect detail page
  // surfaces real numbers instead of empty placeholders.
  for (const biz of leadBusinesses) {
    const snap = await prisma.businessSnapshot.findFirst({
      where: { businessId: biz.id },
      select: { id: true },
    });
    if (snap) continue;
    await prisma.businessSnapshot.create({
      data: {
        businessId: biz.id,
        snapshotDate: now,
        rating: 4.2,
        reviewCount: 150 + Math.floor(Math.random() * 100),
        replyRate: 0.15 + Math.random() * 0.1,
        mapslyScore: 5.5 + Math.random() * 2,
        msiRank: 5 + Math.floor(Math.random() * 20),
        msiTotal: 40,
        communicationScore: 0.15 + Math.random() * 0.1,
        profileCompletenessScore: 0.6 + Math.random() * 0.3,
      },
    });
  }

  /* ------------------------------------------------------- summary */
  console.log("\n────────────────────────────────────────────────");
  console.log("Done. Test users ready:");
  console.log("");
  console.log(`  ADMIN   → ${TEST_USERS.admin.email}`);
  console.log(`  AGENCY  → ${TEST_USERS.agency.email}`);
  console.log(`            agency=${agency.slug} · plan=${agency.plan}`);
  console.log(`            list=${list.id} · ${leadBusinesses.length} leads`);
  console.log(`  SMB     → ${TEST_USERS.smb.email}`);
  console.log(`            business=${smbBusiness.slug}`);
  console.log("");
  console.log("Sign in at /signin · magic link delivered to your Gmail inbox.");
  console.log("────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
