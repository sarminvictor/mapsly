// modules/discovery/enrich-contacts.ts · the contact/DOM-enrichment orchestrator.
//
// Ties the DOM-fetcher (services/dom-fetcher · the Apify Cloudflare-busting
// browser) to the parser (services/contact-scraper) and the database. ONE
// rendered DOM per business feeds BOTH contacts AND tech ($0 for the second —
// it rides the same fetch). The "fetch once, parse many" principle.
//
// MUST run inside an open CronRun: `fetchDomsForCell` → `runActor` asserts the
// cron context (the "no live API in user request path" invariant). The cron
// route app/api/cron/weekly/contact-enrich/route.ts is the entrypoint.
//
// The load-bearing distinction (mirrors modules/contacts/reachability.ts):
//
//   A BLOCKED/FAILED fetch is NOT "unreachable". It means "we know nothing."
//   We set contactScanStatus = "FAILED" and NEVER hide the business — hiding on
//   a transient Cloudflare block would silently delete reachable businesses
//   from every list. Only a SUCCESSFUL parse with zero reachable channels hides.
//
// Tech denorm note: the Business model has NO `techStack` column (that field
// lives on LighthouseAudit). Per-business tech is persisted as BusinessTech rows
// (one per detected technology) + Business.techScanLastAt, exactly like
// modules/contacts/scan.ts. See the orchestrator-summary report for the rationale.
//
// See:
//   - services/dom-fetcher/fetcher.ts — the Apify DOM fetch (cost-tracked)
//   - services/contact-scraper/parse.ts — pure contact extraction
//   - services/contact-scraper/reachability.ts — pure reachability classifier
//   - services/tech-fingerprint/fingerprint.ts — pure tech fingerprint
//   - modules/discovery/enrich-fresh.ts — isFresh dedup predicate

import pLimit from "p-limit";
import prisma, { Prisma } from "@/lib/prisma";
import { getCurrentCronRun } from "@/lib/cost/cost-counter";
import {
  fetchDomsForCell,
  freeFetchDom,
  CONTACTS_FRESHNESS_DAYS as SCALE_CONTACTS_FRESHNESS_DAYS,
} from "@/services/dom-fetcher";
import {
  parseContacts,
  computeReachability,
  type ParsedContact,
  type ContactChannel,
  type ContactSource,
} from "@/services/contact-scraper";
import { computeHidden } from "@/modules/contacts/reachability";
import {
  fingerprintTech,
  type DetectedTech,
} from "@/services/tech-fingerprint/fingerprint";
import { isFresh } from "@/modules/discovery/enrich-fresh";

/** Contacts are considered fresh for 90 days (per ENRICHMENT_PRICES). Sourced
 *  from services/dom-fetcher/scale.ts (the single config). */
const CONTACTS_FRESHNESS_DAYS = SCALE_CONTACTS_FRESHNESS_DAYS;

/** Parallel plain-fetches in the free pass. The free fetch is $0 + I/O-bound,
 *  so a wide fan-out is safe; this keeps a 1,400-lead cell inside the 300s
 *  function budget (10s-timeout sequential fetches would not). */
const FREE_FETCH_CONCURRENCY = 20;

/** A usable rendered DOM (from the free pass OR the paid actor), keyed by URL. */
interface FetchedDom {
  html: string;
  finalUrl: string;
}

/** Mirror of Prisma `ContactRole` (kept local; the parser sets these). */
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

/** Options for {@link enrichContactsForBusinesses}. */
export interface EnrichContactsOptions {
  /** Override the freshness window (days). Default 90. */
  freshnessDays?: number;
  /** Inject "now" for deterministic tests. Default new Date(). */
  now?: Date;
  /** Re-enrich even fresh businesses (admin "force" path). Default false. */
  force?: boolean;
  /** Residential proxy country for the DOM fetch. Default actor default (US). */
  country?: string;
}

