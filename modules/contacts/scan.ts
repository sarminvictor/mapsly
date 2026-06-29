/**
 * Contact + tech scan orchestrator · Phase 4 (Contacts + reachability gate)
 * and Phase 6-tech (DOM/tech fingerprint).
 *
 * `scanBusinessContacts(businessId)` is the runtime that ties the pure cores to
 * the database. It MUST run inside an open CronRun (it's a worker/cron job, not
 * a user-request-path function — see .claude/rules/cost-discipline.md). The
 * cron-context invariant is enforced via `getCurrentCronRun()`.
 *
 * One homepage fetch, two enrichments:
 *   1. Contacts  — extractContactsFromHtml → upsert Contact rows → reachability
 *                  gate → Business.reachability / contactScanStatus / isHidden.
 *   2. Tech      — fingerprintTech over the SAME HTML+headers → upsert
 *                  BusinessTech rows → Business.techScanLastAt. Free ($0): it
 *                  rides the contacts fetch, no extra network call.
 *
 * The load-bearing distinction (mirrors modules/contacts/reachability.ts):
 *
 *   A FAILED fetch is NOT "unreachable". It means "we know nothing." We set
 *   contactScanStatus = "FAILED" and NEVER hide the business on a failed fetch —
 *   hiding on a transient timeout would silently delete reachable businesses
 *   from every list. Only a SUCCESSFUL scan that found zero reachable channels
 *   (plus the empty base row) hides via computeHidden.
 *
 * See:
 *   - modules/contacts/fetch-site.ts — the one polite fetch
 *   - modules/contacts/extract.ts — pure contact extraction
 *   - modules/contacts/reachability.ts — pure gate (reachability + hide)
 *   - services/tech-fingerprint/fingerprint.ts — pure tech fingerprint
 *   - .claude/rules/prisma.md §scalability — batched upserts, select-only reads
 */

import prisma from "@/lib/prisma";
import { getCurrentCronRun } from "@/lib/cost/cost-counter";

import { extractContactsFromHtml } from "@/modules/contacts/extract";
import type {
  ContactChannel,
  ContactSource,
  ExtractedContact,
} from "@/modules/contacts/extract";
import {
  reachabilityFromContacts,
  computeHidden,
  normalizePhone,
} from "@/modules/contacts/reachability";
import type {
  ReachabilityStatus,
  ContactScanStatus,
} from "@/modules/contacts/reachability";
import { fingerprintTech } from "@/services/tech-fingerprint/fingerprint";
import type { DetectedTech } from "@/services/tech-fingerprint/fingerprint";
import { fetchSiteHtml } from "@/modules/contacts/fetch-site";

/** Mirror of Prisma `ContactRole` (kept local so the module stays pure-ish). */
type ContactRole =
  | "OWNER"
  | "FRONT_DESK"
  | "PERSONAL"
  | "GENERIC"
  | "SUPPORT"
  | "BOOKING"
  | "SOCIAL"
  | "UNKNOWN";

/** Mirror of Prisma `BusinessTechCategory`. */
type BusinessTechCategory =
  | "CMS"
  | "FRAMEWORK"
  | "CDN"
  | "ANALYTICS"
  | "PIXEL"
  | "BOOKING"
  | "CHAT"
  | "ECOMMERCE"
  | "HOSTING"
  | "PAYMENT"
  | "CONSENT"
  | "OTHER";

/** What a single business scan reports back to the caller / cron summary. */
export interface ContactScanSummary {
  readonly businessId: string;
  /** "OK" | "FAILED" — the contactScanStatus we wrote. "SKIPPED" when there's
   *  no website and no DfS contactInfo to work from (left for the DfS path). */
  readonly status: ContactScanStatus | "SKIPPED";
  /** Number of Contact rows upserted this run (0 on FAILED / SKIPPED). */
  readonly contactsUpserted: number;
  /** Number of BusinessTech rows upserted this run. */
  readonly techUpserted: number;
  /** Reachability classification written (null on FAILED / SKIPPED). */
  readonly reachability: ReachabilityStatus | null;
  /** Distinct reachable channel count (0 on FAILED / SKIPPED). */
  readonly reachableChannelCount: number;
  /** Whether the business ended up hidden (always false on FAILED). */
  readonly isHidden: boolean;
}

