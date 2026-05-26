"use client";

/**
 * Client island for the AI-reply CTAs · Generate / Regenerate / Post.
 * Lives inside ReviewCard's AIReplyDraft panel.
 *
 * Wires to regenerateReplyAction via useActionState. The action samples
 * the business owner's prior replies + feeds them as voice-notes to the
 * reply-draft model · matches Maria's tone instead of generic warm copy.
 *
 * Inline status messages (not a global toast) keep this consistent with
 * the cream-warm SMB aesthetic · admin's dark toast doesn't fit here.
 *
 * Post + Edit are still gated behind the Google Business Profile (GBP)
 * integration · disabled with the "Coming soon" tooltip.
 */

import { useActionState } from "react";

import {
  regenerateReplyAction,
  type ActionResult,
  type RegenerateReplyResult,
} from "@/app/[locale]/(smb)/reviews/actions";

interface Props {
  reviewId: string;
  hasDraft: boolean;
  labels: {
    generate: string;
    regenerate: string;
    post: string;
    edit: string;
    comingSoon: string;
  };
}

const initial: ActionResult<RegenerateReplyResult> | null = null;

export function ReplyActions({ reviewId, hasDraft, labels }: Props) {
  const [state, formAction, pending] = useActionState(
    regenerateReplyAction,
    initial,
  );

  if (!hasDraft) {
    // No draft yet · show ONE prominent Generate button.
    return (
      <div>
        <form action={formAction}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="tone" value="warm" />
          <button
            type="submit"
            disabled={pending}
            style={{
              padding: "8px 16px",
              background: "var(--color-coral)",
              color: "#fff",
              border: "none",
              borderRadius: 999,
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 600,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? `${labels.generate}…` : `✦ ${labels.generate}`}
          </button>
        </form>
        <ActionStatus state={state} />
      </div>
    );
  }

  // Has a draft · show full button row.
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
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={labels.comingSoon}
          style={{
            padding: "6px 14px",
            background: "var(--color-coral)",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            fontWeight: 600,
            opacity: 0.55,
            cursor: "not-allowed",
          }}
        >
          {labels.post}
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={labels.comingSoon}
          style={{
            padding: "6px 14px",
            background: "transparent",
            color: "var(--color-text-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 999,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            opacity: 0.55,
            cursor: "not-allowed",
          }}
        >
          {labels.edit}
        </button>
        <form action={formAction} style={{ display: "inline-flex" }}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="tone" value="warm" />
          <button
            type="submit"
            disabled={pending}
            style={{
              padding: "6px 14px",
              background: "transparent",
              color: "var(--color-coral)",
              border: "1px solid var(--color-coral)",
              borderRadius: 999,
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 600,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? `${labels.regenerate}…` : labels.regenerate}
          </button>
        </form>
      </div>
      <ActionStatus state={state} />
    </div>
  );
}

/**
 * Inline status line below the action row. Shows the server message on
 * success (e.g. "Reply generated · matched tone from 5 prior reply(ies).")
 * or the error string on failure. Quiet by default.
 */
function ActionStatus({
  state,
}: {
  state: ActionResult<RegenerateReplyResult> | null;
}) {
  if (!state) return null;
  const message = state.ok ? state.message : state.error;
  if (!message) return null;
  const color = state.ok ? "var(--color-success, #2d8659)" : "#b1462f";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginTop: 8,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color,
      }}
    >
      {message}
    </div>
  );
}
