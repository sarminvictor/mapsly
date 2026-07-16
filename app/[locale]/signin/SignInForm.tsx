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
        : state?.error === "rate_limited"
          ? t("error_rate_limited")
          : null;

  return (
    <form action={formAction} noValidate>
      {intent ? <input type="hidden" name="intent" value={intent} /> : null}
      {landing ? <input type="hidden" name="landing" value={landing} /> : null}
      {audience ? (
        <input type="hidden" name="audience" value={audience} />
      ) : null}
      {invite ? <input type="hidden" name="invite" value={invite} /> : null}
      <label htmlFor="signin-email" className="si-label">
        {t("email_label")}
      </label>

      <input
        id="signin-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        spellCheck={false}
        inputMode="email"
        placeholder={t("email_placeholder")}
        aria-invalid={state?.error === "invalid_email" || undefined}
        aria-describedby={errorMsg ? "signin-error" : undefined}
        className="si-input"
      />

      {errorMsg && (
        <p id="signin-error" role="alert" className="si-error">
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
  // the form, hence a separate component. `fb-btn` = the marketing-v2 yellow
  // pill (fb.css); `si-btn` sizes it for the card (signin.css).
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="fb-btn si-btn"
    >
      {pending ? submittingLabel : label}
    </button>
  );
}
