// Review sentiment + theme classification via OpenAI chat completions.
//
// Input: review star rating + text. Output: a strict shape with sentiment +
// up to 5 theme tags + one-line summary + confidence.
//
// Model: defaults to gpt-5.4-nano (cheap classification). Pass a different
// model to A/B test — that's task D.8's mandate.
//
// Cached for 24h on the full input. Skips network + skips billing on cache
// hits. Per-call cost target ≤ $0.0005 with nano, ≤ $0.002 with mini.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";

export const DEFAULT_SENTIMENT_MODEL: SupportedModel = "gpt-5.4-nano";

const Sentiment = z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]);
export type Sentiment = z.infer<typeof Sentiment>;

/** Allowed theme tags. Closed list — Hunter filters key off these, so new
 *  tags need a deliberate add (UI + index considerations). */
export const ALLOWED_THEMES = [
  "staff",
  "pricing",
  "wait_time",
  "cleanliness",
  "results",
  "communication",
  "atmosphere",
  "booking",
  "parking",
  "value",
  "expertise",
  "comfort",
  "rude",
  "missed_appointment",
  "billing_issue",
] as const;
export type ReviewTheme = (typeof ALLOWED_THEMES)[number];

const ThemeSet = z.array(z.enum(ALLOWED_THEMES)).max(5);

export const ClassifyReviewSchema = z.object({
  sentiment: Sentiment,
  themes: ThemeSet,
  /** Free-form one-line summary, ≤ 120 chars. */
  summary: z.string().min(1).max(120),
  /** Model's confidence in the classification (0..1). */
  confidence: z.number().min(0).max(1),
});
export type ClassifyReviewResult = z.infer<typeof ClassifyReviewSchema>;

export interface ClassifyReviewInput {
  stars: number;
  text: string;
  /** ISO language code if known. */
  language?: string;
  /** Override the default model — used by A/B testing (task D.8). */
  model?: SupportedModel;
}

const SYSTEM_PROMPT = `You are a review classifier for a local-business intelligence platform.
You return ONE JSON object — nothing else. No code fences. No prose.

Schema:
{
  "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "themes": string[],                // 0–5 tags from ALLOWED_THEMES below
  "summary": string,                 // ≤ 120 chars, plain English
  "confidence": number               // 0..1
}

ALLOWED_THEMES (exact spelling, no others):
staff, pricing, wait_time, cleanliness, results, communication, atmosphere,
booking, parking, value, expertise, comfort, rude, missed_appointment,
billing_issue

Rules:
- sentiment matches stars: 1–2 → NEGATIVE, 3 → NEUTRAL, 4–5 → POSITIVE,
  UNLESS the text strongly contradicts (e.g. 5★ with "worst ever").
- themes is empty if no clear theme. Do not invent. Do not include sentiment.
- summary is descriptive ("Pricing felt high but staff was friendly"), not
  judgmental ("Customer is rude").
- confidence: 0.9+ for unambiguous, 0.5 for mixed signals, 0.2 for empty text.`;

function buildPrompt(input: ClassifyReviewInput): string {
  const lang = input.language ? ` (language: ${input.language})` : "";
  return `Review${lang}:
Stars: ${input.stars}/5
Text: ${input.text || "(empty)"}

Classify and return JSON.`;
}

/**
 * Internal · non-cached entrypoint. Exported for tests and callers that want
 * to bypass the KV layer (e.g. UI "Reclassify" button).
 */
export async function classifyReviewUncached(
  input: ClassifyReviewInput,
): Promise<ClassifyReviewResult> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new Error(
      `[ai] classifyReview: stars must be an integer 1..5, got ${input.stars}`,
    );
  }
  const model = input.model ?? DEFAULT_SENTIMENT_MODEL;
  const { text } = await callOpenAi({
    operation: `ai.sentiment.classify[${model}]`,
    model,
    maxTokens: 256,
    temperature: 0,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    jsonMode: true,
  });

  const parsed = safeParseJson(text, "classifyReview");
  return ClassifyReviewSchema.parse(parsed);
}

/**
 * Classify a review's sentiment + themes. Cached for 24h on the full input
 * (including model — different models cache separately so A/B replays are
 * honest).
 */
export const classifyReview = kvCache(
  "ai:sentiment:classify",
  { ttl: 86_400 },
  classifyReviewUncached,
);

function safeParseJson(raw: string, op: string): unknown {
  const trimmed = raw.trim();
  // Strip code fences if the model is feeling fancy despite jsonMode.
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
