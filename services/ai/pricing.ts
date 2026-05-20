// Per-model OpenAI token pricing · USD per 1M tokens.
//
// Source: OpenAI pricing page as of 2026-05-20. Update when OpenAI ships new
// rates or new models. These constants drive the cost-counter increment on
// every call — wrong numbers mean wrong billing, so verify before bumping.
//
// Cost formula:
//   input_tokens × inputUsdPerMTok / 1_000_000
// + output_tokens × outputUsdPerMTok / 1_000_000
// + cached_input_tokens × cachedInputUsdPerMTok / 1_000_000
//
// OpenAI bills cached input tokens at a discounted rate (the prompt-caching
// feature charges roughly 50% of the input rate for cached prefixes).

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputUsdPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputUsdPerMTok: number;
  /** USD per 1,000,000 cached-input tokens. Typically 0.5 × input. */
  cachedInputUsdPerMTok: number;
}

/**
 * Supported models. Add a row here, set its pricing, and it becomes callable
 * via `callOpenAi({ model, ... })`. Typo-safe: unknown ids throw in computeUsd.
 *
 * The exact numbers below are placeholder pricing that mirrors public OpenAI
 * tiers (nano ~$0.05/$0.40, mini ~$0.25/$2.00 per MTok). When you confirm the
 * official 5.4-series rates, replace and bump `version` for audit trail.
 */
export const PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  // GPT-5.4 nano · cheapest classification + tagging. Used for sentiment.
  "gpt-5.4-nano": {
    inputUsdPerMTok: 0.05,
    outputUsdPerMTok: 0.4,
    cachedInputUsdPerMTok: 0.025,
  },
  // GPT-5.4 mini · cheap prose. Used for reply drafts + one-pager copy.
  "gpt-5.4-mini": {
    inputUsdPerMTok: 0.25,
    outputUsdPerMTok: 2.0,
    cachedInputUsdPerMTok: 0.125,
  },
});

export type SupportedModel = keyof typeof PRICING;

/** Per-call USD ceiling. Above this the wrapper throws instead of billing —
 *  protects against runaway prompts. Per cost-discipline.md "$5 needs Viktor
 *  approval"; default to a much tighter ceiling so a single call cannot
 *  silently approach it. Callers needing more should pass `costCeilingUsd`. */
export const DEFAULT_PER_CALL_CEILING_USD = 0.5;

export interface UsageCounts {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * Compute USD cost from token usage counts. Throws on unknown model so a
 * typo in the model id can't silently mis-attribute spend.
 */
export function computeUsd(model: string, usage: UsageCounts): number {
  const price = PRICING[model];
  if (!price) {
    throw new Error(
      `[ai] unknown model "${model}" — cannot price. Add it to services/ai/pricing.ts.`,
    );
  }
  const cached = usage.cachedInputTokens ?? 0;
  const freshInput = Math.max(0, usage.inputTokens - cached);
  const inputUsd =
    (freshInput * price.inputUsdPerMTok) / 1_000_000 +
    (cached * price.cachedInputUsdPerMTok) / 1_000_000;
  const outputUsd = (usage.outputTokens * price.outputUsdPerMTok) / 1_000_000;
  return Number((inputUsd + outputUsd).toFixed(8));
}
