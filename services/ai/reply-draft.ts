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
import { wrapUntrusted } from "@/services/ai/untrusted";
import { isHumanMedicalCategory } from "@/services/ai/medical-category";
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
  /** Generate ONLY the English draft (skip Spanish generation). The product
   *  is English-first for now; the ES path + schema stay for future use. */
  englishOnly?: boolean;
}

export const ReplyDraftSchema = z.object({
  en: z.string().min(1).max(900),
  es: z.string().min(1).max(900),
});
export type ReplyDraftResult = z.infer<typeof ReplyDraftSchema>;

/** English-only response shape (used when `englishOnly` is set). */
const ReplyDraftEnOnlySchema = z.object({
  en: z.string().min(1).max(900),
});

const ENGLISH_ONLY_OVERRIDE = `

OVERRIDE: Return ONLY {"en": string} in US English. Do NOT include an "es" field or any Spanish text.`;

/**
 * PHI guardrail · appended to BOTH system prompts (with-examples and
 * no-examples) when the business category is human-medical per
 * `isHumanMedicalCategory`. Applies to BOTH the EN and ES drafts.
 *
 * WHY: US regulators have fined practices $10k–$50k for review replies
 * that confirmed the reviewer was a patient or echoed their treatment.
 * The CONTENT RULES deliberately OVERRIDE the base prompts' "reference
 * at least one specific detail from the review" instruction where they
 * conflict.
 *
 * v2 (2026-06 voice audit): split into two labeled sections. The old
 * single-blob version over-suppressed — models read "OVERRIDE every
 * other instruction" as covering tone too and produced corporate-
 * generic replies for energetic owners. CONTENT RULES govern WHAT the
 * reply may say (plus an explicit allow-list of non-clinical review
 * details); VOICE RULES state that HOW it sounds is never restricted.
 *
 * Exported so trap-case unit tests can assert the exact text lands in
 * the prompt (and only for medical categories).
 */
export const PHI_REPLY_GUARDRAIL = `

PRIVACY RULES — this business is a healthcare practice. US privacy law
(HIPAA) forbids disclosing patient information in public replies. These
rules OVERRIDE every other instruction in this conversation — including
"reference a specific detail from the review", "mimic the style of
these exactly", and the style of any prior-reply examples:

CONTENT RULES (these override "reference a specific detail" when they
conflict):
- NEVER confirm, deny, or imply that the reviewer was or was not a
  patient or client of the practice. No "thanks for coming in", "we
  loved having you", "since your visit" — and equally no "we have no
  record of you" or "you were never a patient here". Confirming AND
  denying a care relationship are both disclosures.
- NEVER mention, confirm, or repeat treatments, procedures, conditions,
  medications, results, appointment dates, visit dates, or payments —
  even if the reviewer wrote about them. Do not echo those details
  back in any form.
- OK to reference from the review: wait time, scheduling or booking
  experience, staff friendliness or demeanor, facility cleanliness or
  atmosphere, general service quality — these are not patient
  information.
- For negative reviews, invite offline contact WITHOUT acknowledging
  any care relationship: "We'd welcome the chance to talk — please call
  our office." Never "about your appointment" or "your treatment".

VOICE RULES (NEVER overridden by privacy rules):
- Copy the owner's greeting style (e.g. greeting the reviewer by their
  public first name — that is voice, not a disclosure), emoji use or
  absence, punctuation energy, sentence length, sign-off and signature
  phrases from the prior-reply examples.
- Privacy rules govern WHAT you say, never HOW you sound. A
  privacy-safe reply in the owner's energetic voice is the goal —
  generic corporate phrasing is a failure.

Apply these rules to BOTH the English and the Spanish drafts.`;

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

/** Mode (most frequent value) with first-seen tie-breaking · null on []. */
function modeOf(values: string[]): { value: string; count: number } | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/** Unicode emoji + text emoticons (:-) :) ;) :D …) — sampling, not parsing. */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|[:;]-?[)(DPp]/u;

const SALUTATIONS = new Set(["hi", "hey", "hello", "hola"]);

