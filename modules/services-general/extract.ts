// modules/services-general/extract.ts · all-category service extraction (§4.7)
//
// Generalizes service detection beyond the med-spa taxonomy to EVERY category.
// Three layers, in confidence order:
//
//   1. Deterministic detectors (reused from services/business-services-detect):
//      place_topics + description matching against the med-spa taxonomy where it
//      applies. ZERO cost. These are the high-confidence base.
//   2. AI open-extraction (gpt-5.4-nano): reads place_topics + description +
//      service-page text and proposes services for ANY vertical — the layer that
//      makes detection category-agnostic. Cost-counted; runs inside a CronRun.
//   3. ServiceTaxonomy resolution: each surface form is normalized to a
//      canonicalKey. The taxonomy SELF-BUILDS — a new surface form is recorded
//      as a "candidate" and PROMOTED to "canonical" once it appears in ≥3
//      businesses (within its category slug).
//
// Output: BusinessService rows tagged with canonicalKey / confidence /
// detectedVia[] / rawNames[]. Idempotent — re-running merges into existing rows
// rather than duplicating.
//
// `recomputeCellServicePrevalence(cellKey)` writes the comparative
// CellServicePrevalence ("X% of the cell offers this") from the cell's
// BusinessService rows.
//
// Hard rules: gpt-5.4-nano ONLY · web_search BANNED (reads DB facts only) ·
// every AI call runs inside an open CronRun (caller wraps withCronRun).

import { z } from "zod";

import prisma, { Prisma } from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import { callOpenAi } from "@/services/ai/client";
import { wrapUntrusted } from "@/services/ai/untrusted";
import type { SupportedModel } from "@/services/ai/pricing";
import {
  detectFromDescription,
  detectFromPlaceTopics,
  pickTaxonomyForCategories,
} from "@/services/business-services-detect";
import type { ServiceCandidate } from "@/services/business-services-detect";

export const SERVICES_GENERAL_MODEL: SupportedModel = "gpt-5.4-nano";

/** A surface form must appear in ≥ this many businesses to become canonical. */
export const PROMOTION_THRESHOLD = 3;

const MAX_SITE_TEXT_CHARS = 4_000;
const MAX_TOPICS = 30;
const MAX_AI_SERVICES = 25;

// ── Canonicalization ─────────────────────────────────────────────────────────

/** Stable snake_case ASCII key from a display name. */
export function canonicalKeyOf(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function titleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── AI open-extraction ───────────────────────────────────────────────────────

const AiServicesSchema = z.object({
  services: z
    .array(
      z.object({
        name: z.string().min(2).max(80),
        group: z.string().min(1).max(60).nullable().default(null),
      }),
    )
    .max(MAX_AI_SERVICES)
    .default([]),
});

interface ExtractFacts {
  businessId: string;
  category: string;
  categories: string[];
  categoryIds: string[];
  description: string;
  topics: string[];
  topicsMap: Record<string, number>;
  siteText: string;
}

function topicsFromJson(raw: Prisma.JsonValue | null): {
  list: string[];
  map: Record<string, number>;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { list: [], map: {} };
  const map: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number") map[k] = v;
  }
  const list = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOPICS)
    .map(([k]) => k);
  return { list, map };
}

async function gatherFacts(businessId: string): Promise<ExtractFacts | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      category: true,
      categories: true,
      categoryIds: true,
      description: true,
      placeTopics: true,
      siteText: true,
    },
  });
  if (!business) return null;
  const { list, map } = topicsFromJson(business.placeTopics);
  return {
    businessId: business.id,
    category: business.category,
    categories: business.categories,
    categoryIds: business.categoryIds,
    description: business.description ?? "",
    topics: list,
    topicsMap: map,
    // A3-feed · prefer the persisted real-website text (menu + positioning copy)
    // over the thin Google one-line description, falling back to it when a scan
    // hasn't run. Concatenated (site text first) + truncated to bound token cost.
    siteText: buildSiteText(business.siteText, business.description),
  };
}

/**
 * A3-feed · assemble the model's "site text" input, preferring the persisted
 * real-website extract (Business.siteText) over the thin Google listing
 * description, concatenating both when present, and truncating to bound the
 * token cost. Returns "" when neither is available.
 */
function buildSiteText(
  siteText: string | null,
  description: string | null,
): string {
  const parts = [siteText?.trim(), description?.trim()].filter(
    (p): p is string => !!p,
  );
  return parts.join("\n\n").slice(0, MAX_SITE_TEXT_CHARS);
}

