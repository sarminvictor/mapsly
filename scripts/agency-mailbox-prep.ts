/**
 * Phase-1 Step 0.2 · Prepare the cold-mailbox fleet for a cold restart.
 *
 * The fleet has been idle since ~2026-06-19. `effectiveDailyCap` derives the
 * ramp day from `rampStartedAt` (services/cold-mailer/ramp.ts) — a stale
 * timestamp would grant FULL dailyCap immediately, which is exactly the
 * "unusual sending activity" pattern Zoho's detector flags. The admin action
 * only sets rampStartedAt when it is currently null, so a cold restart needs
 * this direct reset: status ACTIVE, blockedUntil cleared, ramp day 0.
 *
 * Run: pnpm tsx scripts/agency-mailbox-prep.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { syncMailboxesFromEnv } = await import("@/services/cold-mailer");
  const { default: prisma } = await import("@/lib/prisma");

  await syncMailboxesFromEnv();

  const boxes = await prisma.mailbox.findMany({
    select: {
      id: true,
      address: true,
      status: true,
      rampStartedAt: true,
      dailyCap: true,
    },
    orderBy: { address: "asc" },
  });
  console.log(`mailboxes in DB: ${boxes.length}`);

  const reset = await prisma.mailbox.updateMany({
    data: { status: "ACTIVE", blockedUntil: null, rampStartedAt: new Date() },
  });
  console.log(`reset to ACTIVE + ramp day 0: ${reset.count}`);

  const after = await prisma.mailbox.findMany({
    select: {
      address: true,
      status: true,
      rampStartedAt: true,
      dailyCap: true,
    },
    orderBy: { address: "asc" },
  });
  for (const b of after) {
    console.log(
      `${b.address} · ${b.status} · dailyCap=${b.dailyCap} · rampStart=${b.rampStartedAt?.toISOString()}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e).slice(0, 500));
    process.exit(1);
  });