/**
 * VOICE PROFILE · tiny deterministic summary of the owner's reply style,
 * computed from the few-shot examples and injected into the user message
 * right after the examples block — for ALL businesses with examples, not
 * only medical (privacy rules constrain content, never voice).
 *
 * WHY: examples alone under-transfer voice once the PHI guardrail is in
 * play — the model plays it safe and goes corporate. Naming the voice
 * features explicitly ("uses emoji", `greets with "Hey {name}!"`) gives
 * it both permission and a checklist. Heuristics are deliberately simple
 * and robust (first-word greeting mode, exclamation density, emoji
 * regex incl. :-) forms, short-closer mode, median sentence count) —
 * this is a nudge, not NLP.
 *
 * Exported for unit tests. Returns "" when no usable examples exist.
 */
export function buildVoiceProfile(examples: VoiceExample[]): string {
  const replies = examples
    .map((e) => e.ownerReply.trim())
    .filter((r) => r.length > 0);
  if (replies.length === 0) return "";

  const parts: string[] = [];

  // Greeting · mode of the first word across replies (≥ half must agree).
  const firstWords = replies
    .map((r) => /^[^A-Za-zÀ-ÿ]*([A-Za-zÀ-ÿ']+)/.exec(r)?.[1] ?? "")
    .filter(Boolean);
  const greeting = modeOf(firstWords.map((w) => w.toLowerCase()));
  if (greeting && greeting.count * 2 >= firstWords.length) {
    const original =
      firstWords.find((w) => w.toLowerCase() === greeting.value) ??
      greeting.value;
    if (SALUTATIONS.has(greeting.value)) {
      // Salutation + name pattern. "!" only when the owner actually
      // punches the greeting (salutation, name, then an exclamation).
      const energetic = replies.some((r) =>
        new RegExp(`^${original}[\\s,]+[^\\s.!?]+!`, "i").test(r),
      );
      parts.push(`greets with "${original} {name}${energetic ? "!" : ""}"`);
    } else {
      parts.push(`often opens with "${original} …"`);
    }
  }

  // Exclamation energy · density across all replies.
  const exclamations = replies.join("").split("!").length - 1;
  const perReply = exclamations / replies.length;
  parts.push(
    perReply >= 1
      ? "uses exclamation marks freely"
      : perReply > 0
        ? "uses an occasional exclamation mark"
        : "no exclamation marks",
  );

  // Emoji / emoticons · sample the first one seen so the model copies
  // the owner's actual flavor (🌸 vs :-)).
  const emojiSample = replies
    .map((r) => EMOJI_RE.exec(r)?.[0])
    .find((m): m is string => Boolean(m));
  parts.push(emojiSample ? `uses emoji (${emojiSample})` : "no emoji");

  // Sign-off · most common SHORT closing sentence (must repeat to count
  // as a signature phrase, otherwise it's just that one reply's ending).
  const closers = replies
    .map((r) => {
      const sentences = r
        .split(/(?<=[.!?…])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return sentences[sentences.length - 1] ?? "";
    })
    .filter((s) => s.length > 0 && s.length <= 60);
  const closer = modeOf(closers.map((s) => s.toLowerCase()));
  if (closer && closer.count >= 2) {
    const original = closers.find((s) => s.toLowerCase() === closer.value)!;
    parts.push(`typical sign-off: "${original}"`);
  }

  // Reply length · median sentence count (robust to one rambling reply).
  const sentenceCounts = replies
    .map(
      (r) =>
        r
          .split(/[.!?…]+/)
          .map((s) => s.trim())
          .filter(Boolean).length,
    )
    .sort((a, b) => a - b);
  const median = sentenceCounts[Math.floor(sentenceCounts.length / 2)] ?? 1;
  parts.push(
    `average reply length ~${median} sentence${median === 1 ? "" : "s"}`,
  );

  return `VOICE PROFILE (computed from the owner's replies): ${parts.join(" · ")}.`;
}

function formatVoiceExamples(examples: VoiceExample[]): string {
  return examples
    .map((ex, i) => {
      const text =
        ex.reviewText && ex.reviewText.trim().length > 0
          ? wrapUntrusted(ex.reviewText.trim().slice(0, 600), "REVIEW TEXT")
          : "(stars only · no written feedback)";
      return `--- Example ${i + 1} ---
Review (★${ex.reviewStars}): ${text}
Owner's reply: ${ex.ownerReply.trim().slice(0, 800)}`;
    })
    .join("\n\n");
}

function buildPrompt(input: DraftReplyInput, isMedical: boolean): string {
  const tone = input.tone ?? "warm";
  const reviewerLine = input.reviewerName
    ? `Reviewer name: ${input.reviewerName}`
    : "Reviewer name: (anonymous)";

  // Few-shot pattern · materially better tone match than free-text voice
  // notes. For medical categories the header must NOT re-issue "mimic
  // exactly" — the user message arrives after the system prompt, and a
  // later unqualified imperative can win over the PHI guardrail. The
  // medical header scopes imitation to VOICE (greeting, emoji,
  // punctuation, sign-off) and bans imitating clinical content, in-band.
  const examplesHeader = isMedical
    ? `=== OWNER'S PRIOR REPLIES (mimic the VOICE: greeting style, emoji, punctuation, sign-off. Privacy rules govern content only — never imitate clinical details from these examples.) ===`
    : `=== OWNER'S PRIOR REPLIES (mimic the style of these exactly) ===`;
  // VOICE PROFILE · injected right after the examples for ALL businesses
  // with examples — explicit feature naming transfers voice better than
  // raw examples alone (esp. under the medical guardrail).
  const voiceProfile =
    input.voiceExamples && input.voiceExamples.length > 0
      ? buildVoiceProfile(input.voiceExamples)
      : "";
  const examplesBlock =
    input.voiceExamples && input.voiceExamples.length > 0
      ? `${examplesHeader}
${formatVoiceExamples(input.voiceExamples)}

=== END EXAMPLES ===

${voiceProfile ? `${voiceProfile}\n\n` : ""}`
      : input.voiceNotes
        ? `Voice notes: ${input.voiceNotes}\n\n`
        : "";

  // Same recency concern for the closing line: it is the LAST instruction
  // the model reads. The medical variant restates BOTH halves — voice is
  // mandatory (greeting/emoji/punctuation/sign-off), clinical content is
  // banned, and the non-clinical allow-list is safe — so recency works
  // FOR the guardrail instead of against it.
  const closing = isMedical
    ? `Write the owner's reply in English AND Spanish. ALWAYS mimic the owner's
greeting style, emoji use, punctuation, and sign-off from the examples
above. Never mention treatments, procedures, conditions, dates, or
payments. Non-clinical specifics from the review (wait time, staff
friendliness, atmosphere) are safe to reference. Return JSON.`
    : `Write the owner's reply in English AND Spanish. Match the style of the
prior-reply examples above as precisely as you can. Return JSON.`;

  return `Business: ${input.businessName}
Category: ${input.category}
Tone: ${tone}
${reviewerLine}

${examplesBlock}=== NEW REVIEW (write the owner's reply now) ===
Stars: ${input.stars}/5
Text: ${
    input.text && input.text.trim().length > 0
      ? wrapUntrusted(input.text, "REVIEW TEXT")
      : "(stars only · no written feedback)"
  }

${closing}`;
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
  const englishOnly = input.englishOnly === true;
  const baseSystem =
    input.voiceExamples && input.voiceExamples.length > 0
      ? SYSTEM_PROMPT_WITH_EXAMPLES
      : SYSTEM_PROMPT_NO_EXAMPLES;
  // PHI guardrail · human-medical categories only (vets keep the
  // natural style — see services/ai/medical-category.ts). Appended
  // AFTER the base prompt so its OVERRIDE framing covers both the
  // generic rules and the few-shot examples. The SAME flag also softens
  // the user message (buildPrompt) so no later instruction re-issues
  // "mimic exactly" after the guardrail.
  const medical = isHumanMedicalCategory(input.category);
  const guarded = medical ? baseSystem + PHI_REPLY_GUARDRAIL : baseSystem;
  const system = englishOnly ? guarded + ENGLISH_ONLY_OVERRIDE : guarded;
  const { text } = await callOpenAi({
    operation: `ai.reply.draft[${model}]`,
    model,
    maxTokens: 800,
    // NOTE: gpt-5.x models reject explicit temperature values, so the
    // client OMITS the param for them entirely (see services/ai/client.ts)
    // — this 0.4 only takes effect if a non-gpt-5 model is configured.
    temperature: 0.4,
    system,
    prompt: buildPrompt(input, medical),
    jsonMode: true,
    // Reply-draft prompts are short; allow a small headroom for verbose
    // reviewers + bilingual output.
    costCeilingUsd: 0.05,
  });

  const parsed = safeParseJson(text, "draftReply");
  if (englishOnly) {
    const enOnly = ReplyDraftEnOnlySchema.parse(parsed);
    return { en: enOnly.en, es: "" };
  }
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
