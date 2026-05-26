// AI-powered contact-email discovery · Tier-3 fallback for the
// qualification pipeline. Triggers ONLY when scrape + RDAP both
// produce zero candidates (see modules/business-qualification/qualify.ts).
//
// Uses OpenAI's Responses API with `web_search_preview` so the model
// can grep Google / Bing / social / directory listings for the email.
// Bypasses both Cloudflare WAFs (search index already crawled them)
// and Wix/Squarespace dynamic widgets (snippets often expose the
// email even when the live site hides it behind JS).
//
// Calgary smoke run (25 no_email rows · 2026-05-25): 15/25 found,
// ~$0.027/biz at gpt-5.4-nano · roughly 2.4 search calls per biz.
//
// Cost discipline:
//   • Every call lives inside an open CronRun (assertCronContext).
//   • Per-call ceiling = DEFAULT_PER_CALL_CEILING_USD ($0.50 default).
//   • Cost-counter increment via callOpenAiResponses → incrementCost.
//
// Quality gates (every layer rejects, returns null instead of dirty
// data — false positives are MUCH worse than nulls in this pipeline):
//   • Confidence must be high or medium (model self-flags low/none → reject).
//   • Email must pass isValidEmailShape (catches `@2x.png`, `admin.foo.ca`,
//     `null` strings, placeholders).
//   • Email domain must match the business domain OR be a free-provider
//     allow-listed inbox (gmail/yahoo/etc) — catches AI fabricating a
//     parent-brand domain that's not actually the business's.

import { callOpenAiResponses } from "./client";

import { DEFAULT_PER_CALL_CEILING_USD, type SupportedModel } from "./pricing";

/* ------------------------------------------------------------------ */
/* Default model · gpt-5.4-nano per A/B run cost/quality comparison    */
/* ------------------------------------------------------------------ */

/**
 * Model used for email-finder by default. Nano matched mini on accuracy
 * across 3 Calgary runs (13-17 vs 14-15 found) at 22% lower per-business
 * cost, so we default to nano. Overridable via env or per-call.
 */
export const DEFAULT_EMAIL_FINDER_MODEL: SupportedModel =
  (process.env.MAPSLY_AI_EMAIL_MODEL as SupportedModel) ?? "gpt-5.4-nano";

/* ------------------------------------------------------------------ */
/* Public types                                                         */
/* ------------------------------------------------------------------ */

export interface FindEmailInput {
  /** Business display name · used in the prompt + as primary search term. */
  name: string;
  /** City the business operates in (helps disambiguate franchise names). */
  city: string;
  /** State/province · optional, included if available. */
  province: string | null;
  /** ISO country code (US, CA, ...). */
  country: string;
  /** Stored website URL, may be null. AI can find emails even when null. */
  website: string | null;
  /** Bare domain extracted from website ("example.com"). null when website is null. */
  domain: string | null;
  /** Google review count · helps the model judge legitimacy + recency. */
  reviewCount: number;
}

export type FindEmailConfidence = "high" | "medium" | "low" | "none";

export interface FindEmailResult {
  /** Validated email · null when nothing was found or output failed gates. */
  email: string | null;
  /** Confidence as self-reported by the model. */
  confidence: FindEmailConfidence;
  /** Cited source · URL / "website" / "social" / "directory". */
  source: string;
  /** One-sentence justification from the model. */
  reasoning: string;
  /** Total cost in USD billed to the open CronRun for this call. */
  costUsd: number;
  /** Exact web_search_call count from the Responses API output. */
  webSearchCalls: number;
  /** Raw model output for `email` before validation · audit/debug. */
  rawEmail: string | null;
  /** Why we dropped a candidate · null when the email was accepted. */
  rejectReason: string | null;
}

export interface FindEmailOptions {
  /** Override the default model. Default: gpt-5.4-nano (see DEFAULT_EMAIL_FINDER_MODEL). */
  model?: SupportedModel;
  /** Override per-call cost ceiling. Default: DEFAULT_PER_CALL_CEILING_USD. */
  costCeilingUsd?: number;
}

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * File-extension TLDs the email regex falsely accepts. `logo@2x.png`
 * pattern from retina-image srcset is the canonical example.
 * Mirrored from scrape-email.ts FILE_EXTENSION_TLDS · keep in sync.
 */
const FILE_EXTENSION_TLDS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff", "avif",
  "woff", "woff2", "ttf", "eot", "otf",
  "css", "js", "mjs", "json", "xml", "html", "htm",
  "mp4", "mp3", "mov", "wav", "webm", "ogg", "m4a", "m4v",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar",
  "7z", "tar", "gz", "map",
]);