/** The subset of Business columns the scan reads — explicit select (perf). */
interface BusinessForScan {
  id: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  contactInfo: unknown;
  permanentlyClosed: boolean;
}

/**
 * Map an extracted contact channel to a coarse ContactRole. Social → SOCIAL,
 * booking → BOOKING, everything else (email/phone/whatsapp/website) → UNKNOWN
 * (the role refiner runs later; the scan only needs to persist a sane default).
 */
function roleForChannel(channel: ContactChannel): ContactRole {
  switch (channel) {
    case "FACEBOOK":
    case "INSTAGRAM":
    case "LINKEDIN":
    case "TIKTOK":
    case "YOUTUBE":
    case "X":
    case "YELP":
      return "SOCIAL";
    case "BOOKING_URL":
      return "BOOKING";
    default:
      return "UNKNOWN";
  }
}

/** True when DataForSEO already gave us at least one usable contact channel. */
function hasDfsContactInfo(contactInfo: unknown): boolean {
  if (contactInfo == null) return false;
  if (Array.isArray(contactInfo)) return contactInfo.length > 0;
  if (typeof contactInfo === "object") {
    return Object.keys(contactInfo as Record<string, unknown>).length > 0;
  }
  return false;
}

/**
 * Upsert one Contact row, keyed on the model's @@unique([businessId, channel,
 * normalizedValue]). Re-scans update lastSeenAt + confidence (highest wins);
 * the first scan creates with firstSeenAt = now.
 */
async function upsertContact(
  businessId: string,
  c: ExtractedContact,
): Promise<void> {
  const now = new Date();
  await prisma.contact.upsert({
    where: {
      businessId_channel_normalizedValue: {
        businessId,
        channel: c.channel,
        normalizedValue: c.normalizedValue,
      },
    },
    create: {
      businessId,
      channel: c.channel,
      value: c.value,
      normalizedValue: c.normalizedValue,
      role: roleForChannel(c.channel),
      source: c.source as ContactSource,
      confidence: Math.round(c.confidence),
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      value: c.value,
      lastSeenAt: now,
      confidence: Math.round(c.confidence),
    },
  });
}

/**
 * Upsert one BusinessTech row. The model has no @@unique, so we emulate upsert:
 * find the existing (businessId, name) row → update its confidence/detectedAt,
 * else create. Keeps a single row per detected technology per business.
 */
async function upsertTech(businessId: string, t: DetectedTech): Promise<void> {
  const existing = await prisma.businessTech.findFirst({
    where: { businessId, name: t.name },
    select: { id: true },
  });
  const data = {
    businessId,
    name: t.name,
    category: t.category as BusinessTechCategory,
    confidence: t.confidence,
    source: t.source,
    detectedAt: new Date(),
  };
  if (existing) {
    await prisma.businessTech.update({ where: { id: existing.id }, data });
  } else {
    await prisma.businessTech.create({ data });
  }
}

/**
 * Scan one business: fetch its homepage once, extract contacts + fingerprint
 * tech off the same bytes, then persist + classify. MUST run inside a CronRun.
 *
 * Outcome matrix:
 *   - no website, no DfS contactInfo → SKIPPED (leave for the DfS path).
 *   - no website, has DfS contactInfo → contactScanStatus = "OK" (DfS covers it).
 *   - website + fetch fails           → contactScanStatus = "FAILED" (NEVER hide).
 *   - website + fetch succeeds        → upsert contacts + tech, compute
 *                                       reachability + isHidden, status = "OK".
 */
