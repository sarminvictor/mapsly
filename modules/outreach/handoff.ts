// modules/outreach/handoff.ts · take approved OutreachDrafts to the next step:
//
//   1. exportDraftsCsv(drafts)        — a CSV for the agency to load into their
//                                       own sender, with a MANDATORY CAN-SPAM
//                                       footer/unsubscribe column on every row.
//   2. enrollInColdCampaign(ids, opts)— hand approved drafts to the existing
//                                       ColdCampaign/ColdRecipient machinery
//                                       (creates recipients; does NOT send).
//
// CAN-SPAM guard (both paths): a draft whose business lacks a physical mailing
// address is REFUSED. A commercial email with no postal address is illegal to
// send, so we never export it and never enroll it — surfacing it as a skip with
// a reason instead of shipping a non-compliant message.
//
// We do NOT send here. enrollInColdCampaign only creates ColdRecipient rows
// (status PENDING) the cold-mailer cron later picks up — same contract as
// modules/cold/enroll.ts.
//
// See:
//   - modules/cold/enroll.ts          — sibling enroller (cohort path) for ref
//   - prisma/schema.prisma            — OutreachDraft / ColdRecipient / ColdSend / ConsentRecord

import prisma from "@/lib/prisma";

/** The subset of an OutreachDraft this module needs. Accepts a full row too. */
export interface ExportableDraft {
  id: string;
  businessId: string;
  channel: string;
  subject?: string | null;
  body: string;
  predictedTier?: string | null;
}

/** A draft joined with the address fields the CAN-SPAM guard needs. */
interface DraftWithBusiness extends ExportableDraft {
  email: string | null;
  businessName: string;
  mailingAddress: string | null;
  reportToken: string | null;
}

/** The five Business fields that compose a physical mailing address. */
interface BusinessAddressBits {
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  email: string | null;
  landingPage: { slug: string; token: string } | null;
}

/**
 * Compose a single-line physical mailing address from a Business, or null if
 * there isn't enough to be CAN-SPAM compliant. We require at minimum a street
 * address; city/province/postal are appended when present.
 */
