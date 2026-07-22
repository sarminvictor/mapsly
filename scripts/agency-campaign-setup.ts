// scripts/agency-campaign-setup.ts
//
// Phase-1 Stage C.1 · Create the agency-outreach ColdCampaign (status DRAFT —
// nothing sends until Viktor approves the preview + test emails and the
// campaign is flipped ACTIVE).
//
// Copy rules (docs/niche-agency-research-2026-07-21.html §2): 2 touches,
// <80 words, plain text, NO links in touch 1 (and none in touch 2 either —
// the CTA is a reply; the product link goes in Viktor's personal reply),
// teardown-first subject, one binary ask, feedback-not-sale framing.
//
// Personalization tokens come from ColdRecipient.context (v0.19.42):
//   {{firstName}} {{agencyName}} {{vertical}} {{marketLabel}}
//   {{subjectHook}} {{evidenceLine}} {{cellStats}}
// All baked as plain strings at enroll time (scripts/agency-enroll.ts).
// Spintax {{a|b}} varies bodies; tokens stay OUTSIDE spin blocks (engine
// constraint, modules/cold/template.ts).
//
// Usage: pnpm tsx scripts/agency-campaign-setup.ts

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";

import { AGENCY_CAMPAIGN_NAME, AGENCY_STEPS } from "./agency-campaign-config";

async function main() {
  const existing = await prisma.coldCampaign.findFirst({
    where: { name: AGENCY_CAMPAIGN_NAME },
    select: { id: true, status: true },
  });
  if (existing) {
    console.log(
      `campaign exists: ${existing.id} (${existing.status}) — leaving as-is`,
    );
    return;
  }
  const created = await prisma.coldCampaign.create({
    data: {
      name: AGENCY_CAMPAIGN_NAME,
      // status defaults to DRAFT — the send cron only processes ACTIVE.
      locale: "en",
      country: "US",
      sendWindowStartHour: 9,
      sendWindowEndHour: 17,
      sendTimezone: "America/New_York",
      weekdaysOnly: true,
      dailyEnrollCap: 100,
      steps: { create: AGENCY_STEPS },
    },
    select: { id: true, status: true },
  });
  console.log(
    `created campaign ${created.id} · status=${created.status} · steps=${AGENCY_STEPS.length}`,
  );
  console.log(`review/edit in /admin/email/campaigns/${created.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`FATAL: ${String(e).slice(0, 400)}`);
    process.exit(1);
  });