/**
 * Free-provider domains we accept as a fallback when the business
 * doesn't have a domain-aligned email. Many small spas/owner-operated
 * businesses use these. Anything else MUST match the business domain
 * to avoid AI inferring parent-brand domains incorrectly.
 */
const FREE_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.ca",
  "hotmail.com",
  "hotmail.ca",
  "outlook.com",
  "outlook.ca",
  "icloud.com",
  "me.com",
  "live.com",
  "live.ca",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "msn.com",
]);

interface ValidationResult {
  ok: boolean;
  cleaned: string | null;
  reason?: string;
}

/**
 * Validate the email string returned by the model. Multi-layer:
 *   1. Reject empty / null-as-string ("null", "none", "n/a")
 *   2. Must include @ and pass canonical email regex
 *   3. Final segment must NOT be a file extension (png/js/etc)
 *   4. Local-part must NOT be a retina-image pattern (@2x, @3x)
 *   5. Reject template placeholders (example.com, mysite.com)
 */
function validateEmail(raw: string | null | undefined): ValidationResult {
  if (raw == null) return { ok: false, cleaned: null, reason: "null" };
  if (typeof raw !== "string") return { ok: false, cleaned: null, reason: "not-string" };
  const s = raw.trim().toLowerCase();
  if (!s) return { ok: false, cleaned: null, reason: "empty" };
  if (s === "null" || s === "none" || s === "n/a") {
    return { ok: false, cleaned: null, reason: "null-string" };
  }
  if (!s.includes("@")) {
    return { ok: false, cleaned: null, reason: "no-at-sign" };
  }
  if (!EMAIL_RE.test(s)) {
    return { ok: false, cleaned: null, reason: "regex-fail" };
  }
  const finalSeg = s.split(".").pop() ?? "";
  if (FILE_EXTENSION_TLDS.has(finalSeg)) {
    return { ok: false, cleaned: null, reason: "file-ext-tld" };
  }
  if (/example\.(com|org)|mysite\.com|placeholder|test\.com/.test(s)) {
    return { ok: false, cleaned: null, reason: "placeholder" };
  }
  const localPart = s.split("@")[0] ?? "";
  if (/(?:^|[-_.])(?:2x|3x|4x)$/i.test(localPart)) {
    return { ok: false, cleaned: null, reason: "retina-image-pattern" };
  }
  return { ok: true, cleaned: s };
}

/**
 * Domain-alignment check · the email must either match the business's
 * own domain (the strongest signal) OR be a known free-provider inbox.
 * This catches the case where the model invents a plausible-sounding
 * parent-brand domain that isn't actually associated with the business.
 */
function isAcceptableDomain(email: string, businessDomain: string | null): boolean {
  const emailDomain = (email.split("@")[1] ?? "").toLowerCase();
  if (FREE_PROVIDERS.has(emailDomain)) return true;
  if (!businessDomain) {
    // No business domain to compare against — accept only free providers.
    // (Otherwise we'd accept any domain the AI invented, which is risky.)
    return false;
  }
  const bd = businessDomain.toLowerCase();
  return emailDomain === bd || emailDomain.endsWith("." + bd);
}

/* ------------------------------------------------------------------ */
/* Prompt                                                               */
/* ------------------------------------------------------------------ */

/**
 * Single-turn prompt for the Responses API with web_search_preview.
 * Tuned via the Calgary A/B run · keep these instructions in this exact
 * order, they materially affect output JSON-shape compliance.
 */
function buildPrompt(input: FindEmailInput): string {
  const loc = [input.city, input.province, input.country].filter(Boolean).join(", ");
  return `You are an OSINT researcher. Find a verifiable contact email address for this local business. Use web search aggressively.

Business: ${input.name}
Location: ${loc}
Website: ${input.website ?? "(none listed)"}
Google review count: ${input.reviewCount}

Constraints:
- Return the BUSINESS contact email (general inbox like info@, contact@, hello@, or the owner's professional email). NOT a customer's email, NOT a competitor's, NOT a generic placeholder.
- The email MUST be properly formatted: local-part@domain.tld with an @ sign. NEVER return a URL, handle, or partial string. If you only find a contact-form URL with no email, return null.
- If the website renders contact info via JS (Wix/Squarespace), search Google/Bing/social/directory listings (Facebook, Instagram, Yelp, Yellow Pages, Fotona finder, etc.) — they often have cached versions.
- The email's domain SHOULD match the business website domain when possible. Free-provider (gmail/yahoo/hotmail/me.com) is acceptable only if no domain-aligned email exists AND you have direct evidence (e.g., it appears on the business's own page or social profile).
- Reject template defaults like example@example.com, test@test.com, email@mysite.com.
- If you cannot find a confidently-verified email after 2-3 search queries, return null. False positives are MUCH worse than nulls.

Reply with EXACTLY this JSON shape on a single line, no prose around it:
{"email":"address@example.com or null","confidence":"high|medium|low|none","source":"where you found it (URL or 'website' or 'social' or 'directory')","reasoning":"one sentence why you trust this email"}`;
}

