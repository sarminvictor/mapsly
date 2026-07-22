// scripts/agency-fulfill.ts
//
// Flow-2 fulfillment (Viktor 2026-07-22): when an outreach recipient replies
// with their target city, this script does EVERYTHING behind the reply:
//
//   1. Provision (or detect) their agency workspace from the reply email —
//      same provisionAgencyForUser path the signup flow uses, + the free-tier
//      credit grant (idempotent).
//   2. Attach the scored market to the workspace as a ready research:
//      Discovery (READY) + List + Leads over the cell's tier-1 businesses,
//      with CONTACTS entitlements — the same delivery shape "Search
//      everywhere" creates, so the workbench opens it natively.
//   3. Print the summary + a ready-to-send reply text with sign-in steps.
//
// The CELL must already be seeded (scripts/seed-cell.ts) — for a brand-new
// city, seed first, then fulfill. Vertical is inferred from the outreach
// target list by email; override with VERTICAL=dental|medspa.
//
// Usage:
//   EMAIL=founder@agency.com CITY=Austin pnpm tsx scripts/agency-fulfill.ts
//   EMAIL=... CITY=Nashville VERTICAL=dental pnpm tsx scripts/agency-fulfill.ts

import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";

import prisma from "@/lib/prisma";
import { cellMembershipWhere } from "@/modules/business-discovery/cell-membership";
import { passesBizIndexGate } from "@/modules/biz-profile/seo-gate";
import { provisionAgencyForUser } from "@/modules/agency-portal/provision";
import { grantFreeTierIfNew } from "@/modules/cost/server";
import { EVIDENCE_SIGNAL_KEYS } from "./agency-signal-evidence";

const CATEGORY: Record<string, string> = {
  dental: "dentist",
  medspa: "medical_spa",
};

function inferVertical(email: string): string | null {
  try {
    const enriched = JSON.parse(
      fs.readFileSync(
        path.join(
          process.cwd(),
          "scripts",
          "data",
          "agency-targets.enriched.json",
        ),
        "utf8",
      ),
    ) as { email: string | null; vertical: string }[];
    return (
      enriched.find((t) => t.email?.toLowerCase() === email)?.vertical ?? null
    );
  } catch {
    return null;
  }
}

