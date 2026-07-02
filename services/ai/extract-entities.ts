// services/ai/extract-entities.ts
//
// Review entity extraction · NER for staff names + service-mention
// matching in a single LLM call. Used by R.4's backfill cron + R.2's
// pingback handler (optional inline pass) to populate
// Review.mentionedPeople[] and Review.mentionedServices[].
//
// Why one call instead of two:
//   - Halves API cost (~$0.00002 / review at nano pricing)
//   - Halves latency for the backfill cron's 200-row batches
//   - Same review text is in context for both extractions anyway
//
// Per `.claude/rules/cost-discipline.md`, must run inside an open
// CronRun (assertCronContext via callOpenAi).

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";
import { wrapUntrusted } from "@/services/ai/untrusted";

export const DEFAULT_EXTRACT_MODEL: SupportedModel = "gpt-5.4-nano";

export const ExtractEntitiesSchema = z.object({
  /** Names of people mentioned in the review (staff, providers, owners).
   *  Examples: "Sarah", "Dr. Smith", "Nurse Maria". Empty if none. */
  people: z.array(z.string().min(1).max(80)).max(20).default([]),
  /** Services from the input list that were mentioned (exact match against
   *  the canonical service name we passed in). Empty if none. */
  services: z.array(z.string().min(1).max(80)).max(20).default([]),
});
export type ExtractEntitiesResult = z.infer<typeof ExtractEntitiesSchema>;

export interface ExtractEntitiesInput {
  /** Review text — required, non-empty for meaningful extraction. */
  reviewText: string;
  /** Business name (helps disambiguate "Sarah" the owner vs "Sarah" the
   *  reviewer's friend). */
  businessName: string;
  /** Business category — adds vertical context to the prompt
   *  ("Medical Spa" vs "Auto Body"). */
  businessCategory?: string;
  /** Canonical service names from BusinessService rows. Empty array means
   *  service extraction is skipped (result.services will be []). */
  services: string[];
  /** Override the model — used by A/B testing or fallback to mini for
   *  long reviews. */
  model?: SupportedModel;
}

const SYSTEM_PROMPT = `You are a review entity extractor for a local-business intelligence platform.
You return ONE JSON object — nothing else. No code fences. No prose.

Schema:
{
  "people": string[],     // names of PEOPLE mentioned in the review
  "services": string[]    // services from the input list mentioned in the review
}

Rules for "people":
- Extract PROPER NAMES of humans mentioned in the review.
- Include: providers, staff, doctors, nurses, owners, technicians — but ONLY when their PERSONAL NAME is given.
- EXCLUDE: business name, brand names, product names, place names.
- EXCLUDE: generic job titles or roles without a personal name — "receptionist", "manager",
  "owner", "doctor", "nurse", "technician", "staff", "team", "girls", "ladies",
  "front desk" — these are not names. Only return them if attached to a personal
  name (e.g. "Nurse Maria" → return "Nurse Maria"; bare "nurse" → exclude).
- Prefer the CANONICAL form: if the review mentions "Amanda Solar" once and "Amanda" elsewhere,
  return just "Amanda" (the more-common form across the corpus). If only the full form
  appears, return it. Don't fabricate first names from last-name-only mentions.
- Keep titles only when attached to a name: "Dr. Smith", "Nurse Maria", "Sarah" (no title).
- If the same person appears multiple times (e.g. "Sarah was great. Sarah is amazing."),
  return them once.
- Strip trailing punctuation/possessives: "Sarah's" → "Sarah".
- Empty array if no people mentioned by personal name.

Rules for "services":
- Return ONLY services from the canonical list provided in the user message.
- A service is "mentioned" if the review references it directly OR via a
  common synonym (e.g. "got my lips done" → "filler"; "tox" → "botox").
- Use the EXACT spelling from the canonical list — do not invent variations.
- Empty array if no listed services were mentioned.
- Do NOT include the business's category as a service (e.g. "med spa").`;

function buildPrompt(input: ExtractEntitiesInput): string {
  const category = input.businessCategory
    ? `\nCategory: ${input.businessCategory}`
    : "";
  const servicesBlock =
    input.services.length > 0
      ? `\n\nCanonical services for ${input.businessName} (return matching mentions exactly):\n${input.services.map((s) => `- ${s}`).join("\n")}`
      : `\n\nNo canonical services provided — return empty services array.`;

  // WP8-5 · the review body is UNTRUSTED third-party text — a review could
  // contain adversarial instructions. Fence it so the model treats it as data.
  return `Business: ${input.businessName}${category}${servicesBlock}

${wrapUntrusted(input.reviewText, "Review text")}

Extract people + services and return JSON.`;
}

/**
 * Internal · non-cached entrypoint. Exposed for tests and the backfill
 * cron when bypassing KV is desired (rare).
 */
export async function extractReviewEntitiesUncached(
  input: ExtractEntitiesInput,
): Promise<ExtractEntitiesResult> {
  if (!input.reviewText || input.reviewText.trim().length === 0) {
    return { people: [], services: [] };
  }
  if (input.reviewText.length > 4000) {
    // Truncate very long reviews to control input cost. Most Google reviews
    // are < 500 chars; the cutoff is safely past p99.
    input = { ...input, reviewText: input.reviewText.slice(0, 4000) };
  }
  const model = input.model ?? DEFAULT_EXTRACT_MODEL;

  const { text } = await callOpenAi({
    operation: `ai.entities.extract[${model}]`,
    model,
    maxTokens: 512,
    temperature: 0,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    jsonMode: true,
  });

  const parsed = safeParseJson(text);
  const result = ExtractEntitiesSchema.parse(parsed);

  // Post-process · sanitize, dedupe, drop empties, normalize whitespace.
  return {
    people: dedupeInsensitive(result.people.map(normalizeName)).filter(
      (n) => n.length > 0,
    ),
    services: filterToKnownServices(result.services, input.services),
  };
}

/**
 * Public · cached for 30 days on the full input (text + business + services
 * list). Caching at this layer means repeat re-extraction on the same review
 * (e.g. after a service-list edit) does NOT re-bill.
 *
 * Cache key intentionally includes the services list so a Maria edit to her
 * service catalog invalidates relevant entries (cache miss → fresh extraction).
 */
export const extractReviewEntities = kvCache(
  // v2 · 2026-05-26 · stricter prompt excludes role names like
  // "receptionist", "manager" · bumping the key busts old cached
  // results so they re-extract on next call.
  "ai:entities:extract:v2",
  { ttl: 30 * 86_400 },
  extractReviewEntitiesUncached,
);

// ---- Helpers -------------------------------------------------------------

function safeParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `[ai] extractReviewEntities: model returned non-JSON. ` +
        `Got: ${trimmed.slice(0, 200)}${trimmed.length > 200 ? "..." : ""} · ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function normalizeName(raw: string): string {
  // Strip trailing punctuation, possessives, leading/trailing whitespace.
  return raw
    .trim()
    .replace(/['']s$/i, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

function dedupeInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function filterToKnownServices(
  modelOutput: string[],
  canonical: string[],
): string[] {
  if (canonical.length === 0 || modelOutput.length === 0) return [];
  // Build a case-insensitive lookup that preserves canonical spelling.
  const lookup = new Map<string, string>();
  for (const c of canonical) lookup.set(c.toLowerCase(), c);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of modelOutput) {
    const canonicalSpelling = lookup.get(m.toLowerCase().trim());
    if (!canonicalSpelling) continue;
    if (seen.has(canonicalSpelling)) continue;
    seen.add(canonicalSpelling);
    out.push(canonicalSpelling);
  }
  return out;
}
