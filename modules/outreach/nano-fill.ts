// modules/outreach/nano-fill.ts · gpt-5.4-nano fluency pass over a grounded skeleton.
//
// The skeleton from first-touch.ts is HONEST but reads like a template. This
// pass asks gpt-5.4-nano to reword it so it reads like a human wrote it — with
// one hard rule: the rewrite may only REPHRASE lines that are already in the
// skeleton. It may NEVER add a claim, a number, or a fact the skeleton didn't
// contain.
//
// We enforce that mechanically with factCheck(): it extracts the numeric +
// claim surface of the rewrite and rejects anything not grounded in the
// original. On rejection — or ANY nano error (timeout, bad output, cost
// ceiling) — we FALL BACK to the skeleton verbatim. A grounded-but-stiff email
// always beats a fluent-but-fabricated one.
//
// Cost-counted: callOpenAi runs inside the open CronRun (asserts cron context).
// This module must therefore be invoked from inside withCronRun(...).
//
// See:
//   - modules/outreach/first-touch.ts — FirstTouch / TouchSignals / buildFirstTouch
//   - services/ai/client.ts           — callOpenAi (cron-bound, cost-tracked)
//   - services/ai/pricing.ts          — gpt-5.4-nano pricing

import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";

import {
  hasUnfilledToken,
  type FirstTouch,
  type TouchSignals,
} from "./first-touch";

/** gpt-5.4-nano ONLY for this task (cheapest model · pure rewording). */
export const NANO_FILL_MODEL: SupportedModel = "gpt-5.4-nano";

export type FluencyRejectionReason =
  | "nano_error"
  | "empty_output"
  | "unfilled_token"
  | "added_claim"
  | "added_number"
  | "missing_business_name";

export interface FluencyResult {
  /** The body actually chosen — the rewrite if it passed, else the skeleton. */
  body: string;
  /** Subject — nano never touches the subject (it's a grounded one-liner). */
  subject?: string;
  /** True when the nano rewrite passed factCheck and was used. */
  rewritten: boolean;
  /** Set when we fell back to the skeleton (why the rewrite was rejected). */
  fallbackReason?: FluencyRejectionReason;
  /** USD billed to the open CronRun for the nano call (0 when no call made). */
  costUsd: number;
}

const SYSTEM_PROMPT = `You rewrite cold-outreach email bodies so they read like a real person wrote them.

ABSOLUTE RULES — violating any one makes your output useless:
- You may ONLY rephrase the sentences you are given. Reword for fluency and a natural, warm tone.
- NEVER add a fact, a statistic, a number, a price, a percentage, a claim, a guarantee, or a name that is not already in the input.
- NEVER add new sentences that introduce information. You may merge or split sentences, but the meaning and every concrete detail must already exist in the input.
- Keep every number EXACTLY as written in the input. Do not round, invent, or drop numbers.
- Keep the business name exactly as written.
- Do NOT add a signature, a footer, links, or a postal address — those are added separately.
- Keep it short. Cold emails that get replies are 3–5 short sentences.

Return ONLY the rewritten body as plain text. No preamble, no quotes, no markdown.`;

function buildPrompt(skeletonBody: string, signals: TouchSignals): string {
  return `Business name (keep exactly): ${signals.businessName}

Rewrite this email body for fluency, keeping every fact and number exactly as-is:

---
${skeletonBody}
---

Rewritten body:`;
}

/** All numeric tokens in a string (integers, decimals, percentages, "5.2s"). */
function extractNumbers(text: string): string[] {
  // Match a run of digits with optional decimal, optionally followed by a unit
  // char we care about (% s). Normalize by stripping a trailing dot.
  const matches = text.match(/\d+(?:\.\d+)?/g) ?? [];
  return matches.map((m) => m.replace(/\.$/, ""));
}

/**
 * A claim-bearing word is a token that, if introduced by the rewrite, would
 * constitute a NEW assertion. We don't try to NLP this — we use the cheapest
 * robust proxy: every number in the rewrite must already be in the original,
 * and a curated set of "fabrication trigger" words (guarantees, superlatives,
 * specific marketing claims) must not appear unless they were in the original.
 */