export function composeMailingAddress(b: BusinessAddressBits): string | null {
  if (!b.address || b.address.trim() === "") return null;
  const parts = [b.address, b.city, b.province, b.postalCode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

const CSV_HEADER = [
  "draftId",
  "businessId",
  "businessName",
  "email",
  "channel",
  "subject",
  "body",
  "predictedTier",
  "mailingAddress",
  "unsubscribeNote",
] as const;

/** Default unsubscribe instruction stamped on every exported row (CAN-SPAM). */
export const DEFAULT_UNSUBSCRIBE_NOTE = "Reply STOP to unsubscribe.";

/** Escape a value for RFC-4180 CSV (quote + double inner quotes). */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export interface ExportCsvOptions {
  /** Overrides the default unsubscribe note in the mandatory column. */
  unsubscribeNote?: string;
}

export interface ExportCsvResult {
  csv: string;
  /** Rows written (compliant drafts). */
  exported: number;
  /** Drafts refused for missing a physical mailing address. */
  skipped: Array<{ draftId: string; reason: "no_mailing_address" }>;
}

/**
 * Export approved drafts to CSV. Every row carries a mandatory unsubscribe note
 * + the physical mailing address column (CAN-SPAM). A draft whose business has
 * no physical address is REFUSED (recorded in `skipped`, never written), so the
 * exported file is always sendable.
 *
 * Resolves each draft's address from its Business. Pass drafts you've already
 * loaded; this only reads the address bits per business.
 */
export async function exportDraftsCsv(
  drafts: ExportableDraft[],
  opts: ExportCsvOptions = {},
): Promise<ExportCsvResult> {
  const unsubNote = opts.unsubscribeNote ?? DEFAULT_UNSUBSCRIBE_NOTE;
  const resolved = await resolveDrafts(drafts);

  const rows: string[] = [CSV_HEADER.map(csvCell).join(",")];
  const skipped: ExportCsvResult["skipped"] = [];
  let exported = 0;

  for (const d of resolved) {
    if (!d.mailingAddress) {
      // CAN-SPAM: refuse to export a commercial email with no postal address.
      skipped.push({ draftId: d.id, reason: "no_mailing_address" });
      continue;
    }
    rows.push(
      [
        d.id,
        d.businessId,
        d.businessName,
        d.email ?? "",
        d.channel,
        d.subject ?? "",
        d.body,
        d.predictedTier ?? "",
        d.mailingAddress,
        unsubNote,
      ]
        .map((v) => csvCell(String(v)))
        .join(","),
    );
    exported++;
  }

  return { csv: rows.join("\n"), exported, skipped };
}

export interface EnrollInColdCampaignOptions {
  campaignId: string;
  /** Country for the ConsentRecord (CASL gate). Defaults to the campaign's. */
  country?: string;
  /** Where the business email was publicly published (consent defense file). */
  consentSourceUrl?: string;
}

export interface EnrollDraftsResult {
  /** Drafts considered. */
  candidates: number;
  /** Recipients created. */
  enrolled: number;
  /** Drafts refused for a missing mailing address (CAN-SPAM). */
  refusedNoAddress: number;
  /** Drafts skipped for other reasons (no email, no landing page, dupe). */
  skipped: number;
  /** Per-draft outcome detail. */
  outcomes: Array<{
    draftId: string;
    status:
      | "enrolled"
      | "refused_no_address"
      | "no_email"
      | "no_landing"
      | "duplicate";
    recipientId?: string;
  }>;
}

/**
 * Hand approved OutreachDraft rows to the cold engine: create a ColdRecipient
 * (+ first ColdSend + ConsentRecord) for each, mirroring modules/cold/enroll.ts.
 * Does NOT send — the cold-mailer cron processes PENDING recipients later.
 *
 * CAN-SPAM guard: a draft whose business has no physical mailing address is
 * REFUSED (never enrolled). Drafts also need a verified email and an active
 * landing page (the report link must resolve), matching the cold MVP eligibility.
 *
 * The campaign country governs the consent basis; defaults to the campaign's
 * own `country`.
 */
export async function enrollInColdCampaign(
  draftIds: string[],
  opts: EnrollInColdCampaignOptions,
): Promise<EnrollDraftsResult> {
  const campaign = await prisma.coldCampaign.findUnique({
    where: { id: opts.campaignId },
    select: { id: true, country: true },
  });
  if (!campaign) {
    throw new Error(`[outreach] cold campaign not found: ${opts.campaignId}`);
  }
  const country = opts.country ?? campaign.country ?? "US";

  const drafts = await prisma.outreachDraft.findMany({
    where: { id: { in: draftIds } },
    select: {
      id: true,
      businessId: true,
      channel: true,
      subject: true,
      body: true,
      predictedTier: true,
    },
  });

  const resolved = await resolveDrafts(drafts);
  const now = new Date();

  const outcomes: EnrollDraftsResult["outcomes"] = [];
  let enrolled = 0;
  let refusedNoAddress = 0;
  let skipped = 0;

  for (const d of resolved) {
    // CAN-SPAM: never enroll a draft we can't legally send.
    if (!d.mailingAddress) {
      refusedNoAddress++;
      outcomes.push({ draftId: d.id, status: "refused_no_address" });
      continue;
    }
    if (!d.email) {
      skipped++;
      outcomes.push({ draftId: d.id, status: "no_email" });
      continue;
    }
    if (!d.reportToken) {
      // No active landing page → the report link would 404. Skip.
      skipped++;
      outcomes.push({ draftId: d.id, status: "no_landing" });
      continue;
    }

    const email = d.email.toLowerCase();
    try {
      const recipient = await prisma.coldRecipient.create({
        data: {
          campaignId: campaign.id,
          businessId: d.businessId,
          email,
          status: "PENDING",
          currentStep: 0,
          nextRunAt: now,
          reportToken: d.reportToken,
          sends: {
            create: {
              stepOrder: 0,
              scheduledFor: now,
              idempotencyKey: `${campaign.id}:${email}:0`,
            },
          },
        },
        select: { id: true },
      });
      await prisma.consentRecord.create({
        data: {
          email,
          businessId: d.businessId,
          basis: "CONSPICUOUS_PUBLICATION",
          sourceUrl: opts.consentSourceUrl,
          relevanceNote:
            "Approved outreach draft; message concerns the recipient's public Google Business Profile.",
          country,
        },
      });
      enrolled++;
      outcomes.push({
        draftId: d.id,
        status: "enrolled",
        recipientId: recipient.id,
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        skipped++; // already enrolled in this campaign (ColdRecipient @@unique)
        outcomes.push({ draftId: d.id, status: "duplicate" });
        continue;
      }
      throw err;
    }
  }

  return {
    candidates: resolved.length,
    enrolled,
    refusedNoAddress,
    skipped,
    outcomes,
  };
}

/**
 * Join each draft with its Business address bits (mailing address, email,
 * landing-page report token). One query for all distinct businesses.
 */
async function resolveDrafts(
  drafts: ExportableDraft[],
): Promise<DraftWithBusiness[]> {
  const businessIds = [...new Set(drafts.map((d) => d.businessId))];
  const businesses = await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      province: true,
      postalCode: true,
      email: true,
      landingPage: { select: { slug: true, token: true } },
    },
  });
  const byId = new Map(businesses.map((b) => [b.id, b]));

  return drafts.map((d) => {
    const b = byId.get(d.businessId);
    const mailingAddress = b ? composeMailingAddress(b) : null;
    const reportToken =
      b?.landingPage != null
        ? `${b.landingPage.slug}-${b.landingPage.token}`
        : null;
    return {
      ...d,
      email: b?.email ?? null,
      businessName: b?.name ?? "",
      mailingAddress,
      reportToken,
    };
  });
}
