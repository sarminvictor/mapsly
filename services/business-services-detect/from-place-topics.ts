/**
 * Layer 2 · derive services from DfS `place_topics`.
 *
 * `place_topics` is a {topic: count} map DfS computes by extracting
 * frequent terms from the business's reviews. Example for a med spa:
 *
 *   { botox: 20, microneedling: 7, fillers: 5, "weight loss": 5,
 *     injector: 7, aesthetic: 10, ... }
 *
 * Each topic key is matched against the taxonomy's synonyms. When a
 * topic matches, its review-count becomes the weight — services that
 * customers mention more often score higher confidence.
 *
 * Reliability is HIGH because review topics reflect actual demand,
 * not what the business markets. A med spa might list 30 services on
 * their site but only see 5 mentioned in reviews — those 5 are what
 * customers actually buy.
 */

import type { ServiceCandidate, ServiceTaxonomyEntry } from "./types";

/** Soft cap on the weight → confidence mapping. 10 mentions = 1.0. */
const FULL_CONFIDENCE_AT = 10;

export function detectFromPlaceTopics(
  placeTopics: Record<string, number> | null | undefined,
  taxonomy: readonly ServiceTaxonomyEntry[],
): ServiceCandidate[] {
  if (!placeTopics || typeof placeTopics !== "object") return [];
  if (taxonomy.length === 0) return [];

  // Lowercase topic keys once · DfS already lowercases but defensive.
  const topics: Array<[string, number]> = Object.entries(placeTopics)
    .filter(([k, v]) => typeof k === "string" && typeof v === "number")
    .map(([k, v]) => [k.toLowerCase().trim(), v]);

  const out: ServiceCandidate[] = [];

  for (const entry of taxonomy) {
    let weight = 0;
    const matchedTopics: string[] = [];

    for (const [topic, count] of topics) {
      for (const syn of entry.synonyms) {
        // `place_topics` keys are typically 1-3 words. Use a substring
        // match — strict word-boundary on these short strings yields
        // ~zero matches.
        if (topic.includes(syn) || syn.includes(topic)) {
          weight += count;
          matchedTopics.push(topic);
          break;
        }
      }
    }

    if (weight > 0) {
      out.push({
        canonicalKey: entry.canonicalKey,
        displayName: entry.displayName,
        group: entry.group,
        confidence: Math.min(1, weight / FULL_CONFIDENCE_AT),
        sourceHint: "auto:place-topics",
        evidence: matchedTopics.join(", "),
      });
    }
  }

  return out;
}