const FABRICATION_TRIGGERS = [
  "guarantee",
  "guaranteed",
  "free",
  "%",
  "percent",
  "double",
  "triple",
  "#1",
  "number one",
  "best",
  "award",
  "certified",
  "proven",
  "roi",
  "revenue",
  "refund",
  "discount",
  "$",
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Reject a rewrite that introduces facts not present in the skeleton.
 *
 * Returns null when the rewrite is faithful, or a rejection reason when it
 * introduced a number or a fabrication-trigger claim the skeleton lacked, or
 * dropped the business name, or left an unfilled merge token.
 *
 * Pure + exported for unit testing.
 */
export function factCheck(
  original: string,
  rewrite: string,
  businessName?: string,
): FluencyRejectionReason | null {
  const r = rewrite.trim();
  if (r.length === 0) return "empty_output";
  if (hasUnfilledToken(r)) return "unfilled_token";

  // Every number in the rewrite must exist in the original (no invented stats).
  const originalNumbers = new Set(extractNumbers(original));
  for (const n of extractNumbers(r)) {
    if (!originalNumbers.has(n)) return "added_number";
  }

  // No fabrication-trigger claim may appear unless it was already in the original.
  const normOriginal = normalize(original);
  const normRewrite = normalize(rewrite);
  for (const trigger of FABRICATION_TRIGGERS) {
    const t = trigger.toLowerCase();
    if (normRewrite.includes(t) && !normOriginal.includes(t)) {
      return "added_claim";
    }
  }

  // The business name must survive a rewrite that contained it. We only
  // enforce this when the ORIGINAL named the business — you can't drop what
  // wasn't there (a pain-line snippet may not mention the name at all).
  if (businessName) {
    const normName = normalize(businessName);
    const nameInOriginal = normOriginal.includes(normName);
    if (nameInOriginal && !normRewrite.includes(normName)) {
      return "missing_business_name";
    }
  }

  return null;
}

/**
 * Reword the deterministic skeleton body for fluency via gpt-5.4-nano, with a
 * strict fact-check. On rejection or any nano error, fall back to the skeleton
 * verbatim. Never emits an unfilled token. Must run inside an open CronRun
 * (callOpenAi asserts the cron context).
 *
 * The subject is passed through untouched (it's already a grounded one-liner).
 */
export async function fluencyRewrite(
  skeleton: FirstTouch,
  signals: TouchSignals,
): Promise<FluencyResult> {
  // Defensive: never feed a token-bearing skeleton to nano. If the upstream
  // produced one (shouldn't happen), fall back without spending a call.
  if (hasUnfilledToken(skeleton.body)) {
    return {
      body: skeleton.body,
      subject: skeleton.subject,
      rewritten: false,
      fallbackReason: "unfilled_token",
      costUsd: 0,
    };
  }

  // Split off the CAN-SPAM footer (postal address + unsubscribe) before nano
  // sees it: compliance content must stay byte-exact, and feeding nano the
  // address would muddy the number-grounding check with footer digits.
  const footer = extractFooter(skeleton.body);
  const message = footer
    ? skeleton.body.slice(0, skeleton.body.indexOf("\n\n—\n"))
    : skeleton.body;

  let rewrite: string;
  let costUsd = 0;
  try {
    const res = await callOpenAi({
      operation: `outreach.nano-fill[${NANO_FILL_MODEL}]`,
      model: NANO_FILL_MODEL,
      maxTokens: 400,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(message, signals),
    });
    rewrite = res.text;
    costUsd = res.costUsd;
  } catch {
    // Any nano error (timeout, HTTP, cost ceiling) → skeleton verbatim.
    return {
      body: skeleton.body,
      subject: skeleton.subject,
      rewritten: false,
      fallbackReason: "nano_error",
      costUsd: 0,
    };
  }

  // Fact-check the rewrite against the message portion only (the footer it
  // never saw and never reworded).
  const rejection = factCheck(message, rewrite, signals.businessName);
  if (rejection !== null) {
    return {
      body: skeleton.body,
      subject: skeleton.subject,
      rewritten: false,
      fallbackReason: rejection,
      costUsd,
    };
  }

  // Re-attach the original footer verbatim so compliance content is unchanged.
  const finalBody = footer
    ? `${rewrite.trim()}\n\n—\n${footer}`
    : rewrite.trim();

  if (hasUnfilledToken(finalBody)) {
    return {
      body: skeleton.body,
      subject: skeleton.subject,
      rewritten: false,
      fallbackReason: "unfilled_token",
      costUsd,
    };
  }

  return {
    body: finalBody,
    subject: skeleton.subject,
    rewritten: true,
    costUsd,
  };
}

/**
 * Pull the CAN-SPAM footer (everything after the "\n\n—\n" delimiter) out of a
 * skeleton body so it can be preserved verbatim through a rewrite. Returns null
 * when there is no footer. The prompt instructs nano to drop any footer, so the
 * rewrite is footer-free; we re-attach the original to keep compliance content
 * byte-exact.
 */
function extractFooter(body: string): string | null {
  const idx = body.indexOf("\n\n—\n");
  if (idx === -1) return null;
  return body.slice(idx + "\n\n—\n".length);
}
