/**
 * Orchestrator · combines all 4 detection layers and persists
 * services to the database.
 *
 * Layer precedence (highest confidence wins on dedup by canonicalKey):
 *
 *   auto:place-topics   confidence 0..1 by review count weight
 *   auto:dom            0.8 (explicit service page)
 *   auto:description    0.7 (self-described in DfS bio)
 *   auto:google         0.5 (curated starter from category map)
 *
 * Persistence rules (mirror monthly:services-detect cron):
 *   - Skip any candidate whose name (case-insensitive) already exists
 *     for the business — active OR inactive. Soft-deleted rows must
 *     block re-creation.
 *   - Skip any candidate that matches a manual edit (source = "manual").
 *   - Never overwrite an existing row. Only INSERT net-new.
 *
 * Returns the count of new rows created — caller can include in the
 * qualification summary or just ignore.
 */

import type { Prisma } from "@/lib/prisma";
import prisma from "@/lib/prisma";

import { suggestServicesFromGoogleCategories } from "./from-google";
import { detectFromDescription } from "./from-description";
import { detectFromPlaceTopics } from "./from-place-topics";
import { scrapeServicesFromWebsite } from "./from-service-pages";
import { pickTaxonomyForCategories } from "./taxonomy-med-spa";
import type { ServiceCandidate, ServiceSourceHint } from "./types";

export interface DetectInput {
  businessId: string;
  website: string | null;
  category: string;
  categories: readonly string[];
  categoryIds: readonly string[];
  description: string | null;
  placeTopics: Prisma.JsonValue | null;
}

export interface DetectResult {
  candidates: ServiceCandidate[];
  created: number;
  skipped: number;
  taxonomyUsed: "med-spa" | "none";
}

/**
 * Run all 4 detection layers + persist net-new rows.
 */
export async function detectAndPersistServices(
  input: DetectInput,
): Promise<DetectResult> {
  const taxonomy = pickTaxonomyForCategories([
    input.category,
    ...input.categoryIds,
  ]);
  const taxonomyUsed = taxonomy.length > 0 ? "med-spa" : "none";

  // ── Layer 1 · Google-category starter list (existing) ────────────
  // We still get a useful fallback for categories outside the taxonomy
  // map · returns SuggestedService[] which we convert to ServiceCandidate.
  const googleHints = suggestServicesFromGoogleCategories(
    input.category,
    Array.from(input.categories),
  );
  const fromGoogle: ServiceCandidate[] = googleHints.map((s) => ({
    canonicalKey: slugifyDisplayName(s.name),
    displayName: s.name,
    group: s.category ?? "Other",
    confidence: 0.5,
    sourceHint: "auto:google" as const,
    evidence: s.sourceHint,
  }));

  // Skip remaining layers when there's no taxonomy for this vertical
  // (other than Layer 1's curated starter list — that one's always
  // useful since it's hand-mapped per category).
  if (taxonomy.length === 0) {
    const created = await persistCandidates(input.businessId, fromGoogle);
    return {
      candidates: fromGoogle,
      created: created.created,
      skipped: created.skipped,
      taxonomyUsed: "none",
    };
  }

  // ── Layer 2 · place_topics ───────────────────────────────────────
  const placeTopicsMap = coerceTopics(input.placeTopics);
  const fromTopics = detectFromPlaceTopics(placeTopicsMap, taxonomy);

  // ── Layer 3 · description ────────────────────────────────────────
  const fromDescription = detectFromDescription(input.description, taxonomy);

  // ── Layer 4 · website service pages ──────────────────────────────
  const fromPages = input.website
    ? (
        await scrapeServicesFromWebsite({
          website: input.website,
          taxonomy,
        })
      ).candidates
    : [];

  // ── Merge · keep the highest-confidence candidate per canonical id ─
  const merged = new Map<string, ServiceCandidate>();
  const allCandidates: ServiceCandidate[] = [
    ...fromGoogle,
    ...fromTopics,
    ...fromDescription,
    ...fromPages,
  ];
  for (const c of allCandidates) {
    const prev = merged.get(c.canonicalKey);
    if (!prev || c.confidence > prev.confidence) merged.set(c.canonicalKey, c);
  }
  const ranked = Array.from(merged.values()).sort(
    (a, b) => b.confidence - a.confidence,
  );

  // ── Persist net-new rows ─────────────────────────────────────────
  const persisted = await persistCandidates(input.businessId, ranked);
  return {
    candidates: ranked,
    created: persisted.created,
    skipped: persisted.skipped,
    taxonomyUsed,
  };
}

/**
 * Insert any candidate whose name doesn't already exist (active OR
 * inactive) for the business. Returns counts.
 */
async function persistCandidates(
  businessId: string,
  candidates: ServiceCandidate[],
): Promise<{ created: number; skipped: number }> {
  if (candidates.length === 0) return { created: 0, skipped: 0 };

  const existing = await prisma.businessService.findMany({
    where: { businessId },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));

  const toCreate = candidates.filter(
    (c) => !existingNames.has(c.displayName.toLowerCase()),
  );
  if (toCreate.length === 0) {
    return { created: 0, skipped: candidates.length };
  }

  const startIdx = existing.length;
  await prisma.businessService.createMany({
    data: toCreate.map((c, i) => ({
      businessId,
      name: c.displayName,
      category: c.group,
      sortOrder: startIdx + i,
      isActive: true,
      source: c.sourceHint as ServiceSourceHint,
    })),
    skipDuplicates: true,
  });

  return {
    created: toCreate.length,
    skipped: candidates.length - toCreate.length,
  };
}

/* ─────────────────────────────────────────────────────── helpers */

function coerceTopics(
  raw: Prisma.JsonValue | null,
): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

function slugifyDisplayName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
