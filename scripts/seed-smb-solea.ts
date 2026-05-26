#!/usr/bin/env tsx

/**
 * One-off seed script · claim a real Miami med-spa for the SMB test
 * user and run a real Lighthouse audit so `/(smb)/website` renders with
 * actual data when Viktor signs in as `sarminvictor+smb@gmail.com`.
 *
 * Target: Solea Brickell Spa
 *   - Website: https://soleabrickellspa.com
 *   - Address: 701 S Miami Ave Suite 311A, Miami, FL 33131
 *   - Category: medical_spa
 *   - Source: `_design/landing/data/solea.json` (the reference dossier)
 *
 * What this does:
 *   1. Looks up the `sarminvictor+smb@gmail.com` user · fails fast if
 *      missing.
 *   2. Finds the existing Business owned by Maria (currently the
 *      dev-seed Aurora Wellness) and rewrites it in-place to Solea's
 *      real identity — name, website, address, phone, rating.
 *   3. Wraps `lighthouseFullAudit` in `withCronRun("manual:lighthouse-
 *      seed-solea")` so the DataForSEO cost is tracked + the audit
 *      runs under the canonical cron context (no "live API in user
 *      path" violation).
 *   4. Persists the result via `toPersistRow` → `LighthouseAudit`.
 *
 * Cost: one DataForSEO `on_page.lighthouse_live.json` call · $0.06.
 * Logged to `CronRun.costUsd` under job `manual:lighthouse-seed-solea`.
 *
 * Env: needs `DATABASE_URL`, `DATAFORSEO_USERNAME`, `DATAFORSEO_PASSWORD`
 * in `.env.local`. The script falls back from `DATAFORSEO_USERNAME` to
 * `DATAFORSEO_LOGIN` so it works with either name (matches the local
 * dev env's convention).
 *
 * Run:
 *   pnpm tsx scripts/seed-smb-solea.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// Bridge the env-var name mismatch: the adapter reads
// `DATAFORSEO_USERNAME`; `.env.local` historically used
// `DATAFORSEO_LOGIN`. Set USERNAME from LOGIN if needed BEFORE any
// downstream module reads `process.env`.
if (!process.env.DATAFORSEO_USERNAME && process.env.DATAFORSEO_LOGIN) {
  process.env.DATAFORSEO_USERNAME = process.env.DATAFORSEO_LOGIN;
}

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../lib/generated/prisma/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import { lighthouseFullAudit, toPersistRow } from "@/services/lighthouse";
import { suggestServicesFromGoogleCategories } from "@/services/business-services-detect/from-google";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const TARGET_EMAIL = "sarminvictor+smb@gmail.com";

// Solea Brickell Spa identity · pulled from `_design/landing/data/solea.json`.
const SOLEA = {
  name: "Solea Brickell Spa",
  website: "https://soleabrickellspa.com",
  address: "701 S Miami Ave Suite 311A",
  city: "Miami",
  province: "FL",
  postalCode: "33131",
  country: "US",
  phone: "+1-786-418-4515",
  category: "medical_spa",
  rating: 4.4,
  reviewCount: 342,
} as const;

async function main(): Promise<void> {
  // 1. Resolve the SMB test user.
  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    throw new Error(
      `[seed-smb-solea] No User row for ${TARGET_EMAIL}. Sign in once on prod first to mint the row.`,
    );
  }
  console.log(`[seed-smb-solea] user: ${user.email} · role=${user.role}`);

  // 2. Upsert the Solea business and own it as the SMB user.
  //
  // We key on the slug (unique) so re-runs are idempotent. If a row
  // already exists for this slug we just update the identity fields
  // and re-assert ownership; otherwise we create the row from scratch.
  const business = await prisma.business.upsert({
    where: { slug: "solea-brickell-spa" },
    update: {
      name: SOLEA.name,
      website: SOLEA.website,
      address: SOLEA.address,
      city: SOLEA.city,
      province: SOLEA.province,
      postalCode: SOLEA.postalCode,
      country: SOLEA.country,
      phone: SOLEA.phone,
      category: SOLEA.category,
      rating: SOLEA.rating,
      reviewCount: SOLEA.reviewCount,
      isClaimed: true,
      isActive: true,
      ownerUserId: user.id,
    },
    create: {
      slug: "solea-brickell-spa",
      name: SOLEA.name,
      website: SOLEA.website,
      address: SOLEA.address,
      city: SOLEA.city,
      province: SOLEA.province,
      postalCode: SOLEA.postalCode,
      country: SOLEA.country,
      phone: SOLEA.phone,
      category: SOLEA.category,
      rating: SOLEA.rating,
      reviewCount: SOLEA.reviewCount,
      isClaimed: true,
      isActive: true,
      ownerUserId: user.id,
    },
    select: { id: true, name: true, website: true, slug: true },
  });
  console.log(
    `[seed-smb-solea] business · ${business.name} (${business.id}) · owner=${user.email}`,
  );

  // 2b. Seed starter services from the Google category mapping so
  // /my-business shows something real on first visit. Idempotent: if a
  // service with the same name already exists (active or inactive) we
  // skip it — matches the monthly auto-detect cron's behaviour.
  const suggestions = suggestServicesFromGoogleCategories(SOLEA.category, []);
  if (suggestions.length > 0) {
    const existing = await prisma.businessService.findMany({
      where: { businessId: business.id },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));
    const toCreate = suggestions.filter(
      (s) => !existingNames.has(s.name.toLowerCase()),
    );
    if (toCreate.length > 0) {
      await prisma.businessService.createMany({
        data: toCreate.map((s, idx) => ({
          businessId: business.id,
          name: s.name,
          category: s.category,
          sortOrder: idx,
          isActive: true,
          source: "auto:google",
        })),
        skipDuplicates: true,
      });
      console.log(
        `[seed-smb-solea] services · seeded ${toCreate.length} starter services (${toCreate.map((s) => s.name).join(", ")})`,
      );
    } else {
      console.log(
        `[seed-smb-solea] services · already present (skipped ${suggestions.length} suggestions)`,
      );
    }
  }

  // 3. Lighthouse audit is OPT-IN — it costs $0.06 per run. Set
  // `RUN_LIGHTHOUSE=1` to include it; default skips and just claims
  // the business so dev/CI can run without hitting DataForSEO.
  if (process.env.RUN_LIGHTHOUSE !== "1") {
    console.log(
      `[seed-smb-solea] skipping Lighthouse audit (set RUN_LIGHTHOUSE=1 to enable · $0.06 per run)`,
    );
    console.log(
      `[seed-smb-solea] done · sign in as ${TARGET_EMAIL} and visit /home to see ${SOLEA.name}.`,
    );
    return;
  }

  console.log(
    `[seed-smb-solea] starting Lighthouse audit against ${SOLEA.website} …`,
  );
  const audit = await withCronRun("manual:lighthouse-seed-solea", async () => {
    return lighthouseFullAudit({
      url: SOLEA.website,
      nap: {
        name: SOLEA.name,
        address: `${SOLEA.address}, ${SOLEA.city}, ${SOLEA.province} ${SOLEA.postalCode}`,
        phone: SOLEA.phone,
      },
    });
  });

  console.log(
    `[seed-smb-solea] audit done · partial=${audit.partial} ` +
      `lighthouse-leg-ok=${audit.legs.lighthouseOk} dom-leg-ok=${audit.legs.domOk}` +
      (audit.legs.lighthouseError
        ? ` · lhError=${audit.legs.lighthouseError}`
        : "") +
      (audit.legs.domError ? ` · domError=${audit.legs.domError}` : ""),
  );
  console.log(
    `[seed-smb-solea] scores · performance=${audit.scores.performance ?? "—"} ` +
      `seo=${audit.scores.seo ?? "—"} lcpMs=${audit.scores.lcpMs ?? "—"} ` +
      `tbtMs=${audit.scores.tbtMs ?? "—"} cls=${audit.scores.cls ?? "—"}`,
  );
  console.log(
    `[seed-smb-solea] dom · localBusinessSchema=${audit.domChecks.hasLocalBusinessSchema} ` +
      `faqSchema=${audit.domChecks.hasFaqSchema} ` +
      `bookingCta=${audit.domChecks.hasBookingCtaAboveFold} ` +
      `phoneAboveFold=${audit.domChecks.hasPhoneAboveFold} ` +
      `nap=${audit.domChecks.napConsistent}`,
  );

  // 4. Persist via the canonical helper. `toPersistRow` includes a
  // `rawJson` field that the current `LighthouseAudit` Prisma model
  // doesn't carry (the column was never added) — strip it before the
  // create. Followup: add `rawJson Json?` to the model OR drop it from
  // `toPersistRow`; tracking as a separate cleanup.
  const { rawJson: _ignored, ...row } = toPersistRow(audit, business.id);
  const created = await prisma.lighthouseAudit.create({
    data: row,
    select: { id: true, auditedAt: true },
  });
  console.log(
    `[seed-smb-solea] LighthouseAudit row created: ${created.id} @ ${created.auditedAt.toISOString()}`,
  );

  console.log(
    `[seed-smb-solea] done · sign in as ${TARGET_EMAIL} and visit /website to see the result.`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-smb-solea] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