async function main() {
  const email = process.env.EMAIL?.toLowerCase().trim();
  const city = process.env.CITY?.trim();
  if (!email || !city) throw new Error("EMAIL=... CITY=... required");
  const vertical = (
    process.env.VERTICAL ?? inferVertical(email)
  )?.toLowerCase();
  const category = vertical ? CATEGORY[vertical] : null;
  if (!category)
    throw new Error(
      `cannot infer vertical for ${email} — pass VERTICAL=dental|medspa`,
    );

  // ── 1 · the scored market ──
  const loc = await prisma.trackedLocation.findFirst({
    where: { city, country: "US", category: { dataforseoId: category } },
    select: { lat: true, lng: true, radiusKm: true },
  });
  if (!loc)
    throw new Error(
      `cell ${category}|${city} not seeded — run scripts/seed-cell.ts first`,
    );
  const where = cellMembershipWhere({
    dataforseoCategoryId: category,
    lat: loc.lat,
    lng: loc.lng,
    radiusKm: loc.radiusKm,
    city,
    country: "US",
  });
  const rows = await prisma.business.findMany({
    where: { ...where, isActive: true },
    select: {
      id: true,
      cellKey: true,
      website: true,
      reviewCount: true,
      isHidden: true,
      permanentlyClosed: true,
      suppressedAt: true,
      snapshots: {
        take: 1,
        orderBy: { snapshotDate: "desc" },
        select: { mapslyScore: true, pillarScore: true },
      },
    },
    take: 500,
  });
  const tier1 = rows.filter((r) =>
    passesBizIndexGate({
      website: r.website,
      reviewCount: r.reviewCount,
      isHidden: r.isHidden,
      permanentlyClosed: r.permanentlyClosed,
      suppressedAt: r.suppressedAt,
      mapslyScore: r.snapshots[0]?.mapslyScore ?? null,
      pillarScore: r.snapshots[0]?.pillarScore ?? null,
    }),
  );
  if (tier1.length < 10)
    throw new Error(
      `cell ${category}|${city} too thin (${tier1.length} tier-1) — top up seeding first`,
    );
  const cellKeys = Array.from(
    new Set(tier1.map((r) => r.cellKey).filter((k): k is string => !!k)),
  );

  // ── 2 · workspace ──
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });
  const prov = await provisionAgencyForUser(user.id, email);
  if (!prov.agencyId)
    throw new Error(`provisioning refused for ${email} (disposable domain?)`);
  const agencyId = prov.agencyId;
  await grantFreeTierIfNew(agencyId).catch(() => {});
  const member = await prisma.agencyMember.findFirst({
    where: { agencyId, userId: user.id },
    select: { id: true },
  });
  if (!member) throw new Error("membership row missing after provision");

  // ── 3 · attach the research (idempotent per email+cell) ──
  const cityLabel = city[0]!.toUpperCase() + city.slice(1);
  const verticalLabel = vertical === "medspa" ? "med spa" : "dental";
  const idem = `fulfill:${email}:${category}|${city.toLowerCase()}`;
  let discovery = await prisma.discovery.findUnique({
    where: { idempotencyKey: idem },
    select: { id: true },
  });
  let created = false;
  if (!discovery) {
    discovery = await prisma.discovery.create({
      data: {
        agencyId,
        requestedByUserId: user.id,
        name: `${cityLabel} ${verticalLabel} market — scored for you`,
        idempotencyKey: idem,
        status: "READY",
        cellKeys,
        cellCount: cellKeys.length,
        totalBusinesses: tier1.length,
        finishedAt: new Date(),
        signalsJson: {
          goalName: "Full market scan",
          signals: EVIDENCE_SIGNAL_KEYS.map((key) => ({ key })),
        },
      },
      select: { id: true },
    });
    created = true;
  }
  const listName = `${cityLabel} ${verticalLabel} — full market`;
  let list = await prisma.list.findFirst({
    where: { agencyId, discoveryId: discovery.id, name: listName },
    select: { id: true },
  });
  if (!list) {
    list = await prisma.list.create({
      data: {
        agencyId,
        ownerMemberId: member.id,
        name: listName,
        serviceType: "FULL_AUDIT",
        filterJson: {},
        discoveryId: discovery.id,
        isRaw: false,
      },
      select: { id: true },
    });
  }
  const leads = await prisma.lead.createMany({
    data: tier1.map((r) => ({
      listId: list!.id,
      agencyId,
      businessId: r.id,
      status: "NEW" as const,
    })),
    skipDuplicates: true,
  });
  await prisma.agencyEntitlement.createMany({
    data: tier1.map((r) => ({
      agencyId,
      businessId: r.id,
      family: "CONTACTS" as const,
    })),
    skipDuplicates: true,
  });

  // ── 4 · report + reply text ──
  console.log(
    `[fulfill] agency=${agencyId} (${prov.created ? "NEW workspace" : "existing"}) · discovery=${discovery.id} ${created ? "(created)" : "(existing)"} · leads +${leads.count} (total ${tier1.length})`,
  );
  console.log(
    `[fulfill] workbench: /discover/${discovery.id}/lists/${list.id}`,
  );
  console.log(`\n──── suggested reply (paste into the thread) ────\n`);
  console.log(
    `Done — every ${verticalLabel} business in ${cityLabel} is scored and waiting in your workspace: ${tier1.length} businesses with reviews, site speed, search rank, ads and contacts.\n\n` +
      `To open it: go to https://www.mapsly.ai/signin, sign in with this email address (30 seconds, no card), and you'll find "${cityLabel} ${verticalLabel} — full market" in your research.\n\n` +
      `One ask: after you've poked around, tell me bluntly what's useful and what isn't.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`FATAL: ${String(e).slice(0, 400)}`);
    process.exit(1);
  });
