import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Input · text/email/number/etc. with optional label, help text, error state.
 *
 * Audience-aware: SMB (cream + coral focus) by default; pass
 * `audience="agency"` for cool-gray + indigo focus ring.
 *
 * Forwarded ref + spread of all native HTMLInputElement props.
 */
export type InputAudience = "smb" | "agency";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Visible label above the input. */
  label?: React.ReactNode;
  /** One-line help text below the input. */
  hint?: React.ReactNode;
  /** Error message — when present, shows red border + replaces hint. */
  error?: React.ReactNode;
  audience?: InputAudience;
  /** Full-width by default; pass false for intrinsic sizing. */
  block?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      id,
      label,
      hint,
      error,
      audience = "smb",
      block = true,
      className,
      style,
      "aria-invalid": ariaInvalid,
      "aria-describedby": ariaDescribedBy,
      required,
      ...rest
    },
    ref,
  ) {
    const reactId = React.useId();
    const inputId = id ?? `input-${reactId}`;
    const hintId = hint != null && error == null ? `${inputId}-hint` : undefined;
    const errorId = error != null ? `${inputId}-error` : undefined;
    const describedBy =
      [ariaDescribedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;

    const accent =
      audience === "agency"
        ? "rgba(91,61,245,.12)"
        : "rgba(195,85,58,.12)";

    const inputStyle: React.CSSProperties = {
      width: block ? "100%" : undefined,
      height: 44,
      borderRadius: 10,
      padding: "0 14px",
      border: error
        ? "1px solid var(--color-alert)"
        : "1px solid var(--color-border)",
      background: "var(--color-bg-2)",
      color: "var(--color-text)",
      fontFamily: "var(--font-sans)",
      fontSize: 15,
      outline: "none",
      boxShadow: error
        ? "0 0 0 3px rgba(181,61,71,.12)"
        : `0 0 0 0 ${accent}`,
      transition: "box-shadow 140ms ease, border-color 140ms ease",
      ...style,
    };

    return (
      <div
        className={cn("mapsly-input-field", className)}
        style={{ display: "flex", flexDirection: "column", gap: 6 }}
      >
        {label != null ? (
          <label
            htmlFor={inputId}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-text-2)",
              lineHeight: 1.4,
            }}
          >
            {label}
            {required ? (
              <span
                aria-hidden
                style={{ color: "var(--color-alert)", marginLeft: 4 }}
              >
                *
              </span>
            ) : null}
          </label>
        ) : null}

        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={ariaInvalid ?? (error != null ? true : undefined)}
          aria-required={required ? true : undefined}
          aria-describedby={describedBy}
          data-audience={audience}
          style={inputStyle}
          {...rest}
        />

        {error != null ? (
          <p
            id={errorId}
            role="alert"
            style={{
              fontSize: 13,
              color: "var(--color-alert)",
              lineHeight: 1.4,
            }}
          >
            {error}
          </p>
        ) : hint != null ? (
          <p
            id={hintId}
            style={{
              fontSize: 13,
              color: "var(--color-text-3)",
              lineHeight: 1.4,
            }}
          >
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
