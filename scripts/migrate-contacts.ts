/**
 * scripts/migrate-contacts.ts · one-off backfill of legacy single-value contact
 * fields (Business.email/phone/instagramHandle/contactInfo) into the new
 * normalized Contact table (Phase 4). Idempotent — re-runnable; every Contact is
 * upserted on its @@unique([businessId, channel, normalizedValue]).
 *
 * It also recomputes the INFORMATIONAL reachability summary (status + channel
 * count) from the resulting contacts, but deliberately does NOT touch
 * `contactScanStatus` or `isHidden` — those are owned by the real DOM
 * `scanBusinessContacts` worker (a legacy field migration is NOT a successful
 * scan, and FAILED/PENDING ≠ UNREACHABLE per .claude/rules + §4.5).
 *
 * Usage:
 *   pnpm dotenv -e .env.local -- tsx scripts/migrate-contacts.ts            # apply
 *   pnpm dotenv -e .env.local -- tsx scripts/migrate-contacts.ts --dry-run  # count only
 */

import prisma from "@/lib/prisma";
import type { ContactChannel, ContactSource } from "@/modules/contacts/extract";
import { reachabilityFromContacts } from "@/modules/contacts/reachability";
import { legacyContactRows } from "@/modules/contacts/legacy-contacts";

const BATCH = 200;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  let cursor: string | undefined;
  let scanned = 0;
  let withLegacy = 0;
  let contactsUpserted = 0;
  let businessesUpdated = 0;

  for (;;) {
    const businesses = await prisma.business.findMany({
      where: {
        OR: [
          { email: { not: null } },
          { phone: { not: null } },
          { instagramHandle: { not: null } },
        ],
      },
      select: {
        id: true,
        email: true,
        phone: true,
        instagramHandle: true,
        contactInfo: true,
      },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (businesses.length === 0) break;
    cursor = businesses[businesses.length - 1].id;

    for (const b of businesses) {
      scanned++;
      const rows = legacyContactRows(b);
      if (rows.length === 0) continue;
      withLegacy++;

      if (dryRun) {
        contactsUpserted += rows.length;
        continue;
      }

      const now = new Date();
      for (const r of rows) {
        await prisma.contact.upsert({
          where: {
            businessId_channel_normalizedValue: {
              businessId: b.id,
              channel: r.channel as ContactChannel,
              normalizedValue: r.normalizedValue,
            },
          },
          create: {
            businessId: b.id,
            channel: r.channel as ContactChannel,
            value: r.value,
            normalizedValue: r.normalizedValue,
            source: r.source as ContactSource,
            confidence: 40, // legacy provenance · medium-low
            firstSeenAt: now,
            lastSeenAt: now,
          },
          update: { lastSeenAt: now },
        });
        contactsUpserted++;
      }

      const allContacts = await prisma.contact.findMany({
        where: { businessId: b.id },
        select: { channel: true },
      });
      const summary = reachabilityFromContacts(allContacts);
      await prisma.business.update({
        where: { id: b.id },
        data: {
          reachability: summary.status,
          reachableChannelCount: summary.reachableChannelCount,
          reachabilityComputedAt: now,
          contactsExtractedAt: now,
        },
      });
      businessesUpdated++;
    }

    console.log(
      `… scanned ${scanned} · withLegacy ${withLegacy} · contacts ${contactsUpserted} · businesses ${businessesUpdated}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        done: true,
        dryRun,
        scanned,
        withLegacy,
        contactsUpserted,
        businessesUpdated,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
