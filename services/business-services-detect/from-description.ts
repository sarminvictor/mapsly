/**
 * Layer 3 · derive services from DfS `description` long-form text.
 *
 * `description` is the business's own bio — they wrote it (or filled
 * in their GBP profile). Usually contains an explicit list of
 * services. Example (White Coat Beauty):
 *
 *   "We offer Botox, dermal fillers, biostimulatory and regenerative
 *    treatments, advanced lasers, exosomes, spider vein treatments,
 *    bespoke facials, microneedling, and medical weight-loss programs"
 *
 * Reliability is MEDIUM-HIGH — explicit but may include services the
 * business doesn't currently offer (legacy marketing copy). Use
 * confidence 0.7 so DOM scrape (0.8) beats it when both fire.
 */

import type { ServiceCandidate, ServiceTaxonomyEntry } from "./types";

const FIXED_CONFIDENCE = 0.7;

export function detectFromDescription(
  description: string | null | undefined,
  taxonomy: readonly ServiceTaxonomyEntry[],
): ServiceCandidate[] {
  if (!description || typeof description !== "string") return [];
  if (taxonomy.length === 0) return [];

  const lower = description.toLowerCase();
  const out: ServiceCandidate[] = [];

  for (const entry of taxonomy) {
    let matched: string | null = null;
    for (const syn of entry.synonyms) {
      // Word-boundary match. `\b` handles spaces + punctuation, so
      // `botox.` and `Botox,` both hit but `botoxy` (made-up) won't.
      const re = new RegExp(`\\b${escapeRegex(syn)}\\b`, "i");
      if (re.test(lower)) {
        matched = syn;
        break;
      }
    }
    if (matched) {
      out.push({
        canonicalKey: entry.canonicalKey,
        displayName: entry.displayName,
        group: entry.group,
        confidence: FIXED_CONFIDENCE,
        sourceHint: "auto:description",
        evidence: matched,
      });
    }
  }

  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
