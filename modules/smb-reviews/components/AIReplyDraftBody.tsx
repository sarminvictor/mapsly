"use client";

/**
 * AIReplyDraftBody · the editable English reply draft.
 *
 * English-only for now (the EN/ES toggle was removed; ES generation is
 * disabled in the service but the column + code stay for the future). The
 * draft renders in a textarea the owner can edit inline, with a Save button
 * that persists the edit via `saveReplyDraftAction`.
 *
 * Per `.claude/rules/ui-ux-smb.md`: warm, plain, tap targets ≥ 44px.
 */

import { useActionState, useState } from "react";

import {
  saveReplyDraftAction,
  type ActionResult,
} from "@/app/[locale]/(smb)/reviews/actions";

export interface AIReplyDraftBodyProps {
  reviewId: string;
  draftEn: string | null;
  labels: { save: string; saved: string };
  /**
   * S3 · notifies the parent of every edit so the pre-publish privacy
   * check (ReplyActions) always sees the CURRENT text, not the
   * server-stored draft. Optional — non-medical flows skip it.
   */
  onTextChange?: (text: string) => void;
}

const initial: ActionResult<null> | null = null;

export function AIReplyDraftBody({
  reviewId,
  draftEn,
  labels,
  onTextChange,
}: AIReplyDraftBodyProps) {
  const [text, setText] = useState(draftEn ?? "");
  const [state, formAction, pending] = useActionState(
    saveReplyDraftAction,
    initial,
  );

  if (!draftEn?.trim() && !text.trim()) return null;

  const words = text.split(/\s+/).filter(Boolean).length;

  return (
    <form action={formAction}>
      <input type="hidden" name="reviewId" value={reviewId} />
      <textarea
        name="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange?.(e.target.value);
        }}
        rows={4}
        aria-label="Edit your reply"
        style={{
          width: "100%",
          boxSizing: "border-box",
          resize: "vertical",
          padding: "10px 12px",
          fontFamily: "var(--font-sans)",
          fontSize: 13.5,
          lineHeight: 1.55,
          color: "var(--color-text)",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-text-3)",
          }}
        >
          {words} words · {text.length} chars
          {state?.ok ? (
            <span style={{ color: "var(--color-success, #2d8659)" }}>
              {" · "}
              {labels.saved}
            </span>
          ) : null}
        </span>
        <button
          type="submit"
          disabled={pending || !text.trim()}
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
            opacity: pending || !text.trim() ? 0.6 : 1,
          }}
        >
          {pending ? `${labels.save}…` : labels.save}
        </button>
      </div>
      {state && !state.ok ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "#b1462f",
          }}
        >
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
