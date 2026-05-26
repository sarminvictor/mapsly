// OpenAI client + cost-tracked call wrapper · uses raw fetch (no SDK dep).
//
// Why no `openai` SDK: avoids a package.json + pnpm-lock.yaml change so this
// task ships clean from a Cowork-sandbox iteration. The OpenAI REST API is
// stable for our narrow surface (chat completions only). If we later need
// streaming, tools, or vision, adopting the SDK is one PR.
//
// Per .claude/rules/security.md, NEVER read process.env at module-load time
// for clients that take a secret — Vercel's build phase has no runtime env
// vars, so module-load instantiation breaks the build. We read the key
// lazily on first call.
//
// Per .claude/rules/cost-discipline.md, every external API call must run
// inside an open CronRun (AsyncLocalStorage via lib/cost/cost-counter.ts)
// and increment the run's costUsd. callOpenAi enforces both invariants.

import { assertCronContext, incrementCost } from "@/lib/cost/cost-counter";
import {
  computeUsd,
  DEFAULT_PER_CALL_CEILING_USD,
  type SupportedModel,
  type UsageCounts,
} from "@/services/ai/pricing";

const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL?.replace(/\/+$/, "") ??
  "https://api.openai.com/v1";

/** Test-only overrides — replaced via __setFetchForTesting / __setApiKeyForTesting. */
let _fetchOverride: typeof fetch | null = null;
let _apiKeyOverride: string | null = null;

export function __setFetchForTesting(fn: typeof fetch | null): void {
  _fetchOverride = fn;
}
export function __setApiKeyForTesting(key: string | null): void {
  _apiKeyOverride = key;
}

function getFetch(): typeof fetch {
  return _fetchOverride ?? globalThis.fetch;
}

function getApiKey(): string {
  const key = _apiKeyOverride ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "[ai] OPENAI_API_KEY is not set. Add it to .env.local / Vercel env.",
    );
  }
  return key;
}

// ---- Public API ---------------------------------------------------------

export interface CallOpenAiOptions {
  /** Operation tag for cost-counter attribution + error messages. */
  operation: string;
  /** Model id — must be a key of PRICING. */
  model: SupportedModel;
  /** Max output tokens. Required so a buggy prompt can't bill unboundedly. */
  maxTokens: number;
  /** Optional per-call USD ceiling. Above this the call throws AFTER the API
   *  responded (we still pay), so this guards downstream usage rather than
   *  refunding. Defaults to DEFAULT_PER_CALL_CEILING_USD. */
  costCeilingUsd?: number;
  /** Optional system instruction. Single string only. */
  system?: string;
  /** Optional temperature. Defaults to 0 for deterministic classification. */
  temperature?: number;
  /** Single user-turn content. For multi-turn, expand options later. */
  prompt: string;
  /** Request JSON output via response_format. Defaults to false. */
  jsonMode?: boolean;
  /** Optional seed for reproducibility (when the model supports it). */
  seed?: number;
}

export interface CallOpenAiResult {
  /** Concatenated assistant text content. */
  text: string;
  /** Finish reason from OpenAI ("stop" | "length" | "content_filter" | ...). */
  finishReason: string | null;
  /** Token usage as reported by the API, normalized. */
  usage: UsageCounts;
  /** USD billed to the open CronRun for this call. */
  costUsd: number;
  /** Echo of the model id used. */
  model: string;
}

