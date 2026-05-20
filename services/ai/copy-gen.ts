// One-pager + pitch-block copy generation.
//
// Input: a business profile + 4 "why this lead qualifies" pitch wedges
// (signal evidence). Output: short marketing prose suitable for an agency's
// PDF one-pager (per Phase 5 task 5.3 / agency UX rules).
//
// Model: defaults to gpt-5.4-mini (tone-sensitive). nano is exposed for
// A/B testing.
//
// NOT cached — each one-pager is bespoke and ships to a PDF the agency sends.
// The caller (on-demand cron handler) is expected to gate regeneration
// behind a UI action and accept the cost.

import { z } from "zod";
import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";

export const DEFAULT_COPY_GEN_MODEL: SupportedModel = "gpt-5.4-mini";

export interface PitchWedgeInput {
  /** One-line headline of the wedge ("Reply rate of 0%"). */
  headline: string;
  /** Plain-English evidence ("0 of last 47 reviews have an owner response."). */
  evidence: string;
}

export interface GenerateOnePagerInput {
  businessName: string;
  /** Plain category ("med spa", "auto body shop"). */
  category: string;
  city: string;
  /** Provider's agency name (used in voice — "From Anchor Local"). */
  agencyName: string;
  /** Exactly 4 wedges per the agency-portal Prospect-detail spec. */
  pitchWedges: [
    PitchWedgeInput,
    PitchWedgeInput,
    PitchWedgeInput,
    PitchWedgeInput,
  ];
  /** Tone control. */
  tone?: "professional" | "playful";
  /** Override the default model — used for A/B testing (task D.8). */
  model?: SupportedModel;
}

export const OnePagerSchema = z.object({
  /** ≤ 80 chars — the headline of the one-pager. */
  headline: z.string().min(1).max(80),
  /** ≤ 240 chars — the elevator-pitch paragraph below the headline. */
  subhead: z.string().min(1).max(240),
  /** Exactly 4 short paragraphs (one per pitch wedge). Each ≤ 360 chars. */
  wedgeNarratives: z.array(z.string().min(1).max(360)).length(4),
  /** Closing CTA line. ≤ 120 chars. */
  callToAction: z.string().min(1).max(120),
});
export type OnePagerResult = z.infer<typeof OnePagerSchema>;

const SYSTEM_PROMPT = `You write agency one-pager copy for local-business pitches.
The agency hands this to a prospect SMB owner. Voice is professional and
direct — like a Stripe or Linear announcement, not a sales pitch.

Return ONE JSON object — nothing else. No code fences. No prose.

Schema:
{
  "headline": string,                 // ≤ 80 chars
  "subhead": string,                  // ≤ 240 chars
  "wedgeNarratives": string[4],       // 4 short paragraphs, ≤ 360 chars each
                                      // (one per provided pitchWedge, same order)
  "callToAction": string              // ≤ 120 chars
}

Voice rules:
- Active voice. Specific. No hyperbole. No exclamation marks.
- Don't use jargon (CTR, MSI, schema markup) — the SMB owner is the reader.
- Don't promise outcomes ("we'll triple your revenue"). Cite the evidence.
- Each wedge paragraph stands alone and references its provided evidence.
- The CTA invites a 15-minute conversation, not a hard sell.
- If tone is "playful", lean slightly warmer but keep the precision.`;

function buildPrompt(input: GenerateOnePagerInput): string {
  const wedgeLines = input.pitchWedges
    .map(
      (w, i) =>
        `Wedge ${i + 1}\n  Headline: ${w.headline}\n  Evidence: ${w.evidence}`,
    )
    .join("\n\n");
  return `Business: ${input.businessName} (${input.category} in ${input.city})
Agency: ${input.agencyName}
Tone: ${input.tone ?? "professional"}

Pitch wedges (use these in order — wedgeNarratives[i] must address pitchWedges[i]):
${wedgeLines}

Write one-pager copy. Return JSON.`;
}

/**
 * Generate one-pager marketing copy from a business + 4 pitch wedges.
 *
 * Not cached — each one-pager is bespoke. Callers MUST be inside withCronRun.
 */
export async function generateOnePager(
  input: GenerateOnePagerInput,
): Promise<OnePagerResult> {
  if (!input.businessName.trim()) {
    throw new Error("[ai] generateOnePager: businessName is required");
  }
  if (!input.category.trim()) {
    throw new Error("[ai] generateOnePager: category is required");
  }
  if (!input.city.trim()) {
    throw new Error("[ai] generateOnePager: city is required");
  }
  if (!input.agencyName.trim()) {
    throw new Error("[ai] generateOnePager: agencyName is required");
  }
  if (input.pitchWedges.length !== 4) {
    throw new Error(
      `[ai] generateOnePager: pitchWedges must have exactly 4 entries, got ${input.pitchWedges.length}`,
    );
  }
  const model = input.model ?? DEFAULT_COPY_GEN_MODEL;
  const { text } = await callOpenAi({
    operation: `ai.copy.onepager[${model}]`,
    model,
    maxTokens: 1500,
    temperature: 0.5,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    jsonMode: true,
    costCeilingUsd: 0.2,
  });

  const parsed = safeParseJson(text, "generateOnePager");
  return OnePagerSchema.parse(parsed);
}

function safeParseJson(raw: string, op: string): unknown {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `[ai] ${op}: model returned non-JSON output. ` +
        `Got: ${trimmed.slice(0, 200)}${trimmed.length > 200 ? "..." : ""} · ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
