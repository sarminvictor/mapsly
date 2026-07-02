"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

import { signInAction, type SignInState } from "./actions";

export function SignInForm({
  intent,
  landing,
  audience,
  invite,
}: {
  intent?: string;
  landing?: string;
  /** "agency" when arriving from a /for-agencies CTA (WP2-1). */
  audience?: string;
  /** Seat-invite token from a team email (WP5-8). */
  invite?: string;
}) {
  const t = useTranslations("auth.signin");
  const [state, formAction] = useActionState<SignInState, FormData>(
    signInAction,
    null,
  );

  const errorMsg =
    state?.error === "invalid_email"
      ? t("error_invalid_email")
      : state?.error === "send_failed"
        ? t("error_send_failed")
        : null;

  return (
    <form action={formAction} noValidate aria-describedby="signin-error">
      {intent ? <input type="hidden" name="intent" value={intent} /> : null}
      {landing ? <input type="hidden" name="landing" value={landing} /> : null}
      {audience ? (
        <input type="hidden" name="audience" value={audience} />
      ) : null}
      {invite ? <input type="hidden" name="invite" value={invite} /> : null}
      <label
        htmlFor="signin-email"
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-text-2)",
          marginBottom: 6,
        }}
      >
        {t("email_label")}
      </label>

      <input
        id="signin-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        autoFocus
        spellCheck={false}
        inputMode="email"
        placeholder={t("email_placeholder")}
        aria-invalid={state?.error === "invalid_email" || undefined}
        style={{
          width: "100%",
          height: 48,
          borderRadius: 10,
          padding: "0 14px",
          border: errorMsg
            ? "1px solid var(--color-alert)"
            : "1px solid var(--color-border)",
          background: "var(--color-bg-2)",
          color: "var(--color-text)",
          fontFamily: "var(--font-sans)",
          fontSize: 15,
          outline: "none",
          boxShadow: errorMsg
            ? "0 0 0 3px rgba(181,61,71,.12)"
            : "0 1px 0 rgba(28,25,22,.03)",
        }}
      />

      {errorMsg && (
        <p
          id="signin-error"
          role="alert"
          style={{
            color: "var(--color-alert)",
            fontSize: 13,
            marginTop: 8,
            lineHeight: 1.4,
          }}
        >
          {errorMsg}
        </p>
      )}

      <SubmitButton submittingLabel={t("submitting")} label={t("submit")} />
    </form>
  );
}

function SubmitButton({
  label,
  submittingLabel,
}: {
  label: string;
  submittingLabel: string;
}) {
  // useFormStatus reads the parent form's pending state — must live inside
  // the form, hence a separate component.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      style={{
        marginTop: 14,
        width: "100%",
        height: 48,
        borderRadius: 10,
        border: 0,
        background: pending ? "var(--color-berry)" : "var(--color-coral)",
        color: "#fff",
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        fontSize: 15,
        letterSpacing: "-0.005em",
        cursor: pending ? "default" : "pointer",
        transition: "background 120ms ease",
        opacity: pending ? 0.92 : 1,
      }}
    >
      {pending ? submittingLabel : label}
    </button>
  );
}
