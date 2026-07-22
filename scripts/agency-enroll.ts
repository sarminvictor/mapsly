// scripts/agency-enroll.ts
//
// Phase-1 Stage C.2 · Enroll a WAVE of verified agency targets into the
// agency-outreach campaign with per-recipient evidence baked into
// ColdRecipient.context (v0.19.42 token merge).
//
// Hard rules (docs/phase1-pipeline-plan-2026-07-21.html):
//   - businessId stays NULL (asserted) — a non-null id would fire the
//     hardcoded med-spa SMB copy engine in the send cron.
//   - Evidence strings contain business COUNTS + aggregate stats only —
//     never SMB owner contacts (ToS sidestep; contacts live in-product).
//   - Every claim is computed from OUR seeded cells at enroll time — the
//     honesty discipline: only numbers verifiable in the DB.
//   - Market rotation per vertical = disjoint samples across competing
//     agencies (channel-conflict mitigation).
//   - ConsentRecord written per enrollee (script-enroll bypasses
//     enrollCohort, which normally writes it).
//   - Suppression checked before create.
//
// Usage:
//   pnpm tsx scripts/agency-enroll.ts --wave=1 [--dry-run]
//   wave 1 = top 8 medspa + 7 dental by fitScore with deliverable emails.

import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";

import prisma from "@/lib/prisma";
import { isSuppressed } from "@/modules/cold/suppression";
import { cellMembershipWhere } from "@/modules/business-discovery/cell-membership";
import { passesBizIndexGate } from "@/modules/biz-profile/seo-gate";
import {
  AGENCY_CAMPAIGN_NAME,
  AGENCY_STEPS,
  MARKET_PROOFS,
  composeSignalEvidence,
} from "./agency-campaign-config";
import { computeMarketSignalEvidence } from "./agency-signal-evidence";

const ENRICHED = path.join(
  process.cwd(),
  "scripts",
  "data",
  "agency-targets.enriched.json",
);

/** Markets to rotate per vertical — must be seeded cells (tier-1 verified). */
const MARKETS: Record<
  string,
  Array<{ label: string; category: string; city: string; country: string }>
> = {
  dental: [
    {
      label: "Austin's dental market",
      category: "dentist",
      city: "Austin",
      country: "US",
    },
    {
      label: "the Frisco/Plano dental market",
      category: "dentist",
      city: "Frisco",
      country: "US",
    },
    {
      label: "Tampa's dental market",
      category: "dentist",
      city: "Tampa",
      country: "US",
    },
  ],
  medspa: [
    {
      label: "Scottsdale's med spa market",
      category: "medical_spa",
      city: "Scottsdale",
      country: "US",
    },
    {
      label: "Boise's med spa market",
      category: "medical_spa",
      city: "Boise",
      country: "US",
    },
    {
      label: "Miami's med spa market",
      category: "medical_spa",
      city: "Miami",
      country: "US",
    },
  ],
};

interface Target {
  name: string;
  domain: string;
  vertical: string;
  firstName?: string;
  founderName?: string;
  fitScore?: number;
  email: string | null;
  emailVerdict?: string;
}

interface CellEvidence {
  label: string;
  city: string;
  total: number;
  evidenceLine: string;
  cellStats: string;
}

async function computeEvidence(m: {
  label: string;
  category: string;
  city: string;
  country: string;
}): Promise<CellEvidence | null> {
  const loc = await prisma.trackedLocation.findFirst({
    where: {
      city: m.city,
      country: m.country,
      category: { dataforseoId: m.category },
    },
    select: { lat: true, lng: true, radiusKm: true },
  });
  if (!loc) return null;
  const where = cellMembershipWhere({
    dataforseoCategoryId: m.category,
    lat: loc.lat,
    lng: loc.lng,
    radiusKm: loc.radiusKm,
    city: m.city,
    country: m.country,
  });
  const rows = await prisma.business.findMany({
    where: { ...where, isActive: true },
    select: {
      website: true,
      reviewCount: true,
      isHidden: true,
      permanentlyClosed: true,
      suppressedAt: true,
      snapshots: {
        take: 1,
        orderBy: { snapshotDate: "desc" },
        select: { replyRate: true, mapslyScore: true, pillarScore: true },
      },
      lighthouseAudits: {
        take: 1,
        orderBy: { auditedAt: "desc" },
        select: { lcp: true },
      },
    },
    take: 500,
  });
  // Evidence must reflect DEMO-WORTHY businesses only — the same tier-1 gate
  // the product uses to decide what a free agency actually receives.
  const scoredCount = rows.filter((r) =>
    passesBizIndexGate({
      website: r.website,
      reviewCount: r.reviewCount,
      isHidden: r.isHidden,
      permanentlyClosed: r.permanentlyClosed,
      suppressedAt: r.suppressedAt,
      mapslyScore: r.snapshots[0]?.mapslyScore ?? null,
      pillarScore: r.snapshots[0]?.pillarScore ?? null,
    }),
  ).length;
  // Demo-ready floor · vertical-aware. Med spa metros are compact so 20 is a
  // rich claim; a dental metro cell is scoped to a sub-market (Frisco/Plano),
  // where 12 fully-scored practices is an honest, defensible sample.
  const floor = m.category === "dentist" ? 12 : 20;
  if (scoredCount < floor) return null; // not demo-ready — refuse to claim

  // v3 · SIGNAL-based evidence: the product's own signal engine over the
  // tier-1 set, phrased by composeSignalEvidence. Every count is the same
  // verdict the recipient sees in the linked Proof Pack / workbench.
  const sig = await computeMarketSignalEvidence(m.category, m.city);
  if (!sig) return null;
  const composed = composeSignalEvidence(sig);
  if (!composed) return null;
  return {
    label: m.label,
    city: m.city,
    total: sig.total,
    evidenceLine: composed.evidenceLine,
    cellStats: composed.cellStats,
  };
}