interface OpenAiChatResponse {
  id: string;
  model: string;
  choices: Array<{
    finish_reason: string | null;
    message: { role: string; content: string | null };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/**
 * Send a single-turn chat completion to OpenAI, attribute cost to the open
 * CronRun, and return the assistant text + accounting metadata.
 *
 * Invariants enforced:
 *   1. Must run inside withCronRun(...) — throws otherwise (no live API in
 *      user request path).
 *   2. Computed cost ≤ costCeilingUsd — throws otherwise so a buggy prompt
 *      can't silently burn budget.
 *   3. Model must be in PRICING — typo-safe billing.
 *   4. Bills cost only on success (failed HTTP responses do not bill).
 */
export async function callOpenAi(
  options: CallOpenAiOptions,
): Promise<CallOpenAiResult> {
  const {
    operation,
    model,
    maxTokens,
    system,
    temperature = 0,
    prompt,
    jsonMode = false,
    seed,
    costCeilingUsd = DEFAULT_PER_CALL_CEILING_USD,
  } = options;

  assertCronContext(operation);

  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new Error(
      `[ai] callOpenAi("${operation}"): maxTokens must be a positive integer, got ${maxTokens}`,
    );
  }

  const apiKey = getApiKey();
  const fetchFn = getFetch();

  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  if (seed !== undefined) body.seed = seed;

  const res = await fetchFn(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errText = "";
    try {
      errText = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `[ai] OpenAI "${operation}" HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as OpenAiChatResponse;
  const choice = json.choices?.[0];
  if (!choice) {
    throw new Error(
      `[ai] OpenAI "${operation}" returned no choices. Response id=${json.id}`,
    );
  }
  const text = (choice.message?.content ?? "").trim();

  const usage: UsageCounts = {
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    cachedInputTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
  const costUsd = computeUsd(model, usage);

  if (costUsd > costCeilingUsd) {
    throw new Error(
      `[ai] "${operation}" cost ${costUsd.toFixed(6)} USD exceeded ceiling ${costCeilingUsd.toFixed(4)} USD. ` +
        `Tune the prompt or raise costCeilingUsd. Tokens: input=${usage.inputTokens} output=${usage.outputTokens}.`,
    );
  }

  await incrementCost(costUsd, operation);

  return {
    text,
    finishReason: choice.finish_reason,
    usage,
    costUsd,
    model: json.model ?? model,
  };
}

/* ------------------------------------------------------------------ */
/* Responses API · `/v1/responses`                                      */
/* ------------------------------------------------------------------ */
//
// The Responses API supports built-in tools (web_search_preview, file_search,
// computer_use). We use it for the email-finder Tier-3 fallback — the model
// can issue real-time web searches and read pages on its own.
//
// Pricing model (gpt-5.4 series · reasoning rate):
//   • tokens billed at model rate (includes search-content tokens)
//   • web_search_preview $10 per 1,000 calls
//
// We extract the web_search_call count from `output[]` to bill exactly.

/** USD per 1k web search calls · gpt-5.4 series treated as reasoning models. */
const WEB_SEARCH_USD_PER_K_CALLS = 10.0;

export interface CallOpenAiResponsesOptions {
  operation: string;
  model: SupportedModel;
  /** User-turn input (single string · multi-turn not yet supported). */
  input: string;
  /** Max output tokens. Required so a buggy prompt can't bill unboundedly. */
  maxOutputTokens: number;
  /** Built-in tools the model can call. Currently we only use web_search_preview. */
  tools?: Array<{ type: "web_search_preview" }>;
  /** Per-call USD ceiling. Defaults to DEFAULT_PER_CALL_CEILING_USD. */
  costCeilingUsd?: number;
}

export interface CallOpenAiResponsesResult {
  /** Concatenated assistant text content. */
  text: string;
  /** Exact count of billable web_search_call items in output[]. */
  webSearchCalls: number;
  /** Token usage reported by the API. */
  usage: UsageCounts;
  /** USD billed to the open CronRun · tokens + search calls. */
  costUsd: number;
  /** Echo of model id used. */
  model: string;
}

interface OpenAiResponsesResponse {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

/**
 * Send a single-turn request to OpenAI's Responses API with optional
 * built-in tools (we use web_search_preview for the email-finder).
 * Attributes cost to the open CronRun and returns assistant text +
 * tool-call accounting.
 *
 * Invariants enforced (same as callOpenAi):
 *   1. Must run inside withCronRun(...) — throws otherwise.
 *   2. Computed cost ≤ costCeilingUsd — throws otherwise.
 *   3. Model must be in PRICING — typo-safe billing.
 *   4. Bills cost only on success.
 */
export async function callOpenAiResponses(
  options: CallOpenAiResponsesOptions,
): Promise<CallOpenAiResponsesResult> {
  const {
    operation,
    model,
    input,
    maxOutputTokens,
    tools,
    costCeilingUsd = DEFAULT_PER_CALL_CEILING_USD,
  } = options;

  assertCronContext(operation);

  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error(
      `[ai] callOpenAiResponses("${operation}"): maxOutputTokens must be a positive integer, got ${maxOutputTokens}`,
    );
  }

  const apiKey = getApiKey();
  const fetchFn = getFetch();

  const body: Record<string, unknown> = {
    model,
    input,
    max_output_tokens: maxOutputTokens,
  };
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetchFn(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errText = "";
    try {
      errText = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `[ai] OpenAI "${operation}" HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as OpenAiResponsesResponse;

  // Extract concatenated text · output_text shortcut OR walk output[].
  let text = (json.output_text ?? "").trim();
  if (!text && Array.isArray(json.output)) {
    const parts: string[] = [];
    for (const item of json.output) {
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.text) parts.push(c.text);
        }
      }
    }
    text = parts.join("\n").trim();
  }

  // Count web_search_call items · governs the per-call charge ($10/1k).
  let webSearchCalls = 0;
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (item.type === "web_search_call") webSearchCalls++;
    }
  }

  const usage: UsageCounts = {
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    cachedInputTokens: json.usage?.input_tokens_details?.cached_tokens ?? 0,
  };
  const tokenCost = computeUsd(model, usage);
  const searchCost = (webSearchCalls / 1000) * WEB_SEARCH_USD_PER_K_CALLS;
  const costUsd = Number((tokenCost + searchCost).toFixed(8));

  if (costUsd > costCeilingUsd) {
    throw new Error(
      `[ai] "${operation}" cost ${costUsd.toFixed(6)} USD exceeded ceiling ${costCeilingUsd.toFixed(4)} USD. ` +
        `Tokens in=${usage.inputTokens} out=${usage.outputTokens}, searches=${webSearchCalls}.`,
    );
  }

  await incrementCost(costUsd, operation);

  return {
    text,
    webSearchCalls,
    usage,
    costUsd,
    model: json.model ?? model,
  };
}
