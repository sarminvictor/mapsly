/**
 * F3 · server-side AI sentence-level PHI enrichment.
 *
 * Runs the nano-model sentence scan (services/ai/phi-sentences.ts) over
 * replies the deterministic detector ALREADY flagged, and merges the
 * verbatim sentences into each entry's `matches` so the UI marks them
 * with the same highlight machinery as phrase marks.
 *
 * SERVER-ONLY — imports the cost counter + the AI service. The pure
 * merge logic lives in `phi-check.ts` (client-safe); this module is the
 * seam between the query and the billable call. Only caller:
 * `getSmbReviewsData` (queries.ts), AFTER `summarizeReplyRisks` — so by
 * construction the scan never fires for unflagged replies or
 * non-medical businesses (their risk map is empty → early return, zero
 * AI calls, zero CronRun rows).
 *
 * Cost discipline (`.claude/rules/cost-discipline.md`):
 *   - Mirrors the on-demand reply-draft server action
 *     (app/[locale]/(smb)/reviews/actions.ts): the call runs inside
 *     `withCronRun("manual:smb-phi-sentence-scan")` so every token is
 *     attributed on /admin/cron-runs even though no cron triggered it.
 *   - The service layer caches on (reply text + prompt version) in KV,
 *     so each unique flagged reply bills ~once ever (~$0.0001 on nano).
 *     Page re-renders hit KV, not OpenAI.
 *   - Bounded fan-out: at most MAX_SCANNED_REPLIES per request, each
 *     raced against a short timeout. A scan that loses the race still
 *     completes in the background and lands in KV (and bills once) —
 *     the next render gets it for free.
 *
 * Failure mode: degrade SILENTLY to the deterministic marks. A model
 * outage, timeout, malformed output, or missing API key must never
 * block or crash the reviews page — Maria still sees the phrase-level
 * marks either way.
 */

import { withCronRun } from "@/lib/cost/cost-counter";
import { extractPhiSentences } from "@/services/ai/phi-sentences";

import { mergeAiSentenceMatches, type ReplyRiskEntry } from "./phi-check";

/** CronRun job name · "manual:" prefix per the reply-draft precedent. */
export const PHI_SENTENCE_SCAN_JOB = "manual:smb-phi-sentence-scan";

/** Per-request fan-out cap. Flagged replies are rare — a handful per
 *  business — and `publishedReplies` arrives newest-first, so the cap
 *  scans the most recent flags first. */
const MAX_SCANNED_REPLIES = 8;

/** Per-scan deadline. Short per cost rules — the page must not wait on
 *  a slow model; the losing scan still resolves into KV for next time. */
const DEFAULT_TIMEOUT_MS = 4_000;

type PhiSentenceScanner = (input: {
  replyText: string;
}) => Promise<{ sentences: string[] }>;

export interface EnrichOptions {
  /** Test seam · replaces the cached AI service. Production callers
   *  never pass this. */
  scan?: PhiSentenceScanner;
  /** Test seam · shrink the per-scan deadline. */
  timeoutMs?: number;
}

/**
 * Mutates the flagged entries in `risks` in place (appends `ai-sentence`
 * matches via `mergeAiSentenceMatches`). Entries whose scan fails, times
 * out, or returns nothing keep their deterministic matches untouched.
 *
 * Never throws.
 */
export async function enrichRisksWithAiSentences(
  risks: ReadonlyMap<string, ReplyRiskEntry>,
  replies: ReadonlyArray<{ id: string; text: string | null }>,
  opts?: EnrichOptions,
): Promise<void> {
  // Zero flagged replies → zero AI calls, zero CronRun rows. This is the
  // path every non-medical business and every clean medical business takes.
  if (risks.size === 0) return;

  const flagged = replies
    .filter((r): r is { id: string; text: string } =>
      Boolean(r.text && risks.has(r.id)),
    )
    .slice(0, MAX_SCANNED_REPLIES);
  if (flagged.length === 0) return;

  const scan = opts?.scan ?? extractPhiSentences;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    await withCronRun(PHI_SENTENCE_SCAN_JOB, async () => {
      // allSettled · one slow/failed reply must not cost the others their
      // marks, and the CronRun still closes OK (per-reply degradation is
      // expected, not a job failure).
      await Promise.allSettled(
        flagged.map(async (reply) => {
          const result = await withTimeout(
            scan({ replyText: reply.text }),
            timeoutMs,
          );
          const entry = risks.get(reply.id);
          if (!entry || !Array.isArray(result?.sentences)) return;
          entry.matches = mergeAiSentenceMatches(
            entry.matches,
            result.sentences,
            reply.text,
          );
        }),
      );
    });
  } catch (err) {
    // withCronRun itself failed (DB hiccup opening/closing the run) or
    // something unexpected escaped. Deterministic marks already stand —
    // log for Sentry/Vercel and move on. Never block the page.
    console.warn(
      "[smb-reviews] phi-ai-enrich degraded to deterministic marks:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Race a promise against a deadline. On timeout the underlying scan
 * keeps running on its original async context — the open-CronRun ALS
 * frame travels with it, so its eventual cost still attributes to the
 * scan job and its result still lands in KV for the next render.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`[phi-ai-enrich] sentence scan timed out (${ms}ms)`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