/** Role/generic locals that must never become a "first name". */
const NON_NAME_LOCALS = new Set([
  "info",
  "hello",
  "office",
  "contact",
  "support",
  "admin",
  "sales",
  "team",
  "marketing",
  "mail",
  "help",
  "success",
  "growth",
  "hey",
  "hi",
  "new",
  "dev",
  "web",
  "seo",
  "ads",
  "ppc",
  // role-ish/branded locals found in the full-pool audit (2026-07-22) — real
  // published contact addresses of real agencies, but never a person's name.
  "talk",
  "grow",
  "connect",
  "analytics",
  "iwantmore",
  "information",
  "practice",
  "lel",
  // locals that LOOK name-shaped but aren't a first name — fall through to
  // the curated firstName in the data file (Kellen / Ian / Tim).
  "kellenculver",
  "icantle",
  "timh",
]);

/**
 * The person we're emailing is the EMAIL OWNER — so a clean personal name in
 * the local part wins over a separately-scraped founderName (mike@ddsrank.com
 * is Mike, even if the site lists a "Steve"). Only fall back to founderName
 * when the local isn't a usable name (initials, digits, role words).
 */
/** A local part is a plausible first name only if it's 3–12 letters, not a
 *  role word, AND contains a vowel — "bdn"/"jmr" are initials, not names. */
function localLooksLikeName(local: string): boolean {
  return (
    /^[a-z]{3,12}$/.test(local) &&
    !NON_NAME_LOCALS.has(local) &&
    /[aeiouy]/.test(local)
  );
}

