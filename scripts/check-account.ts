/**
 * Read-only · inspect a freshly-registered account's wallet + credits.
 * Usage: EMAIL=... tsx scripts/check-account.ts   (Viktor 2026-07-09)
 */

import prisma from "@/lib/prisma";

const email = process.env.EMAIL ?? "sarminvictor+st@gmail.com";

async function main() {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      createdAt: true,
      role: true,
      stripeStatus: true,
      stripePlan: true,
    },
  });
  console.log("USER:", user ?? "(not found)");
  if (!user) return;

  const members = await prisma.agencyMember.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      role: true,
      agencyId: true,
      agency: {
        select: {
          id: true,
          name: true,
          plan: true,
          stripeStatus: true,
          slug: true,
        },
      },
    },
  });
  console.log("AGENCY MEMBERSHIPS:", JSON.stringify(members, null, 2));

  for (const m of members) {
    const wallet = await prisma.agencyWallet.findUnique({
      where: { agencyId: m.agencyId },
      select: {
        planCredits: true,
        purchasedCredits: true,
        rolloverCredits: true,
        heldCredits: true,
        updatedAt: true,
      },
    });
    const available = wallet
      ? wallet.planCredits +
        wallet.purchasedCredits +
        wallet.rolloverCredits -
        wallet.heldCredits
      : null;
    console.log(`WALLET (agency ${m.agencyId}):`, wallet ?? "(no wallet)");
    console.log("  → availableCredits =", available);

    const ledger = await prisma.creditLedger.findMany({
      where: { agencyId: m.agencyId },
      orderBy: { createdAt: "asc" },
      select: {
        type: true,
        credits: true,
        runId: true,
        note: true,
        createdAt: true,
      },
      take: 50,
    });
    console.log(
      `  LEDGER (${ledger.length} rows):`,
      JSON.stringify(ledger, null, 2),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
