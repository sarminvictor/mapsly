// Read-only pre-ship check (billing repricing 2026-07-09).
//
// The AGENCY_PRO enum was REPURPOSED: it used to mean the internal $249 · 10-seat
// · 12,000-credit tier; it now means the $49 "Solo" · 1-seat · 750-credit tier.
// Any pre-existing Agency row with plan=AGENCY_PRO would be silently reinterpreted
// (downgraded) at the next grant/seat/depth read. This confirms the live
// population is empty (or lists the rows that need handling) before /ship.
//
// Run: pnpm tsx scripts/check-agency-pro.ts   (SELECT-only, no writes)

import prisma from "@/lib/prisma";

async function main() {
  const byPlan = await prisma.agency.groupBy({
    by: ["plan", "stripeStatus"],
    _count: { _all: true },
  });

  console.log("=== Agency population by (plan, stripeStatus) ===");
  for (const g of byPlan) {
    console.log(
      `${String(g.plan).padEnd(12)} ${String(g.stripeStatus ?? "null").padEnd(
        12,
      )} → ${g._count._all}`,
    );
  }

  const agencyProRows = await prisma.agency.findMany({
    where: { plan: "AGENCY_PRO" },
    select: {
      id: true,
      name: true,
      plan: true,
      stripeStatus: true,
      stripePlan: true,
      currentPeriodEnd: true,
    },
  });

  console.log(`\n=== plan=AGENCY_PRO rows: ${agencyProRows.length} ===`);
  if (agencyProRows.length === 0) {
    console.log("✅ SAFE TO SHIP — no legacy AGENCY_PRO agencies to reprice.");
  } else {
    console.log(
      "⚠ NEEDS HANDLING — these rows will be reinterpreted as $49/750/1-seat:",
    );
    for (const a of agencyProRows) {
      console.log(
        `  ${a.id}  ${a.name}  stripeStatus=${a.stripeStatus}  stripePlan=${a.stripePlan}  periodEnd=${a.currentPeriodEnd?.toISOString() ?? "—"}`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