function firstNameOf(t: Target): string {
  const local = (t.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (localLooksLikeName(local)) {
    return local[0]!.toUpperCase() + local.slice(1);
  }
  if (t.firstName && !NON_NAME_LOCALS.has(t.firstName.toLowerCase())) {
    return t.firstName;
  }
  if (t.founderName) return t.founderName.split(/\s+/)[0] ?? "there";
  return "there";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const reset = process.argv.includes("--reset");

  const campaign = await prisma.coldCampaign.findFirst({
    where: { name: AGENCY_CAMPAIGN_NAME },
    select: { id: true, status: true },
  });
  if (!campaign)
    throw new Error("campaign missing — run agency-campaign-setup first");
  if (campaign.status === "ACTIVE") {
    throw new Error(
      "campaign is ACTIVE — enroll only while DRAFT/PAUSED (review gate)",
    );
  }

  if (reset && !dryRun) {
    // v2 re-enrollment: wipe DRAFT recipients (ColdSend cascades) and sync the
    // ColdStep rows to the current AGENCY_STEPS. Safe ONLY while DRAFT with 0
    // sent — asserted here.
    const sent = await prisma.coldSend.count({
      where: { recipient: { campaignId: campaign.id }, status: "SENT" },
    });
    if (sent > 0) throw new Error(`refusing reset: ${sent} sends already SENT`);
    const gone = await prisma.coldRecipient.deleteMany({
      where: { campaignId: campaign.id },
    });
    await prisma.coldStep.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.coldStep.createMany({
      data: AGENCY_STEPS.map((s) => ({
        campaignId: campaign.id,
        stepOrder: s.stepOrder,
        delayDays: s.delayDays,
        delayHours: s.delayHours,
        subjectTemplate: s.subjectTemplate,
        bodyTemplate: s.bodyTemplate,
      })),
    });
    console.log(
      `[reset] removed ${gone.count} recipients · steps synced to v2 (${AGENCY_STEPS.length} touches)`,
    );
  }

  const all: Target[] = JSON.parse(fs.readFileSync(ENRICHED, "utf8"));
  const usable = all.filter(
    (t) =>
      t.email &&
      ["deliverable", "inconclusive"].includes(String(t.emailVerdict)),
  );
  // ONE wave = the whole clean pool (Viktor 2026-07-22: "schedule all 44,
  // inside our ramp"). Real-name recipients sort first so the ramp's earliest
  // sends are the most personal ones.
  const hasRealName = (t: Target) => (firstNameOf(t) !== "there" ? 1 : 0);
  const rank = (a: Target, b: Target) =>
    hasRealName(b) - hasRealName(a) || (b.fitScore ?? 0) - (a.fitScore ?? 0);
  const medspa = usable.filter((t) => t.vertical === "medspa").sort(rank);
  const dental = usable.filter((t) => t.vertical === "dental").sort(rank);
  const waveTargets = [...medspa, ...dental];
  console.log(
    `wave: ${medspa.length} medspa + ${dental.length} dental = ${waveTargets.length} (full clean pool)`,
  );

  // Pre-compute evidence per market; refuse markets that aren't demo-ready.
  const evidence: Record<string, CellEvidence[]> = {};
  for (const [vertical, markets] of Object.entries(MARKETS)) {
    evidence[vertical] = [];
    for (const m of markets) {
      const e = await computeEvidence(m);
      if (e) evidence[vertical].push(e);
      else
        console.warn(
          `[evidence] SKIP ${m.label} — not demo-ready (needs >=20 scored)`,
        );
    }
    if (evidence[vertical].length === 0) {
      throw new Error(
        `no demo-ready market for vertical=${vertical} — seed cells first`,
      );
    }
    for (const e of evidence[vertical])
      console.log(`[evidence] ${e.label}: ${e.evidenceLine}`);
  }

  const now = new Date();
  const verticalCounters: Record<string, number> = {};
  let enrolled = 0;
  let skipped = 0;

  for (const t of waveTargets) {
    const email = t.email!.toLowerCase();
    if (await isSuppressed(email)) {
      console.log(`[skip] suppressed: ${email}`);
      skipped++;
      continue;
    }
    // Rotate markets within the vertical → disjoint samples across
    // competing agencies.
    const list = evidence[t.vertical];
    if (!list || list.length === 0) {
      skipped++;
      continue;
    }
    const idx = (verticalCounters[t.vertical] =
      (verticalCounters[t.vertical] ?? 0) + 1);
    const ev = list[(idx - 1) % list.length]!;
    const verticalLabel = t.vertical === "medspa" ? "med spa" : t.vertical;
    const proofs = MARKET_PROOFS[ev.city];
    if (!proofs) {
      console.warn(`[skip] no proof packs for market ${ev.city}: ${email}`);
      skipped++;
      continue;
    }

    const context = {
      firstName: firstNameOf(t),
      agencyName: t.name,
      vertical: verticalLabel,
      marketLabel: ev.label,
      marketCity: ev.city,
      scoredCount: String(ev.total),
      evidenceLine: ev.evidenceLine,
      cellStats: ev.cellStats,
      proofName1: proofs[0].name,
      proofLine1: proofs[0].line,
      proofUrl1: proofs[0].url,
      proofName2: proofs[1].name,
      proofLine2: proofs[1].line,
      proofUrl2: proofs[1].url,
    };

    if (dryRun) {
      console.log(`[dry] ${email} · ${JSON.stringify(context)}`);
      continue;
    }

    try {
      const rec = await prisma.coldRecipient.create({
        data: {
          campaignId: campaign.id,
          businessId: null, // HARD RULE — see header
          email,
          status: "PENDING",
          currentStep: 0,
          nextRunAt: now,
          reportToken: null,
          context,
          sends: {
            create: {
              stepOrder: 0,
              scheduledFor: now,
              idempotencyKey: `${campaign.id}:${email}:0`,
            },
          },
        },
        select: { id: true, businessId: true },
      });
      if (rec.businessId !== null)
        throw new Error("ASSERT businessId=null violated");
      await prisma.consentRecord.create({
        data: {
          email,
          basis: "CONSPICUOUS_PUBLICATION",
          sourceUrl: `https://${t.domain}`,
          relevanceNote:
            "US marketing agency; address published on its own website; message concerns local-market research directly relevant to its client-acquisition role.",
          country: "US",
        },
      });
      enrolled++;
      console.log(`[enrolled] ${t.name} <${email}> · ${ev.label}`);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        skipped++; // already enrolled
        continue;
      }
      throw err;
    }
  }
  console.log(
    `DONE enrolled=${enrolled} skipped=${skipped} (campaign stays ${campaign.status})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`FATAL: ${String(e).slice(0, 500)}`);
    process.exit(1);
  });
