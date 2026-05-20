import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Card · generic container · padding + border + soft shadow.
 *
 * Two density variants: `comfortable` (default · SMB) and `compact` (Agency).
 * Use the polymorphic `as` prop to render as <section>, <article>, etc.
 */
export type CardDensity = "comfortable" | "compact";
export type CardAudience = "smb" | "agency";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: CardDensity;
  audience?: CardAudience;
  /** Render as a different semantic element. Defaults to <div>. */
  as?: "div" | "section" | "article" | "aside";
  /** Make the entire card act as a button surface (cursor + hover lift). */
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    density = "comfortable",
    audience = "smb",
    as = "div",
    interactive,
    className,
    style,
    children,
    ...rest
  },
  ref,
) {
  const padding = density === "compact" ? 16 : 24;
  const radius = density === "compact" ? 10 : 14;

  // Both audiences use the white card surface; tinted backgrounds belong on the page, not the card.
  const bg = "var(--color-bg-2)";

  const merged: React.CSSProperties = {
    background: bg,
    border: "1px solid var(--color-border)",
    borderRadius: radius,
    padding,
    boxShadow: "0 1px 0 rgba(28,25,22,.03)",
    cursor: interactive ? "pointer" : undefined,
    transition: interactive
      ? "transform 140ms ease, box-shadow 140ms ease"
      : undefined,
    ...style,
  };

  const Tag = as;

  return React.createElement(
    Tag,
    {
      ref,
      className: cn("mapsly-card", className),
      "data-density": density,
      "data-audience": audience,
      "data-interactive": interactive ? "true" : undefined,
      style: merged,
      ...rest,
    },
    children,
  );
});

/**
 * CardHeader, CardTitle, CardBody, CardFooter · optional structural sub-pieces.
 * Use them when you want consistent spacing inside a Card.
 */
export function CardHeader({
  className,
  style,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mapsly-card-header", className)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
        ...style,
      }}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  style,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("mapsly-card-title", className)}
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: 16,
        fontWeight: 600,
        color: "var(--color-text)",
        margin: 0,
        lineHeight: 1.4,
        ...style,
      }}
      {...rest}
    />
  );
}

export function CardBody({
  className,
  style,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mapsly-card-body", className)}
      style={{ color: "var(--color-text-2)", ...style }}
      {...rest}
    />
  );
}

export function CardFooter({
  className,
  style,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mapsly-card-footer", className)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 16,
        paddingTop: 12,
        borderTop: "1px solid var(--color-border)",
        ...style,
      }}
      {...rest}
    />
  );
}
