// scripts/agency-comp.ts
//
// The REPLY playbook's one command. When an outreach recipient replies "send
// it", they sign up free at mapsly.ai (agency track), then Viktor runs:
//
//   EMAIL=founder@agency.com pnpm tsx scripts/agency-comp.ts
//
// which comps their workspace as a design partner:
//   - stripeStatus 'active' + plan GROWTH → Target mode unlocks, so the
//     already-seeded market opens at $0 vendor cost; CSV contact export
//     unlocks too.
//   - +250 purchased credits (never-expiring bucket; NOT planCredits, which a
//     later Stripe webhook would overwrite) via grantTopUpCredits — writes the
//     CreditLedger row so usage views stay consistent.
//
// Idempotent per email (dedupeKey ties the grant to the address).

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { grantTopUpCredits } from "@/modules/cost/server";

const COMP_CREDITS = 250;

async function main() {
  const email = process.env.EMAIL?.toLowerCase();
  if (!email) throw new Error("EMAIL=... required");

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      agencyMembers: {
        select: { agency: { select: { id: true, name: true, plan: true } } },
      },
    },
  });
  const agency = user?.agencyMembers[0]?.agency;
  if (!agency) {
    throw new Error(
      `${email} has no agency workspace yet — they must sign up at mapsly.ai (agency track) first`,
    );
  }

  await prisma.agency.update({
    where: { id: agency.id },
    data: { stripeStatus: "active", plan: "GROWTH" },
  });
  await grantTopUpCredits(
    agency.id,
    COMP_CREDITS,
    0,
    `design-partner-comp:${email}`,
  );
  console.log(
    `[comp] ${agency.name} (${agency.id}) → GROWTH/active + ${COMP_CREDITS} credits. ` +
      `They can now open Discover → Target mode → the seeded market.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