interface AiService {
  name: string;
  group: string | null;
}

async function extractWithAi(facts: ExtractFacts): Promise<{
  services: AiService[];
  costUsd: number;
}> {
  const prompt = `Return ONE JSON object. No code fences. No prose.
List the concrete SERVICES this business offers (what a customer can buy/book).
Category: ${facts.category}
${facts.topics.length ? `Review topics: ${facts.topics.slice(0, 20).join(", ")}` : ""}
${facts.siteText ? wrapUntrusted(facts.siteText, "Website text") : "Text: (none)"}

Schema: { "services": [ { "name": string, "group": string|null } ] }
- name: a specific service (e.g. "Oil change", "Bridal makeup", "Root canal"). Not the business type.
- group: optional category bucket (e.g. "Maintenance", "Injectables"). null if unsure.
- 0–${MAX_AI_SERVICES} items. Do not invent services not implied by the facts.`;

  const { text, costUsd } = await callOpenAi({
    operation: `ai.services.extract[${SERVICES_GENERAL_MODEL}]`,
    model: SERVICES_GENERAL_MODEL,
    maxTokens: 400,
    system: `You extract a local business's service menu for a business-intelligence platform.`,
    prompt,
    jsonMode: true,
  });

  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: z.infer<typeof AiServicesSchema>;
  try {
    parsed = AiServicesSchema.parse(JSON.parse(stripped));
  } catch {
    // Bad AI output is non-fatal — the deterministic layers still apply.
    return { services: [], costUsd };
  }
  return {
    services: parsed.services.map((s) => ({ name: s.name, group: s.group })),
    costUsd,
  };
}

// ── Merge model ──────────────────────────────────────────────────────────────

interface MergedService {
  canonicalKey: string;
  displayName: string;
  group: string | null;
  confidence: number;
  detectedVia: Set<string>;
  rawNames: Set<string>;
}

/** Highest confidence wins on displayName/group; detectedVia + rawNames union. */
function mergeInto(
  acc: Map<string, MergedService>,
  canonicalKey: string,
  displayName: string,
  group: string | null,
  confidence: number,
  via: string,
  rawName: string,
): void {
  const prev = acc.get(canonicalKey);
  if (!prev) {
    acc.set(canonicalKey, {
      canonicalKey,
      displayName,
      group,
      confidence,
      detectedVia: new Set([via]),
      rawNames: new Set([rawName]),
    });
    return;
  }
  prev.detectedVia.add(via);
  prev.rawNames.add(rawName);
  if (confidence > prev.confidence) {
    prev.confidence = confidence;
    prev.displayName = displayName;
    if (group) prev.group = group;
  } else if (!prev.group && group) {
    prev.group = group;
  }
}

function candidateVia(c: ServiceCandidate): string {
  return c.sourceHint;
}

// ── Public · extract for one business ────────────────────────────────────────

export interface ExtractServicesResult {
  businessId: string;
  created: number;
  updated: number;
  merged: number;
  costUsd: number;
  promotedKeys: string[];
}

/**
 * A4 · stamp the services freshness cursor on a SUCCESSFUL job completion (even
 * a verified-empty extract with 0 services — the job ran, we just found nothing
 * chargeable, which is a valid "fresh" state per the A5 billing invariant). NOT
 * stamped on a transient failure (business-not-found throws before this), so a
 * genuine miss re-runs. A repeat run within 90d is then served from DB at $0.
 */
async function stampServicesFresh(
  businessId: string,
  now: Date,
): Promise<void> {
  await prisma.business.update({
    where: { id: businessId },
    data: { servicesLastAt: now },
  });
}

/**
 * Detect + normalize + persist services for a business across ALL categories.
 * MUST run inside withCronRun (the AI call asserts an open CronRun).
 */
