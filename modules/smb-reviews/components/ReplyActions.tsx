"use client";

/**
 * Client island for the AI-reply CTAs.
 *
 *   - No draft yet → one "Generate" button (regenerateReplyAction, EN-only).
 *   - Has a draft   → "Post to Google" (opens the business's Google reviews
 *                      page so the owner pastes the reply) + nothing else here;
 *                      editing/saving lives in AIReplyDraftBody.
 *   - Always        → "Skip" (active tabs) or "Restore" (Skipped tab).
 *
 * Skip / Restore are NOT self-contained forms here — they call `onMove`,
 * which the parent list (`PaginatedReviewList`) handles optimistically so
 * the card disappears from the current tab the instant Maria clicks. The
 * server action runs in the parent's transition. See
 * `.claude/rules/realtime-and-optimistic.md`.
 *
 * No "Regenerate" — one generated draft per review (the owner edits it inline).
 * Post-to-Google is shown only when we have the business's googlePlaceId.
 */

import { useActionState } from "react";

import {
  regenerateReplyAction,
  type ActionResult,
} from "@/app/[locale]/(smb)/reviews/actions";

interface Props {
  reviewId: string;
  hasDraft: boolean;
  /** Google reviews page URL (from googlePlaceId) · null → hide Post. */
  googleReviewsUrl: string | null;
  /** True in the Skipped tab · the queue button restores instead of skips. */
  isSkippedTab: boolean;
  /** Optimistic skip/restore handler owned by the parent list. */
  onMove: (reviewId: string) => void;
  labels: {
    generate: string;
    post: string;
    skip: string;
    unskip: string;
  };
}

export function ReplyActions({
  reviewId,
  hasDraft,
  googleReviewsUrl,
  isSkippedTab,
  onMove,
  labels,
}: Props) {
  // Initial-state type must match the action's exact return type — a wider
  // `ActionResult<unknown>` trips useActionState's contravariant param check.
  const [genState, genAction, genPending] = useActionState(
    regenerateReplyAction,
    null as Awaited<ReturnType<typeof regenerateReplyAction>> | null,
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        {!hasDraft ? (
          <form action={genAction}>
            <input type="hidden" name="reviewId" value={reviewId} />
            <input type="hidden" name="tone" value="warm" />
            <button
              type="submit"
              disabled={genPending}
              style={{
                padding: "8px 16px",
                background: "var(--color-coral)",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 600,
                cursor: genPending ? "not-allowed" : "pointer",
                opacity: genPending ? 0.6 : 1,
              }}
            >
              {genPending ? `${labels.generate}…` : `✦ ${labels.generate}`}
            </button>
          </form>
        ) : null}

        {hasDraft && googleReviewsUrl ? (
          <a
            href={googleReviewsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "6px 14px",
              background: "var(--color-coral)",
              color: "#fff",
              borderRadius: 999,
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {labels.post}
          </a>
        ) : null}

        <button
          type="button"
          onClick={() => onMove(reviewId)}
          style={{
            padding: "6px 14px",
            background: "transparent",
            color: "var(--color-text-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 999,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {isSkippedTab ? labels.unskip : labels.skip}
        </button>
      </div>
      <ActionStatus state={genState} />
    </div>
  );
}

function ActionStatus({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  const message = state.ok ? state.message : state.error;
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginTop: 8,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: state.ok ? "var(--color-success, #2d8659)" : "#b1462f",
      }}
    >
      {message}
    </div>
  );
}
