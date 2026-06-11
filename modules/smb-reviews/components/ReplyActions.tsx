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
 *
 * S3 · pre-publish privacy check (medical businesses only): when the
 * privacy labels are set, clicking "Post to Google" first runs the pure
 * `detectPhiRisk` detector over the CURRENT draft text. If flagged, the
 * navigation is intercepted and an inline confirm step renders below the
 * actions — "Edit reply" (default) or "Post anyway". No modal cascades,
 * per `.claude/rules/ui-ux-smb.md`. The medical flag arrives via the
 * labels plumbing (same pattern as the HIPAA badge): non-medical pages
 * simply don't set `privacyConfirmTitle` and the check never runs.
 */

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import {
  regenerateReplyAction,
  type ActionResult,
} from "@/app/[locale]/(smb)/reviews/actions";
import { detectPhiRisk } from "../phi-check";

interface Props {
  reviewId: string;
  hasDraft: boolean;
  /** Google reviews page URL (from googlePlaceId) · null → hide Post. */
  googleReviewsUrl: string | null;
  /** True in the Skipped tab · the queue button restores instead of skips. */
  isSkippedTab: boolean;
  /** Optimistic skip/restore handler owned by the parent list. */
  onMove: (reviewId: string) => void;
  /** S3 · current draft text (lifted from AIReplyDraftBody edits) for
   *  the pre-publish privacy check. Undefined → check runs on "". */
  currentText?: string;
  /** S3 · canonical service names mentioned in the review — sharpens
   *  the treatment vocabulary of the privacy check. */
  serviceNames?: string[];
  /** Hide the Skip/Restore queue button. Used by the published-reply
   *  fix path, where skipping an already-replied review makes no sense. */
  hideQueue?: boolean;
  /**
   * Fires once per successful generation with the fresh draft text.
   * The parent (ReviewCard) lifts it into state so the draft renders
   * IMMEDIATELY — the server-rendered `aiReplyDraftEn` lags one pass
   * because `revalidateTag` refreshes stale-while-revalidate.
   */
  onGenerated?: (draftEn: string) => void;
  labels: {
    generate: string;
    post: string;
    skip: string;
    unskip: string;
    /** S3 · presence of this label enables the pre-publish privacy
     *  check (set by the page for human-medical businesses only). */
    privacyConfirmTitle?: string;
    privacyConfirmEdit?: string;
    privacyConfirmPost?: string;
  };
}

export function ReplyActions({
  reviewId,
  hasDraft,
  googleReviewsUrl,
  isSkippedTab,
  onMove,
  currentText,
  serviceNames,
  hideQueue,
  onGenerated,
  labels,
}: Props) {
  // Initial-state type must match the action's exact return type — a wider
  // `ActionResult<unknown>` trips useActionState's contravariant param check.
  const [genState, genAction, genPending] = useActionState(
    regenerateReplyAction,
    null as Awaited<ReturnType<typeof regenerateReplyAction>> | null,
  );

  // Surface the freshly generated draft to the parent exactly once per
  // result. useActionState returns a NEW state object per completed
  // action, so identity comparison against the last handled result is
  // the dedupe — re-renders with the same state object don't re-fire.
  const lastHandledGenState = useRef<typeof genState>(null);
  useEffect(() => {
    if (!genState || genState === lastHandledGenState.current) return;
    lastHandledGenState.current = genState;
    if (genState.ok && genState.data.draftEn) {
      onGenerated?.(genState.data.draftEn);
    }
  }, [genState, onGenerated]);

  // S3 · inline privacy confirm. Enabled only when the page set the
  // privacy labels (human-medical businesses).
  const phiCheckEnabled = Boolean(labels.privacyConfirmTitle);
  const [phiConfirmOpen, setPhiConfirmOpen] = useState(false);

  const handlePostClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!phiCheckEnabled) return;
    const risk = detectPhiRisk(currentText ?? "", { serviceNames });
    if (risk.flagged) {
      e.preventDefault();
      setPhiConfirmOpen(true);
    } else {
      setPhiConfirmOpen(false);
    }
  };

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
            onClick={handlePostClick}
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

        {hideQueue ? null : (
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
        )}
      </div>

      {/* S3 · inline pre-publish privacy confirm. Renders below the
          actions — no modal, no cascade. "Edit reply" is the default
          (solid coral); "Post anyway" proceeds to Google as a plain
          secondary link. */}
      {phiConfirmOpen && phiCheckEnabled ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "rgba(195, 85, 58, 0.08)",
            border: "1px solid var(--color-coral)",
            borderRadius: 10,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--color-text)",
            }}
          >
            {labels.privacyConfirmTitle}
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setPhiConfirmOpen(false)}
              style={{
                padding: "6px 14px",
                background: "var(--color-coral)",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {labels.privacyConfirmEdit}
            </button>
            {googleReviewsUrl ? (
              <a
                href={googleReviewsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setPhiConfirmOpen(false)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 14px",
                  background: "transparent",
                  color: "var(--color-text-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 999,
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                  textDecoration: "none",
                }}
              >
                {labels.privacyConfirmPost}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

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