export async function scanBusinessContacts(
  businessId: string,
): Promise<ContactScanSummary> {
  // Cron-context invariant: external fetches must never run in a user request
  // path. Throwing here matches the cost-counter "no live API" enforcement.
  if (!getCurrentCronRun()) {
    throw new Error(
      `[scanBusinessContacts] called outside an open CronRun. ` +
        `Run inside withCronRun(...) — see .claude/rules/cost-discipline.md.`,
    );
  }

  const business = (await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      website: true,
      phone: true,
      email: true,
      contactInfo: true,
      permanentlyClosed: true,
    },
  })) as BusinessForScan | null;

  if (!business) {
    throw new Error(`[scanBusinessContacts] business not found: ${businessId}`);
  }

  const website = (business.website ?? "").trim();

  // ── No website ────────────────────────────────────────────────────────────
  if (!website) {
    // DfS-listing fallback: a website-less business still has its DfS phone —
    // persist it as a DFS_LISTING Contact so it's reachable (PHONE_ONLY), not
    // silently dropped from every list.
    const dfsPhone = normalizePhone(business.phone ?? "");
    if (dfsPhone) {
      const now = new Date();
      await upsertContact(businessId, {
        channel: "PHONE",
        value: (business.phone ?? "").trim(),
        normalizedValue: dfsPhone,
        source: "DFS_LISTING",
        confidence: 80,
      });
      await prisma.business.update({
        where: { id: businessId },
        data: {
          reachability: "PHONE_ONLY",
          reachableChannelCount: 1,
          reachabilityComputedAt: now,
          contactScanStatus: "OK",
          contactsExtractedAt: now,
          isHidden: false,
          hiddenReason: null,
        },
      });
      return {
        businessId,
        status: "OK",
        contactsUpserted: 1,
        techUpserted: 0,
        reachability: "PHONE_ONLY",
        reachableChannelCount: 1,
        isHidden: false,
      };
    }
    if (hasDfsContactInfo(business.contactInfo)) {
      // DfS has some contact channels but no usable phone — mark OK so the
      // business isn't re-fetched; richer DfS-contactInfo parsing is a follow-up.
      await prisma.business.update({
        where: { id: businessId },
        data: { contactScanStatus: "OK", contactsExtractedAt: new Date() },
      });
      return {
        businessId,
        status: "OK",
        contactsUpserted: 0,
        techUpserted: 0,
        reachability: null,
        reachableChannelCount: 0,
        isHidden: false,
      };
    }
    // Nothing to work from yet — leave contactScanStatus as-is for the DfS path.
    return {
      businessId,
      status: "SKIPPED",
      contactsUpserted: 0,
      techUpserted: 0,
      reachability: null,
      reachableChannelCount: 0,
      isHidden: false,
    };
  }

  // ── Fetch the homepage once ─────────────────────────────────────────────────
  const fetched = await fetchSiteHtml(website);

  // ── Fetch failed → FAILED, NEVER hidden ─────────────────────────────────────
  if (!fetched.ok) {
    // A FAILED scan means "we know nothing" — explicitly do NOT touch isHidden
    // / reachability (FAILED ≠ UNREACHABLE). Only record the failed status so
    // the next tick can retry, and stamp contactsExtractedAt so freshness
    // cursors advance (we did attempt it).
    await prisma.business.update({
      where: { id: businessId },
      data: {
        contactScanStatus: "FAILED",
        contactsExtractedAt: new Date(),
      },
    });
    return {
      businessId,
      status: "FAILED",
      contactsUpserted: 0,
      techUpserted: 0,
      reachability: null,
      reachableChannelCount: 0,
      isHidden: false,
    };
  }

  // ── Fetch succeeded → contacts + tech off the same bytes ────────────────────
  const contacts = extractContactsFromHtml(fetched.html, fetched.finalUrl);
  for (const c of contacts) {
    await upsertContact(businessId, c);
  }

  // Tech enrichment rides the same fetch at $0.
  const techs = fingerprintTech({
    html: fetched.html,
    headers: fetched.headers,
    finalUrl: fetched.finalUrl,
  });
  for (const t of techs) {
    await upsertTech(businessId, t);
  }

  // Reachability classification from the extracted channel mix.
  const { status: reachability, reachableChannelCount } =
    reachabilityFromContacts(contacts);

  const now = new Date();

  // Compute hide AFTER reachability — the OK + zero-reach + empty-base-row case
  // is the only path that hides (computeHidden mirrors the enrichability gate).
  const hidden = computeHidden({
    website: business.website,
    phone: business.phone,
    email: business.email,
    reachableChannelCount,
    contactScanStatus: "OK",
    isPermanentlyClosed: business.permanentlyClosed,
  });

  await prisma.business.update({
    where: { id: businessId },
    data: {
      reachability,
      reachableChannelCount,
      reachabilityComputedAt: now,
      contactScanStatus: "OK",
      contactsExtractedAt: now,
      techScanLastAt: now,
      isHidden: hidden.isHidden,
      hiddenReason: hidden.hiddenReason,
    },
  });

  return {
    businessId,
    status: "OK",
    contactsUpserted: contacts.length,
    techUpserted: techs.length,
    reachability,
    reachableChannelCount,
    isHidden: hidden.isHidden,
  };
}
