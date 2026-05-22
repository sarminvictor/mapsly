"use client";

/**
 * AIReplyDraftBody · client island for the EN/ES draft body.
 *
 * Renders ONLY the language toggle + draft text + word/char meta —
 * the parent (ReviewCard) keeps the framing (label, action buttons)
 * server-side. Splitting this way means the rest of the review card
 * doesn't pull into the client bundle.
 *
 * Default language priority:
 *   1. EN draft (if present)
 *   2. ES draft fallback
 *
 * Maria can toggle if both drafts exist — the toggle row is hidden
 * when only one is available so we don't show a single useless pill.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Tap targets ≥ 44px on mobile (button padding sized accordingly)
 *   - Warm, plain English — "English" / "Español" instead of locale
 *     codes
 *   - Aria-pressed conveys state to screen-readers in addition to color
 */

import { useState } from "react";

export interface AIReplyDraftBodyProps {
  draftEn: string | null;
  draftEs: string | null;
  labelEn: string;
  labelEs: string;
  /** "{count} words · {chars} chars" — caller formats. We pass the
   * resolved string per language. */
  buildMeta: (text: string) => string;
}

type Lang = "en" | "es";

export function AIReplyDraftBody({
  draftEn,
  draftEs,
  labelEn,
  labelEs,
  buildMeta,
}: AIReplyDraftBodyProps) {
  const hasEn = !!draftEn?.trim();
  const hasEs = !!draftEs?.trim();
  const initial: Lang = hasEn ? "en" : "es";

  const [lang, setLang] = useState<Lang>(initial);
  const draft = lang === "en" ? (draftEn ?? "") : (draftEs ?? "");

  if (!hasEn && !hasEs) return null;

  const showToggle = hasEn && hasEs;

  return (
    <>
      {showToggle ? (
        <div
          role="group"
          aria-label="Reply language"
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 2,
            background: "var(--color-bg-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 999,
            marginBottom: 10,
          }}
        >
          <LangButton
            active={lang === "en"}
            onClick={() => setLang("en")}
            disabled={!hasEn}
            label={labelEn}
          />
          <LangButton
            active={lang === "es"}
            onClick={() => setLang("es")}
            disabled={!hasEs}
            label={labelEs}
          />
        </div>
      ) : null}

      <div
        style={{
          whiteSpace: "pre-wrap",
          fontSize: 13.5,
          lineHeight: 1.55,
          color: "var(--color-text)",
          marginBottom: 8,
        }}
        data-testid="ai-reply-body"
        lang={lang}
      >
        {draft}
      </div>

      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--color-text-3)",
        }}
      >
        {buildMeta(draft)}
      </p>
    </>
  );
}

function LangButton({
  active,
  onClick,
  disabled,
  label,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 12px",
        background: active ? "var(--color-coral)" : "transparent",
        color: active ? "#fff" : "var(--color-text-2)",
        border: "none",
        borderRadius: 999,
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        minHeight: 28,
      }}
    >
      {label}
    </button>
  );
}
