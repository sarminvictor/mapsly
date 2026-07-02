#!/usr/bin/env tsx
/**
 * One-off cleanup · purge the junk contact rows the old extractor wrote, then
 * recompute reachableChannelCount. Reuses the EXACT new validators from
 * modules/contacts/extract.ts so "what gets deleted" == "what the new scanner
 * would reject":
 *
 *   - PHONE rows whose value no longer passes NANP validation (normalizePhone
 *     → null): the ~90% junk (timestamps/ids/prices grabbed as phones).
 *   - EMAIL rows that are now junk (isJunkEmail): Wix-Sentry hashes, placeholders.
 *
 * After deletion, reachableChannelCount is recomputed per affected business as
 * the number of DISTINCT channels that still have ≥1 contact (so a business
 * that read "RICH" on 108 fake phones drops to its true reachability).
 *
 * Safety: DRY-RUN by default (counts what WOULD be deleted). Pass --confirm.
 *
 *   pnpm dotenv -e .env.local -- tsx scripts/cleanup-junk-contacts.ts
 *   pnpm dotenv -e .env.local -- tsx scripts/cleanup-junk-contacts.ts --confirm
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../lib/generated/prisma/client";
import { normalizePhone, isJunkEmail } from "../modules/contacts/extract";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CHUNK = 1000;
function chunk<T>(a: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  console.log(
    `[cleanup-junk-contacts] mode=${confirm ? "EXECUTE" : "DRY-RUN"}`,
  );

  // Only channels the extractor validates can be junk here. Scan PHONE + EMAIL.
  const candidates = await prisma.contact.findMany({
    where: { channel: { in: ["PHONE", "EMAIL"] } },
    select: { id: true, businessId: true, channel: true, value: true },
  });
  console.log(`Scanning ${candidates.length} PHONE/EMAIL contacts…`);

  const junkIds: string[] = [];
  const affected = new Set<string>();
  let junkPhones = 0;
  let junkEmails = 0;
  for (const c of candidates) {
    const junk =
      c.channel === "PHONE"
        ? normalizePhone(c.value) === null
        : isJunkEmail(c.value);
    if (!junk) continue;
    junkIds.push(c.id);
    affected.add(c.businessId);
    if (c.channel === "PHONE") junkPhones += 1;
    else junkEmails += 1;
  }

  console.log(
    `Junk found: ${junkPhones} phones + ${junkEmails} emails = ${junkIds.length} rows across ${affected.size} businesses.`,
  );

  if (junkIds.length === 0) {
    console.log("Nothing to clean.");
    return;
  }

  if (!confirm) {
    console.log(
      `\nDRY-RUN — nothing deleted. Re-run with --confirm.\nSample junk phones:`,
    );
    const sample = candidates
      .filter((c) => c.channel === "PHONE" && normalizePhone(c.value) === null)
      .slice(0, 8);
    for (const c of sample) console.log(`  ${JSON.stringify(c.value)}`);
    return;
  }

  // Delete the junk rows in chunks.
  let deleted = 0;
  for (const ids of chunk(junkIds, CHUNK)) {
    const r = await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    deleted += r.count;
  }
  console.log(`Deleted ${deleted} junk contact rows.`);

  // Recompute reachableChannelCount for every affected business.
  let recomputed = 0;
  for (const businessId of affected) {
    const remaining = await prisma.contact.findMany({
      where: { businessId },
      select: { channel: true },
      distinct: ["channel"],
    });
    await prisma.business.update({
      where: { id: businessId },
      data: { reachableChannelCount: remaining.length },
    });
    recomputed += 1;
  }
  console.log(
    `Recomputed reachableChannelCount for ${recomputed} businesses.\n✓ Done.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