export async function extractServicesForBusiness(
  businessId: string,
  opts?: { skipAi?: boolean; now?: Date },
): Promise<ExtractServicesResult> {
  const now = opts?.now ?? new Date();
  const facts = await gatherFacts(businessId);
  if (!facts) {
    throw new Error(`[services-general] business "${businessId}" not found`);
  }

  const acc = new Map<string, MergedService>();

  // ── Layer 1 · deterministic detectors (taxonomy-bound · high confidence) ────
  const taxonomy = pickTaxonomyForCategories([
    facts.category,
    ...facts.categoryIds,
  ]);
  if (taxonomy.length > 0) {
    const det: ServiceCandidate[] = [
      ...detectFromPlaceTopics(facts.topicsMap, taxonomy),
      ...detectFromDescription(facts.description, taxonomy),
    ];
    for (const c of det) {
      mergeInto(
        acc,
        c.canonicalKey,
        c.displayName,
        c.group,
        c.confidence,
        candidateVia(c),
        c.displayName,
      );
    }
  }

  // ── Layer 2 · AI open-extraction (category-agnostic) ───────────────────────
  let costUsd = 0;
  if (!opts?.skipAi) {
    const ai = await extractWithAi(facts);
    costUsd = ai.costUsd;
    for (const s of ai.services) {
      const key = canonicalKeyOf(s.name);
      if (!key) continue;
      mergeInto(acc, key, titleCase(s.name), s.group, 0.6, "ai:open", s.name);
    }
  }

  if (acc.size === 0) {
    // Verified-empty success: the job ran, found nothing → still fresh (A4).
    await stampServicesFresh(businessId, now);
    return {
      businessId,
      created: 0,
      updated: 0,
      merged: 0,
      costUsd,
      promotedKeys: [],
    };
  }

  // ── Layer 3 · taxonomy resolution + self-building promotion ────────────────
  const categorySlug = (facts.categoryIds[0] ?? facts.category)
    .toLowerCase()
    .trim();
  const merged = Array.from(acc.values());
  const promotedKeys = await resolveTaxonomy(categorySlug, merged);

  // ── Persist · merge into existing BusinessService rows ─────────────────────
  const persisted = await persist(businessId, merged);

  // Successful completion → stamp the freshness cursor (A4).
  await stampServicesFresh(businessId, now);

  return {
    businessId,
    created: persisted.created,
    updated: persisted.updated,
    merged: merged.length,
    costUsd,
    promotedKeys,
  };
}

/**
 * Record each surface form in ServiceTaxonomy and PROMOTE to canonical once it
 * has appeared in ≥ PROMOTION_THRESHOLD businesses (per category slug).
 * Increments occurrences per call (one call = one business observing the key).
 * Returns the keys promoted to "canonical" during this call.
 */
async function resolveTaxonomy(
  categorySlug: string,
  merged: readonly MergedService[],
): Promise<string[]> {
  const promoted: string[] = [];
  for (const m of merged) {
    const existing = await prisma.serviceTaxonomy.findUnique({
      where: {
        categorySlug_canonicalKey: {
          categorySlug,
          canonicalKey: m.canonicalKey,
        },
      },
      select: { id: true, occurrences: true, status: true, synonyms: true },
    });

    if (!existing) {
      const status = PROMOTION_THRESHOLD <= 1 ? "canonical" : "candidate";
      await prisma.serviceTaxonomy.create({
        data: {
          categorySlug,
          canonicalKey: m.canonicalKey,
          displayName: m.displayName,
          group: m.group,
          synonyms: Array.from(m.rawNames),
          status,
          occurrences: 1,
          source: "ai",
        },
      });
      if (status === "canonical") promoted.push(m.canonicalKey);
      continue;
    }

    const nextOccurrences = existing.occurrences + 1;
    const shouldPromote =
      existing.status !== "canonical" && nextOccurrences >= PROMOTION_THRESHOLD;
    const mergedSynonyms = Array.from(
      new Set([...existing.synonyms, ...m.rawNames]),
    );
    await prisma.serviceTaxonomy.update({
      where: { id: existing.id },
      data: {
        occurrences: nextOccurrences,
        synonyms: mergedSynonyms,
        ...(shouldPromote ? { status: "canonical" } : {}),
      },
    });
    if (shouldPromote) promoted.push(m.canonicalKey);
  }
  return promoted;
}

/**
 * Upsert BusinessService rows: merge into an existing row matched by
 * canonicalKey (union detectedVia + rawNames, keep higher confidence) or
 * create a net-new one. Never duplicates a canonicalKey for a business.
 */