/** What the orchestrator reports back to the cron summary. */
export interface EnrichContactsResult {
  /** Businesses we attempted a fetch+parse for (excludes skippedFresh). */
  processed: number;
  /** Businesses whose parse succeeded (contactScanStatus = OK). */
  succeeded: number;
  /** Businesses whose DOM fetch was blocked/failed (contactScanStatus = FAILED). */
  blocked: number;
  /** Businesses that threw during persistence (isolated, batch continued). */
  failed: number;
  /** Businesses skipped because their contacts are still fresh. */
  skippedFresh: number;
  /** Total Contact rows upserted across the batch. */
  contactsUpserted: number;
  /** Total BusinessTech rows upserted across the batch. */
  techUpserted: number;
  /** Targets whose DOM came from the free plain-fetch path ($0). */
  freeFetched: number;
  /** Targets that fell through to the paid Apify actor (blocked by Cloudflare). */
  actorFetched: number;
  /** Apify USD billed for this batch (also added to CronRun.costUsd). */
  usageTotalUsd: number;
}

/** The subset of Business columns the orchestrator reads — explicit select. */
interface BusinessForEnrich {
  id: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  permanentlyClosed: boolean;
  contactsExtractedAt: Date | null;
  isHidden: boolean;
  enrichmentFreshness: Prisma.JsonValue;
}

/**
 * Enrich a set of businesses' contacts + tech from their rendered homepage DOM.
 * MUST run inside an open CronRun. Failures are isolated per-business — one bad
 * row never aborts the batch.
 */
