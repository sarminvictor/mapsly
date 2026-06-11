// services/ai/phi-sentences.ts
//
// F3 · AI sentence-level PHI scan on ALREADY-FLAGGED owner replies.
//
// The deterministic detector (modules/smb-reviews/phi-check.ts) catches
// curated phrases ("your visit", "Botox", "$50") but cannot catch
// paraphrased disclosures — "After reviewing footage… we are perplexed
// why you voiced frustration" admits the reviewer was on the premises
// without any flagged vocabulary. This pass asks the existing nano
// model to identify the offending SENTENCES, verbatim, so the UI can
// mark them with the same highlight machinery as the phrase marks.
//
// Scope discipline (cost): callers invoke this ONLY for replies the
// deterministic detector already flagged on human-medical businesses —
// never for unflagged replies, never for non-medical categories. See
// modules/smb-reviews/phi-ai-enrich.ts (the only production caller).
//
// Why one tiny call per flagged reply:
//   - flagged replies are rare (a handful per business, ever)
//   - nano pricing puts a 400-char reply at ~$0.0001 per scan
//   - the KV cache below keys on (reply text + prompt version), so each
//     unique reply text is billed once per TTL window — re-renders and
//     Next-cache misses hit KV, not OpenAI
//
// Per `.claude/rules/cost-discipline.md`, must run inside an open
// CronRun (assertCronContext via callOpenAi). The on-demand caller
// mirrors the reply-draft server action: withCronRun("manual:…").

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";

export const DEFAULT_PHI_SENTENCES_MODEL: SupportedModel = "gpt-5.4-nano";

/** Output cap · a worst-case rant must not return an unbounded list. */
const MAX_PHI_SENTENCES = 6;

export const PhiSentencesSchema = z.object({
  /** Sentences copied VERBATIM from the reply that disclose (or imply)
   *  a care relationship with the reviewer. Empty when none qualify. */
  sentences: z.array(z.string().min(1).max(600)).max(12).default([]),
});
export type PhiSentencesResult = z.infer<typeof PhiSentencesSchema>;

export interface ExtractPhiSentencesInput {
  /** The published owner reply text — already flagged deterministically. */
  replyText: string;
  /** Override the model — A/B testing only; production uses nano. */
  model?: SupportedModel;
}

const SYSTEM_PROMPT = `You review the text of a business owner's PUBLIC reply to a Google review of a healthcare practice. US privacy law (HIPAA) forbids disclosing patient information in public replies.
You return ONE JSON object — nothing else. No code fences. No prose.

Schema:
{
  "sentences": string[]   // sentences copied VERBATIM from the reply
}

Rules:
- Return ONLY sentences from the reply that do at least one of:
  - confirm, deny, or imply that the reviewer was or was not a patient or
    client of the practice — including indirect admissions ("after
    reviewing footage of the incident", "we have no record of you",
    "when you stopped by") that place the reviewer at the practice
  - reference the reviewer's treatment, procedure, appointment, results,
    recovery, condition, or medication
  - reference the reviewer's payment, refund, deposit, or pricing
    discussion
  - otherwise disclose or imply a care relationship with the reviewer
- Copy each qualifying sentence VERBATIM — exact characters from the
  reply, complete sentences as written, no paraphrasing, no rewording,
  no merging or splitting sentences.
- Generic marketing language that says nothing about THIS reviewer
  ("We work hard to give everyone a great experience") does NOT qualify.
- Return an empty array if no sentence qualifies.
- Never invent text that is not in the reply.`;

function buildPrompt(replyText: string): string {
  return `Owner's public reply to a Google review:
"""
${replyText}
"""

Return the qualifying sentences (verbatim) as JSON.`;
}

/**
 * Internal · non-cached entrypoint. Exposed for tests and rare callers
 * that must bypass KV.
 */
export async function extractPhiSentencesUncached(
  input: ExtractPhiSentencesInput,
): Promise<PhiSentencesResult> {
  const replyText = input.replyText ?? "";
  if (replyText.trim().length === 0) {
    return { sentences: [] };
  }
  // Truncate very long replies to control input cost — Google caps owner
  // replies well under this; the cutoff is safely past p99.
  const text = replyText.length > 4000 ? replyText.slice(0, 4000) : replyText;
  const model = input.model ?? DEFAULT_PHI_SENTENCES_MODEL;

  const { text: raw } = await callOpenAi({
    operation: `ai.phi.sentences[${model}]`,
    model,
    maxTokens: 700,
    temperature: 0,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(text),
    jsonMode: true,
    // A flagged reply is short; a single scan should stay ~$0.0001.
    costCeilingUsd: 0.01,
  });

  const parsed = safeParseJson(raw);
  const result = PhiSentencesSchema.parse(parsed);

  // Post-process · keep only sentences that actually appear VERBATIM in
  // the reply (curly apostrophes normalized, case-insensitive) — the
  // model occasionally paraphrases despite instructions, and a sentence
  // the UI can't locate is dead weight. Dedupe + cap.
  return { sentences: filterToVerbatim(result.sentences, text) };
}

/**
 * Public · cached on (reply text + prompt version). The prompt version
 * lives in the key prefix — bump `v1` whenever SYSTEM_PROMPT changes so
 * stale verdicts re-scan. 90-day TTL ≈ "billed once ever" for a given
 * reply text: flagged replies either get fixed (text changes → new key)
 * or age out of the page long before the TTL recycles.
 */
export const extractPhiSentences = kvCache(
  "ai:phi:sentences:v1",
  { ttl: 90 * 86_400 },
  extractPhiSentencesUncached,
);

// ---- Helpers -------------------------------------------------------------

/** Same normalization as the deterministic detector + the UI marker
 *  (phi-check.ts / PrivacyMarkedReplyText) · curly apostrophes →
 *  straight, 1:1 char replacement so indices stay aligned. */
function normalize(s: string): string {
  return s.replace(/[‘’]/g, "'");
}

function filterToVerbatim(sentences: string[], replyText: string): string[] {
  const haystack = normalize(replyText).toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sentences) {
    if (out.length >= MAX_PHI_SENTENCES) break;
    const sentence = normalize(raw ?? "").trim();
    if (!sentence) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    if (!haystack.includes(key)) continue; // paraphrased → unlocatable → drop
    seen.add(key);
    out.push(sentence);
  }
  return out;
}

function safeParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `[ai] extractPhiSentences: model returned non-JSON. ` +
        `Got: ${trimmed.slice(0, 200)}${trimmed.length > 200 ? "..." : ""} · ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