/* ------------------------------------------------------------------ */
/* Output parsing                                                       */
/* ------------------------------------------------------------------ */

interface ParsedAiOutput {
  email: string | null;
  confidence: FindEmailConfidence;
  source: string;
  reasoning: string;
}

/**
 * Parse the model's JSON reply. The model sometimes wraps the JSON in
 * narration ("Here's what I found: {...}") — find the first balanced
 * {...} block and JSON.parse it. Returns safe defaults on any failure.
 */
function parseAiOutput(text: string): ParsedAiOutput {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { email: null, confidence: "none", source: "unparseable", reasoning: text.slice(0, 200) };
  }
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const conf = String(obj.confidence ?? "none").toLowerCase();
    const validConfidence: FindEmailConfidence =
      conf === "high" || conf === "medium" || conf === "low" ? conf : "none";
    return {
      email: typeof obj.email === "string" ? obj.email : null,
      confidence: validConfidence,
      source: String(obj.source ?? "unknown").slice(0, 200),
      reasoning: String(obj.reasoning ?? "").slice(0, 400),
    };
  } catch {
    return { email: null, confidence: "none", source: "json-parse-fail", reasoning: text.slice(0, 200) };
  }
}

/* ------------------------------------------------------------------ */
/* Public entrypoint                                                    */
/* ------------------------------------------------------------------ */

const OPERATION = "ai.email-finder";

/**
 * AI-powered email discovery. Returns a validated FindEmailResult.
 *
 * Caller MUST run this inside withCronRun(...). Cost is billed to the
 * open run (incrementCost via callOpenAiResponses).
 *
 * Returns `email: null` for all of:
 *   • Model couldn't find one (legitimate null)
 *   • Model output failed validation (malformed shape)
 *   • Confidence was low/none
 *   • Domain didn't align (and wasn't a free provider)
 *
 * Inspect `rejectReason` to distinguish; it's null only on accepted emails.
 */
export async function findEmailViaAi(
  input: FindEmailInput,
  options: FindEmailOptions = {},
): Promise<FindEmailResult> {
  const model = options.model ?? DEFAULT_EMAIL_FINDER_MODEL;
  const costCeilingUsd = options.costCeilingUsd ?? DEFAULT_PER_CALL_CEILING_USD;

  const prompt = buildPrompt(input);

  const response = await callOpenAiResponses({
    operation: OPERATION,
    model,
    input: prompt,
    maxOutputTokens: 800,
    tools: [{ type: "web_search_preview" }],
    costCeilingUsd,
  });

  const parsed = parseAiOutput(response.text);

  // Gate 1: confidence must be high or medium
  if (parsed.confidence !== "high" && parsed.confidence !== "medium") {
    return {
      email: null,
      confidence: parsed.confidence,
      source: parsed.source,
      reasoning: parsed.reasoning,
      costUsd: response.costUsd,
      webSearchCalls: response.webSearchCalls,
      rawEmail: parsed.email,
      rejectReason: parsed.email
        ? `low-confidence (${parsed.confidence})`
        : "no-email-found",
    };
  }

  // Gate 2: email shape must validate
  const validation = validateEmail(parsed.email);
  if (!validation.ok || !validation.cleaned) {
    return {
      email: null,
      confidence: parsed.confidence,
      source: parsed.source,
      reasoning: parsed.reasoning,
      costUsd: response.costUsd,
      webSearchCalls: response.webSearchCalls,
      rawEmail: parsed.email,
      rejectReason: validation.reason ?? "shape-invalid",
    };
  }

  // Gate 3: domain alignment OR free provider
  if (!isAcceptableDomain(validation.cleaned, input.domain)) {
    return {
      email: null,
      confidence: parsed.confidence,
      source: parsed.source,
      reasoning: parsed.reasoning,
      costUsd: response.costUsd,
      webSearchCalls: response.webSearchCalls,
      rawEmail: parsed.email,
      rejectReason: "domain-mismatch",
    };
  }

  // All gates passed — accept
  return {
    email: validation.cleaned,
    confidence: parsed.confidence,
    source: parsed.source,
    reasoning: parsed.reasoning,
    costUsd: response.costUsd,
    webSearchCalls: response.webSearchCalls,
    rawEmail: parsed.email,
    rejectReason: null,
  };
}