export async function enrichContactsForBusinesses(
  businessIds: string[],
  opts: EnrichContactsOptions = {},
): Promise<EnrichContactsResult> {
  // Cron-context invariant — external fetch must never run in a user request
  // path. `fetchDomsForCell` would throw too, but failing early is clearer.
  if (!getCurrentCronRun()) {
    throw new Error(
      `[enrichContactsForBusinesses] called outside an open CronRun. ` +
        `Run inside withCronRun(...) — see .claude/rules/cost-discipline.md.`,
    );
  }

  const now = opts.now ?? new Date();
  const freshnessDays = opts.freshnessDays ?? CONTACTS_FRESHNESS_DAYS;

  const empty: EnrichContactsResult = {
    processed: 0,
    succeeded: 0,
    blocked: 0,
    failed: 0,
    skippedFresh: 0,
    contactsUpserted: 0,
    techUpserted: 0,
    freeFetched: 0,
    actorFetched: 0,
    usageTotalUsd: 0,
  };
  if (businessIds.length === 0) return empty;

  const businesses = (await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: {
      id: true,
      website: true,
      domain: true,
      phone: true,
      email: true,
      permanentlyClosed: true,
      contactsExtractedAt: true,
      isHidden: true,
      enrichmentFreshness: true,
    },
  })) as BusinessForEnrich[];

  // ── Pre-flight: filter to fetchable, non-fresh, non-hidden businesses ───────
  let skippedFresh = 0;
  const targets: { business: BusinessForEnrich; url: string }[] = [];
  for (const b of businesses) {
    const website = (b.website ?? "").trim();
    if (!website) continue; // no homepage → nothing to fetch
    if (b.isHidden) continue; // explicitly hidden → never re-fetch
    if (!opts.force && isFresh(b.contactsExtractedAt, freshnessDays, now)) {
      skippedFresh += 1;
      continue;
    }
    targets.push({ business: b, url: homepageUrl(website) });
  }

  if (targets.length === 0) {
    return { ...empty, skippedFresh };
  }

  // ── Pass 1 · FREE plain-fetch every target ($0) ─────────────────────────────
  // ~70% of SMB sites are open and a plain fetch gets their HTML for free. Only
  // the ones a plain fetch can't get (Cloudflare-walled, JS-only, empty) fall
  // through to the paid actor below. byHtml carries the usable DOM per URL,
  // whatever its source; blockedTargets collects the remainder for the actor.
  // Bounded concurrency keeps a 1,400-lead cell well inside the function budget
  // (sequential 10s timeouts would blow the 300s limit on a few hundred URLs).
  const byHtml = new Map<string, FetchedDom>();
  const blockedTargets: typeof targets = [];
  let freeFetched = 0;

  const freeLimit = pLimit(FREE_FETCH_CONCURRENCY);
  const freeOutcomes = await Promise.all(
    targets.map((t) =>
      freeLimit(async () => ({ target: t, free: await freeFetchDom(t.url) })),
    ),
  );
  for (const { target, free } of freeOutcomes) {
    if (!free.blocked && free.html != null) {
      byHtml.set(target.url, { html: free.html, finalUrl: target.url });
      freeFetched += 1;
    } else {
      blockedTargets.push(target);
    }
  }

  // ── Pass 2 · PAID actor for the blocked remainder only ───────────────────────
  let usageTotalUsd = 0;
  let actorFetched = 0;
  if (blockedTargets.length > 0) {
    const fetchResult = await fetchDomsForCell(
      blockedTargets.map((t) => t.url),
      opts.country != null ? { country: opts.country } : {},
    );
    usageTotalUsd = fetchResult.usageTotalUsd;
    for (const r of fetchResult.results) {
      // A successful actor fetch contributes a usable DOM to the merged map.
      if (r.url && !r.failed && !r.blocked && r.html != null) {
        byHtml.set(r.url, { html: r.html, finalUrl: r.finalUrl ?? r.url });
        actorFetched += 1;
      }
    }
  }

  // ── Persist per business · isolate failures ─────────────────────────────────
  let succeeded = 0;
  let blocked = 0;
  let failed = 0;
  let contactsUpserted = 0;
  let techUpserted = 0;

  for (const { business, url } of targets) {
    try {
      const dom = byHtml.get(url);

      // No usable DOM from either path → FAILED (NOT unreachable). The free pass
      // marked it blocked AND the paid actor (if it ran) couldn't clear it.
      if (!dom) {
        await prisma.business.update({
          where: { id: business.id },
          data: {
            contactScanStatus: "FAILED",
            // Advance the cursor — we DID attempt it; don't hammer it next tick.
            contactsExtractedAt: now,
          },
        });
        blocked += 1;
        continue;
      }

      const sourceUrl = dom.finalUrl ?? url;
      const contacts = parseContacts({ html: dom.html, sourceUrl });
      const techs = fingerprintTech({ html: dom.html, finalUrl: sourceUrl });

      const { status: reachability, reachableChannelCount } =
        computeReachability(contacts);

      // Mirror the scan path: only an OK scan with zero reach AND an empty base
      // row hides (computeHidden) — sets a hiddenReason + honors permanently-
      // closed. (Previously hid on reachableChannelCount===0 with no reason.)
      const hidden = computeHidden({
        website: business.website,
        phone: business.phone,
        email: business.email,
        reachableChannelCount,
        contactScanStatus: "OK",
        isPermanentlyClosed: business.permanentlyClosed,
      });

      // ONE transaction per business (~3 statements) instead of N+1 upserts:
      //   1. contact.createMany(skipDuplicates) — new channels only. The
      //      @@unique([businessId,channel,normalizedValue]) makes re-scans a
      //      no-op for existing rows (we keep their original isPrimary +
      //      firstSeenAt; the confidence/lastSeenAt refresh is non-critical and
      //      intentionally skipped — see the helper's note).
      //   2. businessTech delete-then-createMany — BusinessTech has no @@unique,
      //      so we replace the set each scan (idempotent: same DOM → same rows).
      //   3. business.update — reachability + freshness cursors.
      const contactRows = buildContactCreateRows(business.id, contacts, now);
      const techRows = buildTechCreateRows(business.id, techs, now);
      const [createdContacts] = await prisma.$transaction([
        prisma.contact.createMany({
          data: contactRows,
          skipDuplicates: true,
        }),
        prisma.businessTech.deleteMany({ where: { businessId: business.id } }),
        prisma.businessTech.createMany({ data: techRows }),
        prisma.business.update({
          where: { id: business.id },
          data: {
            contactScanStatus: "OK",
            contactsExtractedAt: now,
            reachability,
            reachableChannelCount,
            reachabilityComputedAt: now,
            techScanLastAt: now,
            isHidden: hidden.isHidden,
            hiddenReason: hidden.hiddenReason,
            enrichmentFreshness: mergeFreshness(
              business.enrichmentFreshness,
              now,
            ),
          },
        }),
      ]);
      contactsUpserted += createdContacts.count;
      techUpserted += techRows.length;
      succeeded += 1;
    } catch (err) {
      // Isolate: log + count, never let one business abort the batch.
      console.error(
        JSON.stringify({
          level: "error",
          event: "enrich-contacts.business.failed",
          businessId: business.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      failed += 1;
    }
  }

  return {
    processed: targets.length,
    succeeded,
    blocked,
    failed,
    skippedFresh,
    contactsUpserted,
    techUpserted,
    freeFetched,
    actorFetched,
    usageTotalUsd,
  };
}

// ─── Persistence row-builders (pure · fed to batched createMany) ──────────────

/** A Contact row ready for `prisma.contact.createMany`. */
type ContactCreateRow = Prisma.ContactCreateManyInput;
/** A BusinessTech row ready for `prisma.businessTech.createMany`. */
type TechCreateRow = Prisma.BusinessTechCreateManyInput;

/**
 * Build the Contact createMany rows for a business. PURE — no DB. The FIRST
 * contact seen per channel is marked isPrimary; duplicates within the same scan
 * (same channel+normalizedValue) collapse to the first. `createMany` is called
 * with `skipDuplicates`, so on a RE-scan the @@unique([businessId, channel,
 * normalizedValue]) makes existing rows a no-op — they keep their original
 * isPrimary + firstSeenAt. The confidence/lastSeenAt refresh that the old
 * per-row upsert did is intentionally dropped (non-critical · re-deriving
 * confidence on re-scan adds N writes for no behavioural change).
 */
function buildContactCreateRows(
  businessId: string,
  contacts: readonly ParsedContact[],
  now: Date,
): ContactCreateRow[] {
  const primaryByChannel = new Set<ContactChannel>();
  const seen = new Set<string>();
  const rows: ContactCreateRow[] = [];

  for (const c of contacts) {
    // De-dupe within this scan so createMany doesn't carry two rows that would
    // collide on the @@unique (skipDuplicates handles the DB side, but a
    // duplicate in the same payload still wastes a row).
    const key = `${c.channel} ${c.normalizedValue}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isPrimary = !primaryByChannel.has(c.channel);
    if (isPrimary) primaryByChannel.add(c.channel);

    rows.push({
      businessId,
      channel: c.channel,
      value: c.value,
      normalizedValue: c.normalizedValue,
      role: c.role as ContactRole,
      source: c.source as ContactSource,
      confidence: Math.round(c.confidence),
      isPrimary,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }
  return rows;
}

/**
 * Build the BusinessTech createMany rows for a business. PURE — no DB.
 * BusinessTech has no @@unique, so the orchestrator replaces the whole set per
 * scan (deleteMany → createMany) for idempotency: the same DOM yields the same
 * rows. One row per detected technology (de-duped by name within the scan).
 */
function buildTechCreateRows(
  businessId: string,
  techs: readonly DetectedTech[],
  now: Date,
): TechCreateRow[] {
  const seen = new Set<string>();
  const rows: TechCreateRow[] = [];
  for (const t of techs) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    rows.push({
      businessId,
      name: t.name,
      category: t.category as BusinessTechCategory,
      confidence: t.confidence,
      source: t.source,
      detectedAt: now,
    });
  }
  return rows;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Coerce a (possibly bare) website value into a fetchable absolute https URL. */
function homepageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  return "https://" + trimmed;
}

/**
 * Merge the contacts + tech stamps into the existing enrichmentFreshness Json,
 * preserving any other families' timestamps. Returns a plain JSON object.
 */
function mergeFreshness(
  prev: Prisma.JsonValue,
  now: Date,
): Prisma.InputJsonObject {
  const base: Prisma.InputJsonObject =
    prev && typeof prev === "object" && !Array.isArray(prev)
      ? (prev as Prisma.InputJsonObject)
      : {};
  return {
    ...base,
    contacts: now.toISOString(),
    tech: now.toISOString(),
  };
}

export const __test = {
  CONTACTS_FRESHNESS_DAYS,
  FREE_FETCH_CONCURRENCY,
  homepageUrl,
  mergeFreshness,
  buildContactCreateRows,
  buildTechCreateRows,
};
