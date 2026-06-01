// Rule-bounded AI analysis of a market cell's Meta (Facebook/Instagram) ad
// creatives → a few plain-English observations + suggestions for an SMB owner.
//
// Input: the competitor ad texts (+ format + platforms) in one (category, city)
// cell. Output: a STRICT shape — observations (offers / formats / angles /
// platform) + ≤3 suggestions. The model may only describe patterns PRESENT in
// the provided ads; it must not invent specifics. Maria's voice (no jargon).
//
// Model: gpt-5.4-mini (cheap prose synthesis). Cached 7d on the input set, so a
// cell is analyzed once per refresh, not per business. Cost-tracked + cron-
// context-enforced via callOpenAi (no AI in the user request path).

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";

export const DEFAULT_AD_INSIGHTS_MODEL: SupportedModel = "gpt-5.4-mini";

/** Below this many creatives the market signal is too thin to analyze. */
export const MIN_CREATIVES_TO_ANALYZE = 5;
const MAX_CREATIVES_IN_PROMPT = 18;

// AI extracts only the FUZZY things (service classification + promo/price). The
// deterministic, trustworthy numbers — % video, platform spread, personalized
// gap suggestions — are computed in code (modules/smb-ads), never by the model.
const ServiceCount = z.object({
  /** A service from the provided cell list, or a short label if none fits. */
  service: z.string().min(1).max(60),
  /** How many of the analyzed ads promote it. */
  ads: z.number().int().min(0).max(1000),
});
const Promo = z.object({
  /** What the promo is for, e.g. "Botox", "New-patient special". */
  label: z.string().min(1).max(80),
  /** The offer as worded, e.g. "$199 intro price", "Buy 2 areas get 1 free". */
  offer: z.string().min(1).max(140),
  /** The price if stated in the ad, e.g. "$199" — else null. NEVER invent. */
  price: z.string().max(40).nullable(),
});
export const AdInsightsSchema = z.object({
  serviceMix: z.array(ServiceCount).max(12),
  promos: z.array(Promo).max(8),
});
export type AdServiceCount = z.infer<typeof ServiceCount>;
export type AdPromo = z.infer<typeof Promo>;
export type AdInsightsResult = z.infer<typeof AdInsightsSchema>;

export interface CreativeForAnalysis {
  body: string | null;
  format: string | null;
  platforms: string[];
}

export interface AnalyzeAdCreativesInput {
  category: string;
  city: string;
  /** The cell's known services — the model classifies ads into these first. */
  services: readonly string[];
  creatives: readonly CreativeForAnalysis[];
  model?: SupportedModel;
}

const SYSTEM_PROMPT = `You read competitor Facebook/Instagram ad texts for a local business and extract two factual things. You return ONE JSON object — nothing else. No code fences. No prose.

Rules:
- Base EVERYTHING only on the ad texts provided. NEVER invent prices, offers, or services not present in the ads.
- "serviceMix": classify each ad into the service it promotes. Prefer a service from the KNOWN SERVICES list (match loosely — "lip filler" → "dermal fillers"). If an ad clearly promotes something not on the list, use a short lowercase label. Count how many ads promote each service. One ad → one (best) service.
- "promos": list distinct promotional OFFERS that appear in the ads — a discount, package, intro price, giveaway, or membership. Include the price string ONLY if the ad states it; otherwise price = null. Do not duplicate the same offer.
- If the ads are sparse, return fewer items. Do not guess.

Schema:
{
  "serviceMix": [{ "service": string, "ads": number }],
  "promos": [{ "label": string, "offer": string, "price": string|null }]
}`;

function buildPrompt(input: AnalyzeAdCreativesInput): string {
  const lines = input.creatives
    .filter((c) => (c.body ?? "").trim().length > 0)
    .slice(0, MAX_CREATIVES_IN_PROMPT)
    .map((c, i) => {
      const fmt = c.format ? ` [${c.format}]` : "";
      return `${i + 1}.${fmt} ${(c.body ?? "").replace(/\s+/g, " ").slice(0, 280)}`;
    });
  const services =
    input.services.length > 0
      ? input.services.join(", ")
      : "(none provided — use your own short labels)";
  return `Local ${input.category} ads in ${input.city}.

KNOWN SERVICES (classify into these first): ${services}

Competitor ad texts:
${lines.join("\n")}

Extract serviceMix + promos and return JSON.`;
}

export async function analyzeAdCreativesUncached(
  input: AnalyzeAdCreativesInput,
): Promise<AdInsightsResult> {
  const model = input.model ?? DEFAULT_AD_INSIGHTS_MODEL;
  const { text } = await callOpenAi({
    operation: `ai.ad-insights.analyze[${model}]`,
    model,
    maxTokens: 600,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    jsonMode: true,
  });
  return AdInsightsSchema.parse(safeParseJson(text, "analyzeAdCreatives"));
}

/** Cached 7d on the full input (creatives + model). Cell-level, run once. */
export const analyzeAdCreatives = kvCache(
  "ai:ad-insights:analyze",
  { ttl: 7 * 86_400 },
  analyzeAdCreativesUncached,
);

function safeParseJson(raw: string, op: string): unknown {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `[ai] ${op}: model returned non-JSON. Got: ${stripped.slice(0, 160)} · ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
