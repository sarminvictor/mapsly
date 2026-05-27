// Owner-reply draft generation for reviews · EN + ES bilingual output.
//
// Model: defaults to gpt-5.4-mini (tone-sensitive prose). nano is exposed
// as an A/B option so D.8 can compare cost/quality.
//
// Cached for 6h on the full input. Per-call cost target ≤ $0.005 with mini.
//
// Tone-matching strategy:
// When `voiceExamples` is provided, the prompt switches to a few-shot
// mode where the model sees paired (review → owner reply) examples
// BEFORE the new review · this is how it learns the owner's openers,
// closings, emoji, sentence length, and signature phrases. The system
// prompt's generic rules ("warm and plain") defer to the examples.
//
// `voiceNotes` (string) is kept for backwards compatibility with the
// older cron path (modules/scoring/ai-reply.ts) but new callers should
// pass `voiceExamples` for materially better tone-matching.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";

export const DEFAULT_REPLY_DRAFT_MODEL: SupportedModel = "gpt-5.4-mini";

export const REPLY_TONES = ["warm", "professional", "apologetic"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];

/**
 * One prior (review → owner reply) pair. Passed as a few-shot example
 * so the model learns context-appropriate response patterns: how the
 * owner greets, what phrases they reuse, how they handle each star
 * level, whether they sign off, emoji use, etc.
 */
export interface VoiceExample {
  /** Stars on the example's review (1..5). */
  reviewStars: number;
  /** Reviewer's text on the example. Optional — some reviews are stars-only. */
  reviewText: string | null;
  /** The owner's actual reply on that example. The thing the model mimics. */
  ownerReply: string;
}

export interface DraftReplyInput {
  /** Reviewer's star rating (1..5). */
  stars: number;
  /** Reviewer's text. */
  text: string;
  /** Business display name (used in the reply for warmth). */
  businessName: string;
  /** Business category — informs vocabulary ("patients" vs "guests"). */
  category: string;
  /**
   * Reviewer's display name (initial or first name if available).
   * Passed through so the model can use a greeting placeholder like
   * "Hi {name}!" when the owner's examples show that pattern.
   *
   * Per `.claude/rules/security.md` § PII, persisted reviewer names are
   * anonymized to initials — callers usually pass initials here. The
   * model is told to handle initials gracefully (write "Hi there" if
   * the value is an initial, "Hi Sarah" if it's a real first name).
   */
  reviewerName?: string | null;
  /** Voice tone preference. Defaults to warm. */
  tone?: ReplyTone;
  /**
   * Paired (review → owner reply) few-shot examples. RECOMMENDED — the
   * model uses these to learn the owner's exact style. Up to 8 examples
   * is plenty; more increases cost without helping much. When set, the
   * system prompt switches to "mimic these" mode.
   */
  voiceExamples?: VoiceExample[];
  /**
   * Free-text voice notes (legacy path · cron). New callers should use
   * `voiceExamples` instead — it produces materially better matches
   * because the model sees PAIRED context.
   */
  voiceNotes?: string;
  /** Override the default model — used for A/B testing (task D.8). */
  model?: SupportedModel;
}

export const ReplyDraftSchema = z.object({
  en: z.string().min(1).max(900),
  es: z.string().min(1).max(900),
});
export type ReplyDraftResult = z.infer<typeof ReplyDraftSchema>;

const SYSTEM_PROMPT_WITH_EXAMPLES = `You write owner replies to Google reviews. The owner has prior replies
shown as examples — MIMIC their style precisely. Copy their openers
(e.g. "Hi {name}!", "Thanks so much, {name}!", "Thank you for sharing"),
their closings, sentence length, level of formality, emoji use (or
lack of it), and any signature phrases. Do NOT impose a generic
template if the owner writes differently.

Always:
- Return ONE JSON object: { "en": string, "es": string } · no code fences
- Reference at least one specific detail from the NEW review
- ≤ 600 characters per language
- en = US English; es = US Spanish
- Never include unfilled placeholders like "[your name]"
- For ★1–2: acknowledge + invite offline follow-up. Do not litigate publicly.
- If the reviewer name is an initial (e.g. "S.B."), write "Hi there" or
  no greeting at all — never use the initial as if it were a name.
- If the reviewer name is a real first name (e.g. "Sarah"), use it the
  way the example replies use names.`;

const SYSTEM_PROMPT_NO_EXAMPLES = `You write owner replies to Google reviews for small local businesses.

Always:
- Return ONE JSON object: { "en": string, "es": string } · no code fences
- Warm and plain. Sound like the owner, not a corporate auto-reply.
- Reference at least one specific detail from the review.
- ≤ 600 characters per language.
- en = US English; es = US Spanish (usted by default for professional
  service categories).
- For ★1–2: acknowledge + invite offline follow-up. Do not litigate publicly.
- For ★3: thank, address mixed feedback honestly, invite return.
- For ★4–5: thank, name what you're glad they enjoyed, light invitation back.
- Use the audience vocabulary (medical-spa: "patients"; restaurant:
  "guests"; auto-body: "customers"; etc.).
- Never include unfilled placeholders like "[your name]".
- If the reviewer name is an initial, write "Hi there" or skip the greeting.`;

function formatVoiceExamples(examples: VoiceExample[]): string {
  return examples
    .map((ex, i) => {
      const text =
        ex.reviewText && ex.reviewText.trim().length > 0
          ? ex.reviewText.trim().slice(0, 600)
          : "(stars only · no written feedback)";
      return `--- Example ${i + 1} ---
Review (★${ex.reviewStars}): ${text}
Owner's reply: ${ex.ownerReply.trim().slice(0, 800)}`;
    })
    .join("\n\n");
}

function buildPrompt(input: DraftReplyInput): string {
  const tone = input.tone ?? "warm";
  const reviewerLine = input.reviewerName
    ? `Reviewer name: ${input.reviewerName}`
    : "Reviewer name: (anonymous)";

  // Few-shot pattern · materially better tone match than free-text voice notes.
  const examplesBlock =
    input.voiceExamples && input.voiceExamples.length > 0
      ? `=== OWNER'S PRIOR REPLIES (mimic the style of these exactly) ===
${formatVoiceExamples(input.voiceExamples)}

=== END EXAMPLES ===

`
      : input.voiceNotes
        ? `Voice notes: ${input.voiceNotes}\n\n`
        : "";

  return `Business: ${input.businessName}
Category: ${input.category}
Tone: ${tone}
${reviewerLine}

${examplesBlock}=== NEW REVIEW (write the owner's reply now) ===
Stars: ${input.stars}/5
Text: ${input.text || "(stars only · no written feedback)"}

Write the owner's reply in English AND Spanish. Match the style of the
prior-reply examples above as precisely as you can. Return JSON.`;
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
  // Examples-mode system prompt is more permissive · it tells the model
  // to defer to the few-shot examples rather than impose a generic
  // "warm and plain" template. No-examples mode keeps the original
  // strict voice rules.
  const system =
    input.voiceExamples && input.voiceExamples.length > 0
      ? SYSTEM_PROMPT_WITH_EXAMPLES
      : SYSTEM_PROMPT_NO_EXAMPLES;
  const { text } = await callOpenAi({
    operation: `ai.reply.draft[${model}]`,
    model,
    maxTokens: 800,
    temperature: 0.4,
    system,
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