async function persist(
  businessId: string,
  merged: readonly MergedService[],
): Promise<{ created: number; updated: number }> {
  const existing = await prisma.businessService.findMany({
    where: { businessId },
    select: {
      id: true,
      canonicalKey: true,
      confidence: true,
      detectedVia: true,
      rawNames: true,
      sortOrder: true,
    },
  });
  const byKey = new Map(
    existing.filter((e) => e.canonicalKey).map((e) => [e.canonicalKey!, e]),
  );
  let nextSort =
    existing.reduce((max, e) => Math.max(max, e.sortOrder), -1) + 1;

  let created = 0;
  let updated = 0;

  for (const m of merged) {
    const prev = byKey.get(m.canonicalKey);
    const detectedVia = Array.from(m.detectedVia);
    const rawNames = Array.from(m.rawNames);
    if (prev) {
      await prisma.businessService.update({
        where: { id: prev.id },
        data: {
          canonicalKey: m.canonicalKey,
          confidence: Math.max(prev.confidence ?? 0, m.confidence),
          detectedVia: Array.from(
            new Set([...prev.detectedVia, ...detectedVia]),
          ),
          rawNames: Array.from(new Set([...prev.rawNames, ...rawNames])),
          ...(m.group ? { category: m.group } : {}),
        },
      });
      updated += 1;
    } else {
      await prisma.businessService.create({
        data: {
          businessId,
          name: m.displayName,
          category: m.group,
          canonicalKey: m.canonicalKey,
          confidence: m.confidence,
          detectedVia,
          rawNames,
          source: "auto:services-general",
          sortOrder: nextSort++,
          isActive: true,
        },
      });
      created += 1;
    }
  }

  return { created, updated };
}

// ── Cell prevalence ──────────────────────────────────────────────────────────

export interface CellServicePrevalenceResult {
  cellKey: string;
  sampleSize: number;
  servicesWritten: number;
}

const MAX_CELL_BUSINESSES = 2_000;

/**
 * Recompute CellServicePrevalence for one cell: for every canonicalKey offered
 * by the cell's businesses, prevalence = (# businesses offering it) / sampleSize.
 * Ranks by prevalence desc. Idempotent upsert per (cellKey, canonicalKey);
 * stale rows for keys no longer present are removed.
 */
export async function recomputeCellServicePrevalence(
  cellKey: string,
  opts?: { now?: Date },
): Promise<CellServicePrevalenceResult> {
  const parsed = parseCellKey(cellKey);
  if (!parsed) {
    throw new Error(
      `[recomputeCellServicePrevalence] malformed cellKey "${cellKey}".`,
    );
  }
  const now = opts?.now ?? new Date();
  const { categorySlug, metroSlug, country } = parsed;

  const businesses = await prisma.business.findMany({
    where: { cellKey, isActive: true },
    take: MAX_CELL_BUSINESSES,
    select: {
      id: true,
      services: {
        where: { isActive: true, canonicalKey: { not: null } },
        select: { canonicalKey: true, name: true },
      },
    },
  });

  const sampleSize = businesses.length;

  // Count distinct businesses per canonicalKey + remember a display name.
  const counts = new Map<string, { count: number; displayName: string }>();
  for (const b of businesses) {
    const seen = new Set<string>();
    for (const s of b.services) {
      const key = s.canonicalKey;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { count: 1, displayName: s.name });
    }
  }

  const ranked = Array.from(counts.entries())
    .map(([canonicalKey, { count, displayName }]) => ({
      canonicalKey,
      displayName,
      prevalence: sampleSize > 0 ? count / sampleSize : 0,
    }))
    .sort((a, b) => b.prevalence - a.prevalence);

  const writtenKeys: string[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    await prisma.cellServicePrevalence.upsert({
      where: {
        cellKey_canonicalKey: { cellKey, canonicalKey: r.canonicalKey },
      },
      create: {
        cellKey,
        category: categorySlug,
        city: metroSlug,
        country,
        canonicalKey: r.canonicalKey,
        displayName: r.displayName,
        prevalence: r.prevalence,
        rank: i + 1,
        sampleSize,
        source: "internal",
        computedAt: now,
      },
      update: {
        category: categorySlug,
        city: metroSlug,
        country,
        displayName: r.displayName,
        prevalence: r.prevalence,
        rank: i + 1,
        sampleSize,
        computedAt: now,
      },
    });
    writtenKeys.push(r.canonicalKey);
  }

  // Drop stale prevalence rows for keys no longer offered in the cell.
  await prisma.cellServicePrevalence.deleteMany({
    where: {
      cellKey,
      canonicalKey: {
        notIn: writtenKeys.length > 0 ? writtenKeys : ["__none__"],
      },
    },
  });

  return { cellKey, sampleSize, servicesWritten: writtenKeys.length };
}
