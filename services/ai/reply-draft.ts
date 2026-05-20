// Owner-reply draft generation for reviews · EN + ES bilingual output.
//
// Model: defaults to gpt-5.4-mini (tone-sensitive prose). nano is exposed
// as an A/B option so D.8 can compare cost/quality.
//
// Cached for 6h on the full input. Per-call cost target ≤ $0.005 with mini.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";

export const DEFAULT_REPLY_DRAFT_MODEL: SupportedModel = "gpt-5.4-mini";

export const REPLY_TONES = ["warm", "professional", "apologetic"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];

export interface DraftReplyInput {
  /** Reviewer's star rating (1..5). */
  stars: number;
  /** Reviewer's text. */
  text: string;
  /** Business display name (used in the reply for warmth). */
  businessName: string;
  /** Business category — informs vocabulary ("patients" vs "guests"). */
  category: string;
  /** Voice tone preference. Defaults to warm. */
  tone?: ReplyTone;
  /** Per-business voice notes from settings (optional). */
  voiceNotes?: string;
  /** Override the default model — used for A/B testing (task D.8). */
  model?: SupportedModel;
}

export const ReplyDraftSchema = z.object({
  en: z.string().min(1).max(900),
  es: z.string().min(1).max(900),
});
export type ReplyDraftResult = z.infer<typeof ReplyDraftSchema>;

const SYSTEM_PROMPT = `You draft owner replies to Google reviews for small local businesses.
Return ONE JSON object — nothing else. No code fences. No prose.

Schema:
{ "en": string, "es": string }

Voice rules (apply to both languages):
- Warm and plain. Sound like the owner, not a corporate auto-reply.
- ≤ 600 characters per language.
- Reference at least one specific detail from the review.
- No exclamation marks in apologies. Save them for genuine wins.
- For ★1–2: acknowledge specifically, take responsibility, invite offline
  follow-up. Do not litigate publicly.
- For ★3: thank, address the mixed feedback honestly, invite return.
- For ★4–5: thank, name what you're glad they enjoyed, light invitation back.
- Use the business's audience vocabulary (medical-spa: "patients"; restaurant:
  "guests"; auto-body: "customers"; etc.). Match the category.
- en is US English; es is US Spanish (default to usted for professional
  service categories; tu only if voice notes indicate).
- Never include placeholders like "[your name]" or "[business email]".`;

function buildPrompt(input: DraftReplyInput): string {
  const tone = input.tone ?? "warm";
  const voiceLine = input.voiceNotes
    ? `Voice notes: ${input.voiceNotes}`
    : "Voice notes: (none — default to warm + plain)";
  return `Business: ${input.businessName}
Category: ${input.category}
Tone: ${tone}
${voiceLine}

Review:
Stars: ${input.stars}/5
Text: ${input.text || "(empty)"}

Draft owner replies in English and Spanish. Return JSON.`;
}

/**
 * Internal · non-cached. Exported for tests + callers that need a fresh
 * generation (e.g. user clicks "Regenerate" on a draft).
 */
export async function draftReplyUncached(
  input: DraftReplyInput,
): Promise<ReplyDraftResult> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new Error(
      `[ai] draftReply: stars must be an integer 1..5, got ${input.stars}`,
    );
  }
  if (!input.businessName.trim()) {
    throw new Error("[ai] draftReply: businessName is required");
  }
  if (!input.category.trim()) {
    throw new Error("[ai] draftReply: category is required");
  }
  const model = input.model ?? DEFAULT_REPLY_DRAFT_MODEL;
  const { text } = await callOpenAi({
    operation: `ai.reply.draft[${model}]`,
    model,
    maxTokens: 800,
    temperature: 0.4,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    jsonMode: true,
    // Reply-draft prompts are short; allow a small headroom for verbose
    // reviewers + bilingual output.
    costCeilingUsd: 0.05,
  });

  const parsed = safeParseJson(text, "draftReply");
  return ReplyDraftSchema.parse(parsed);
}

/**
 * Generate bilingual owner reply drafts. Cached for 6h on the full input.
 * UI "Regenerate" buttons should call `draftReplyUncached` directly.
 */
export const draftReply = kvCache(
  "ai:reply:draft",
  { ttl: 21_600 },
  draftReplyUncached,
);

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
