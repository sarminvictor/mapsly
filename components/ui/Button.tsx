import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Button · primary, secondary, destructive variants × two audience palettes.
 *
 * SMB palette (default) — warm cream + coral. Maria's portal.
 * Agency palette (`audience="agency"`) — cool gray + indigo. Tom's portal.
 *
 * Server-component-safe: no hooks, no event handlers in the default render.
 * Caller-supplied `onClick` on a wrapped client component is fine.
 */
export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonAudience = "smb" | "agency";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  audience?: ButtonAudience;
  /** Show a leading icon — render any node, sized 16px square. */
  leading?: React.ReactNode;
  /** Show a trailing icon. */
  trailing?: React.ReactNode;
  /** Full-width on mobile, intrinsic on desktop. */
  block?: boolean;
}

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { height: 32, padding: "0 12px", fontSize: 13, borderRadius: 6 },
  md: { height: 40, padding: "0 16px", fontSize: 14, borderRadius: 8 },
  lg: { height: 48, padding: "0 20px", fontSize: 15, borderRadius: 10 },
};

function paletteStyles(
  variant: ButtonVariant,
  audience: ButtonAudience,
): React.CSSProperties {
  const accent =
    audience === "agency" ? "var(--color-agency-indigo)" : "var(--color-coral)";

  switch (variant) {
    case "primary":
      return {
        background: accent,
        color: "#fff",
        border: `1px solid ${accent}`,
        // hover handled via CSS class below; inline can't do :hover
      };
    case "secondary":
      return {
        background: "var(--color-bg-2)",
        color: "var(--color-text)",
        border: "1px solid var(--color-border)",
      };
    case "destructive":
      return {
        background: "var(--color-alert)",
        color: "#fff",
        border: "1px solid var(--color-alert)",
      };
    case "ghost":
      return {
        background: "transparent",
        color: "var(--color-text-2)",
        border: "1px solid transparent",
      };
  }
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      audience = "smb",
      leading,
      trailing,
      block,
      className,
      style,
      type = "button",
      disabled,
      children,
      ...rest
    },
    ref,
  ) {
    const merged: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      fontFamily: "var(--font-sans)",
      fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      outline: "none",
      transition: "filter 120ms ease, transform 120ms ease",
      width: block ? "100%" : undefined,
      ...sizeStyles[size],
      ...paletteStyles(variant, audience),
      ...style,
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn("mapsly-btn", className)}
        data-variant={variant}
        data-audience={audience}
        style={merged}
        {...rest}
      >
        {leading != null ? (
          <span
            aria-hidden
            style={{ display: "inline-flex", width: 16, height: 16 }}
          >
            {leading}
          </span>
        ) : null}
        {children}
        {trailing != null ? (
          <span
            aria-hidden
            style={{ display: "inline-flex", width: 16, height: 16 }}
          >
            {trailing}
          </span>
        ) : null}
      </button>
    );
  },
);
