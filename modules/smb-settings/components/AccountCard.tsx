"use client";

/**
 * SMB settings · editable account card.
 *
 * Email is the magic-link sign-in identity — shown read-only (changing it
 * would orphan the session). The display name is editable + saved via the
 * `updateSmbAccount` server action. React 19 `useActionState` drives inline
 * pending + saved/error feedback (no full-page reload).
 *
 * Per `.claude/rules/ui-ux-smb.md` — warm, plain English, 44px tap targets,
 * one clear action (Save). Styles are inline (this is a leaf client
 * component and can't import the server page's style helpers).
 */

import { useActionState, useState } from "react";
import type { CSSProperties } from "react";

import { updateSmbAccount, type UpdateAccountState } from "../actions";

export interface AccountCardLabels {
  heading: string;
  emailLabel: string;
  emailNote: string;
  nameLabel: string;
  namePlaceholder: string;
  saveCta: string;
  saving: string;
  saved: string;
  error: string;
}

const INITIAL: UpdateAccountState = { status: "idle" };

export function AccountCard({
  userEmail,
  userName,
  labels,
}: {
  userEmail: string;
  userName: string | null;
  labels: AccountCardLabels;
}) {
  const [state, formAction, pending] = useActionState(
    updateSmbAccount,
    INITIAL,
  );
  // Controlled — otherwise React 19 resets the field to its initial value
  // after the form action completes, which made a just-saved name look
  // unsaved until a manual refresh.
  const [name, setName] = useState(userName ?? "");
  const [dirty, setDirty] = useState(false);
  const [seenStatus, setSeenStatus] = useState(state.status);

  // When a save resolves, the field's value is the saved value again — clear
  // the "edited" flag. Adjusted during render (the React-idiomatic alternative
  // to a setState-in-effect, which trips the cascading-render lint rule).
  if (seenStatus !== state.status) {
    setSeenStatus(state.status);
    if (state.status === "saved") setDirty(false);
  }

  return (
    <section aria-labelledby="account-heading" style={card}>
      <h2 id="account-heading" style={title}>
        {labels.heading}
      </h2>

      <form action={formAction}>
        <label style={fieldLabel}>
          {labels.emailLabel}
          <input
            type="email"
            value={userEmail}
            readOnly
            aria-readonly="true"
            style={{
              ...input,
              color: "var(--color-text-2)",
              background: "var(--color-bg-3)",
            }}
          />
        </label>
        <p style={note}>{labels.emailNote}</p>

        <label style={fieldLabel}>
          {labels.nameLabel}
          <input
            name="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              setDirty(true);
            }}
            placeholder={labels.namePlaceholder}
            maxLength={120}
            autoComplete="name"
            style={input}
          />
        </label>

        <div style={actionRow}>
          <button
            type="submit"
            disabled={pending}
            style={{
              ...button,
              opacity: pending ? 0.65 : 1,
              cursor: pending ? "default" : "pointer",
            }}
          >
            {pending ? labels.saving : labels.saveCta}
          </button>
          {!pending && !dirty && state.status === "saved" ? (
            <span
              role="status"
              style={{ fontSize: 13, color: "var(--color-success)" }}
            >
              {labels.saved}
            </span>
          ) : null}
          {!pending && state.status === "error" ? (
            <span
              role="status"
              style={{ fontSize: 13, color: "var(--color-coral)" }}
            >
              {labels.error}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

const card: CSSProperties = {
  padding: "22px 22px 24px",
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  marginBottom: 16,
};
const title: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-serif)",
  fontSize: 19,
  letterSpacing: "-0.01em",
  color: "var(--color-text)",
};
const fieldLabel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 16,
  fontSize: 13,
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-3)",
};
const input: CSSProperties = {
  height: 44,
  padding: "0 12px",
  fontSize: 15,
  fontFamily: "var(--font-sans)",
  textTransform: "none",
  letterSpacing: 0,
  color: "var(--color-text)",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
};
const note: CSSProperties = {
  margin: "6px 0 0",
  fontSize: 12,
  color: "var(--color-text-3)",
  lineHeight: 1.5,
};
const actionRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginTop: 18,
};
const button: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 44,
  minWidth: 96,
  padding: "0 18px",
  background: "var(--color-coral)",
  color: "#fff",
  border: "1px solid var(--color-coral)",
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 500,
};
