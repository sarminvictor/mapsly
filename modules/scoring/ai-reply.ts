/**
 * AI reply-draft generation · D.7
 *
 * Batched glue between `services/ai/reply-draft.ts` (the prompt + model
 * surface) and the daily / weekly review cron handlers (the write paths).
 *
 * For each Review whose `aiReplyDraftEn` OR `aiReplyDraftEs` is still NULL,
 * generates a bilingual owner reply draft and persists it back to the row.
 * Per-review failures are isolated — one bad row can't tank a batch of 50.
 *
 * Cost discipline:
 *   - `draftReply` is implemented over `callOpenAi`, which itself routes
 *     cost increments into the open CronRun via AsyncLocalStorage. We do
 *     NOT wrap with `withCostCounter` here (that would double-count).
 *   - The caller MUST be inside a CronRun frame (i.e. invoked from a
 *     cronHandler). `callOpenAi` throws otherwise, so the invariant fails
 *     fast and visibly.
 *
 * See:
 *   - CLAUDE.md §"Mapsly" + Task D.7 in PLAN.md
 *   - .claude/rules/cost-discipline.md — every external call cost-tracked
 *   - .claude/rules/conventions.md — Zod at boundaries, no `any`
 *   - services/ai/reply-draft.ts — model surface + caching
 *   - prisma/schema.prisma `Review.aiReplyDraftEn` / `aiReplyDraftEs`
 */

import pLimit from "p-limit";
import prisma from "@/lib/prisma";
import { draftReply, type ReplyTone } from "@/services/ai";

/**
 * Default tone applied when a Business has no per-tenant override yet.
 *
 * TODO(D.9-ish): wire to `Business.replyTone` (or `User.replyTone` for the
 * single-owner case) once the schema enrichment lands. Until then every
 * draft is "warm" — matches the SMB voice rules in .claude/rules/copy-voice.md.
 */
export const DEFAULT_REPLY_TONE: ReplyTone = "warm";

/** Max parallel OpenAI calls per batch. Keeps us well under the 50 req/min
 *  ceiling per .claude/rules/scalability.md while still parallelizing
 *  enough to fit a 25-business weekly cron inside its 4-min budget. */
const DEFAULT_CONCURRENCY = 3;

/** Max characters retained from a thrown error's message. Keeps the
 *  per-failure entry small enough that 50 of them fit in `meta` JSON. */
const FAILURE_MESSAGE_LIMIT = 300;

export interface GenerateAndPersistReplyDraftsOptions {
  /**
   * Include 5★ reviews with empty / missing text. By default we skip those
   * because the model has no specifics to reference and the resulting
   * draft adds little signal beyond "thanks!".
   */
  alsoBlankFiveStar?: boolean;
  /**
   * Override max concurrency for this batch. Bounded internally to
   * [1, 10] — values outside that range are clamped.
   */
  concurrency?: number;
}

export interface GenerateAndPersistReplyDraftsResult {
  /** Reviews successfully drafted + persisted. */
  processed: number;
  /** Reviews skipped (already drafted, 5★-empty, missing business). */
  skipped: number;
  /** Reviews where draftReply or the DB write threw. Batch continued. */
  failed: number;
  /**
   * First N failures with truncated error messages for cron `meta.failures`.
   * Limited to 5 entries to keep CronRun.meta JSON bounded.
   */
  failureSample: Array<{ reviewId: string; error: string }>;
}

interface LoadedReviewRow {
  id: string;
  stars: number;
  text: string | null;
  aiReplyDraftEn: string | null;
  aiReplyDraftEs: string | null;
  business: {
    name: string;
    category: string;
  } | null;
}

/**
 * Generate and persist EN + ES owner reply drafts for the given review IDs.
 *
 * Idempotent: re-running with the same IDs is a no-op for any review where
 * BOTH `aiReplyDraftEn` AND `aiReplyDraftEs` are already non-null. Partial
 * drafts (one language present, one missing) are re-generated.
 *
 * MUST be invoked inside an open CronRun (cronHandler wraps this). The
 * underlying OpenAI call asserts that and throws otherwise.
 */
export async function generateAndPersistReplyDrafts(
  reviewIds: readonly string[],
  opts: GenerateAndPersistReplyDraftsOptions = {},
): Promise<GenerateAndPersistReplyDraftsResult> {
  const result: GenerateAndPersistReplyDraftsResult = {
    processed: 0,
    skipped: 0,
    failed: 0,
    failureSample: [],
  };

  if (reviewIds.length === 0) return result;

  // De-dupe defensively — callers sometimes pass the same id twice when
  // collecting from multiple buckets (e.g. inserted + updated).
  const uniqueIds = Array.from(new Set(reviewIds));

  const rows = (await prisma.review.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      stars: true,
      text: true,
      aiReplyDraftEn: true,
      aiReplyDraftEs: true,
      business: { select: { name: true, category: true } },
    },
  })) as LoadedReviewRow[];

  const eligible = rows.filter((r) => {
    if (r.aiReplyDraftEn != null && r.aiReplyDraftEs != null) {
      result.skipped += 1;
      return false;
    }
    if (!r.business) {
      // Orphan review row — shouldn't happen given onDelete: Cascade, but
      // skip rather than throw.
      result.skipped += 1;
      return false;
    }
    const hasText = typeof r.text === "string" && r.text.trim().length > 0;
    if (!hasText && r.stars === 5 && !opts.alsoBlankFiveStar) {
      result.skipped += 1;
      return false;
    }
    return true;
  });

  if (eligible.length === 0) return result;

  const concurrencyCap = clampConcurrency(
    opts.concurrency ?? DEFAULT_CONCURRENCY,
  );
  const limit = pLimit(concurrencyCap);

  await Promise.all(
    eligible.map((row) =>
      limit(async () => {
        try {
          const business = row.business!; // narrowed by the filter above
          // TODO(D.9-ish): read tone from Business.replyTone column once
          // added (schema migration is a separate task).
          const tone: ReplyTone = DEFAULT_REPLY_TONE;
          const drafts = await draftReply({
            stars: row.stars,
            // `text` is guaranteed non-empty here for non-5★, and we already
            // skipped 5★-empty above unless `alsoBlankFiveStar` is set.
            text: row.text ?? "",
            businessName: business.name,
            category: business.category,
            tone,
          });
          await prisma.review.update({
            where: { id: row.id },
            data: {
              aiReplyDraftEn: drafts.en,
              aiReplyDraftEs: drafts.es,
            },
          });
          result.processed += 1;
        } catch (err) {
          result.failed += 1;
          if (result.failureSample.length < 5) {
            const message = err instanceof Error ? err.message : String(err);
            result.failureSample.push({
              reviewId: row.id,
              error: message.slice(0, FAILURE_MESSAGE_LIMIT),
            });
          }
        }
      }),
    ),
  );

  return result;
}

function clampConcurrency(n: number): number {
  // Treat NaN as "no input" → fall back to 1. Infinity is "very large" → cap
  // at 10 (the upper bound). Negative / sub-1 values clamp up to 1.
  if (Number.isNaN(n)) return 1;
  if (n < 1) return 1;
  if (n > 10) return 10;
  return Math.floor(n);
}

/** Internal test surface — exported so unit tests can assert defaults
 *  without re-deriving the constants. */
export const __test = {
  DEFAULT_CONCURRENCY,
  FAILURE_MESSAGE_LIMIT,
  clampConcurrency,
};
